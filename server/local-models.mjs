import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { providerRequest } from "./transport.mjs";
import { pickLocalFile } from "./file-picker.mjs";

async function entries(directory) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}
async function gguf(file) {
  const resolved = await fs.realpath(file);
  const handle = await fs.open(resolved, "r");
  try {
    const stat = await handle.stat();
    const header = Buffer.alloc(4);
    await handle.read(header, 0, 4, 0);
    if (
      !stat.isFile() ||
      stat.size < 1024 * 1024 ||
      header.toString() !== "GGUF"
    )
      throw new Error(
        "Choose a complete GGUF model file, not a projector, vocabulary file, or download placeholder.",
      );
    if (/mmproj|ggml-vocab|\.part$/i.test(path.basename(resolved)))
      throw new Error(
        "Choose the main language model GGUF, not a projector or vocabulary file.",
      );
    return { path: resolved, bytes: stat.size };
  } finally {
    await handle.close();
  }
}

export async function discoverModels(home = os.homedir()) {
  const found = new Map();
  const add = async (file, label, source) => {
    try {
      const data = await gguf(file);
      if (!found.has(data.path))
        found.set(data.path, {
          ...data,
          id: createHash("sha256").update(data.path).digest("hex").slice(0, 24),
          label: label || path.basename(file),
          source,
        });
    } catch {
      /* Ignore partial downloads and non-model sidecars. */
    }
  };
  async function walk(directory, depth, source, manifestRoot) {
    if (depth < 0 || found.size >= 300) return;
    for (const entry of await entries(directory)) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory())
        await walk(file, depth - 1, source, manifestRoot);
      else if (manifestRoot) {
        try {
          const manifest = JSON.parse(await fs.readFile(file, "utf8"));
          const layer = manifest.layers?.find(
            (item) => item.mediaType === "application/vnd.ollama.image.model",
          );
          if (!/^sha256:[a-f0-9]{64}$/.test(layer?.digest || "")) continue;
          const parts = path.relative(manifestRoot, file).split(path.sep);
          const tag = parts.pop();
          await add(
            path.join(
              path.dirname(manifestRoot),
              "blobs",
              layer.digest.replace(":", "-"),
            ),
            `${parts.join("/")}:${tag}`,
            "Ollama GGUF",
          );
        } catch {
          /* Not a readable model manifest. */
        }
      } else if (/\.gguf$/i.test(entry.name))
        await add(file, entry.name, source);
    }
  }
  const ollama =
    process.env.OLLAMA_MODELS || path.join(home, ".ollama", "models");
  const manifests = path.join(ollama, "manifests");
  await walk(manifests, 5, "Ollama GGUF", manifests);
  await walk(
    path.join(home, ".cache", "huggingface", "hub"),
    4,
    "Hugging Face cache",
  );
  await walk(path.join(home, ".lmstudio", "models"), 4, "LM Studio");
  await walk(
    process.env.LLAMA_CACHE || path.join(home, "AppData", "Local", "llama.cpp"),
    3,
    "llama.cpp cache",
  );
  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export async function findEngine(home = os.homedir()) {
  const executable =
    process.platform === "win32" ? "llama-server.exe" : "llama-server";
  const candidates = [
    process.env.DRAFTLINE_LLAMA_SERVER,
    ...(process.env.PATH || "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((folder) => path.join(folder, executable)),
    path.join(home, "llama.cpp", "build", "bin", "Release", executable),
    path.join(
      home,
      ".unsloth",
      "llama.cpp",
      "build",
      "bin",
      "Release",
      executable,
    ),
  ];
  for (const entry of await entries(path.join(home, "Downloads")))
    if (entry.isDirectory())
      candidates.push(
        path.join(home, "Downloads", entry.name, "bin", executable),
      );
  for (const candidate of candidates.filter(Boolean)) {
    try {
      if ((await fs.stat(candidate)).isFile())
        return await fs.realpath(candidate);
    } catch {
      /* Continue discovery. */
    }
  }
  return null;
}

const occupied = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });

export function createLocalModelManager({
  home = os.homedir(),
  port = 9931,
  pickFile = pickLocalFile,
  spawnProcess = spawn,
  probe = providerRequest,
  portOccupied = occupied,
} = {}) {
  let engine = null,
    catalog = [],
    child = null,
    monitor = null,
    selection = null,
    switching = false;
  let closed = false;
  let state = {
    phase: "stopped",
    modelId: null,
    message: "Choose a GGUF to run with llama.cpp.",
    log: "",
  };
  const baseUrl = `http://127.0.0.1:${port}`;
  const snapshot = () => ({
    ...state,
    engine,
    baseUrl,
    models: catalog,
    picking: Boolean(selection),
  });
  const stop = async () => {
    monitor?.abort();
    monitor = null;
    const active = child;
    child = null;
    if (active && active.exitCode === null)
      await new Promise((resolve) => {
        active.once("close", resolve);
        active.kill("SIGKILL");
      });
    state = { ...state, phase: "stopped", message: "Local model stopped." };
    return snapshot();
  };
  async function refresh() {
    if (!engine) engine = await findEngine(home);
    const selected = catalog.filter(
      (model) => model.source === "Selected file",
    );
    catalog = await discoverModels(home);
    for (const item of selected)
      if (!catalog.some((model) => model.id === item.id)) catalog.push(item);
    return snapshot();
  }
  async function pick(kind, signal) {
    if (selection || switching || state.phase === "loading")
      throw new Error("Finish the current selection or model load first.");
    selection = new AbortController();
    const abort = () => selection?.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) selection.abort();
    try {
      const file = await pickFile(kind, selection.signal);
      if (!file) return { ...snapshot(), cancelled: true };
      if (selection.signal.aborted) throw new Error("Selection cancelled.");
      if (kind === "engine") {
        const resolved = await fs.realpath(file);
        if (
          !/^llama-server(?:\.exe)?$/i.test(path.basename(resolved)) ||
          !(await fs.stat(resolved)).isFile()
        )
          throw new Error(
            "Select the llama-server executable from your llama.cpp installation.",
          );
        if (child)
          throw new Error("Stop the managed model before changing the engine.");
        engine = resolved;
        return snapshot();
      }
      const model = await gguf(file);
      const id = createHash("sha256")
        .update(model.path)
        .digest("hex")
        .slice(0, 24);
      if (!catalog.some((item) => item.id === id))
        catalog.push({
          ...model,
          id,
          label: path.basename(file),
          source: "Selected file",
        });
      return { ...snapshot(), selectedId: id };
    } finally {
      signal?.removeEventListener("abort", abort);
      selection = null;
    }
  }
  async function start(modelId) {
    if (closed) throw new Error("The local model loader has closed.");
    if (switching || selection || state.phase === "loading")
      throw new Error("A model is already loading or a file dialog is open.");
    const model = catalog.find((item) => item.id === modelId);
    if (!model)
      throw new Error(
        "Choose a model from the local list or the file picker first.",
      );
    if (!engine)
      throw new Error(
        "Choose llama-server from your llama.cpp installation first.",
      );
    switching = true;
    try {
      await stop();
      if (await portOccupied(port))
        throw new Error(
          `Port ${port} already belongs to another server. Connect to that server using its URL, or stop it yourself before loading a local model.`,
        );
      await gguf(model.path);
      if (closed) throw new Error("The local model loader has closed.");
      const alias = model.label
        .replace(/[\r\n\0]/g, "")
        .replace(/^-/, "_")
        .slice(0, 280);
      const args = [
        "--model",
        model.path,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--jinja",
        "--alias",
        alias,
        "--ctx-size",
        "8192",
        "--parallel",
        "1",
        "--gpu-layers",
        "auto",
      ];
      state = {
        phase: "loading",
        modelId,
        model: alias,
        message: "Loading model into llama.cpp…",
        log: "",
      };
      const process = spawnProcess(engine, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child = process;
      const collect = (chunk) => {
        if (child === process)
          state.log = (state.log + chunk.toString()).slice(-12_000);
      };
      process.stdout?.on("data", collect);
      process.stderr?.on("data", collect);
      process.once("error", (error) => {
        if (child === process) {
          monitor?.abort();
          child = null;
          state = {
            ...state,
            phase: "error",
            message: `llama-server could not start: ${error.message}`,
          };
        }
      });
      process.once("close", (code) => {
        if (child === process) {
          monitor?.abort();
          child = null;
          state = {
            ...state,
            phase: "error",
            message: `llama-server exited (${code}). ${state.log.slice(-1600)}`,
          };
        }
      });
      monitor = new AbortController();
      const signal = monitor.signal;
      void (async () => {
        while (!signal.aborted && child === process) {
          try {
            const health = await probe(baseUrl + "/health", { signal });
            if (health.status === "ok") {
              const list = await probe(baseUrl + "/v1/models", { signal });
              if (
                !signal.aborted &&
                child === process &&
                list.data?.some((item) => item.id === alias)
              ) {
                state = {
                  ...state,
                  phase: "ready",
                  message: "Model ready.",
                  model: alias,
                };
                return;
              }
            }
          } catch {
            /* Keep waiting until ready, cancelled, or the process exits. */
          }
          try {
            await delay(700, undefined, { signal });
          } catch {
            return;
          }
        }
      })();
      return snapshot();
    } finally {
      switching = false;
    }
  }
  return {
    refresh,
    pick,
    start,
    stop,
    snapshot,
    close: async () => {
      closed = true;
      selection?.abort();
      await stop();
    },
  };
}
