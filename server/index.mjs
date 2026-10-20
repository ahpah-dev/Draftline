import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { providerConfig, models } from "./providers.mjs";
import {
  buildRun,
  runAgent,
  diagnostics,
  settleInterruptedTools,
} from "./agent.mjs";
import { listFiles, readFile, inside } from "./paths.mjs";
import { pickDirectory as nativePickDirectory } from "./folder-picker.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

async function jsonBody(request) {
  const parts = [];
  let length = 0;
  for await (const part of request) {
    length += part.length;
    if (length > 1_000_000)
      throw Object.assign(new Error("Request exceeds the 1 MB limit."), {
        status: 413,
      });
    parts.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function sameToken(actual, expected) {
  const supplied = Buffer.from(typeof actual === "string" ? actual : "");
  const target = Buffer.from(expected);
  return supplied.length === target.length && timingSafeEqual(supplied, target);
}

export async function createRuntime({
  workspace = process.cwd(),
  port = 4318,
  allowedOrigins = [],
  staticDir = path.join(here, "..", "dist"),
  pickDirectory = nativePickDirectory,
} = {}) {
  let root = await fs.realpath(path.resolve(workspace));
  if (!(await fs.stat(root)).isDirectory())
    throw new Error("Workspace must be a directory.");
  let sessionToken = randomBytes(32).toString("hex");
  let folderSelection = null;
  const health = () => ({
    ok: true,
    version: "1.0.0",
    workspace: root,
    sessionToken,
    workspacePicker: true,
    providers: ["ollama", "llamacpp"],
  });
  const configuredOrigins = new Set(
    allowedOrigins.map((origin) => {
      const url = new URL(origin);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.origin !== origin.replace(/\/$/, "")
      )
        throw new Error(
          "Allowed origin must be an exact http(s) origin, for example https://name.github.io.",
        );
      return url.origin;
    }),
  );
  const runs = new Map();
  const approvals = new Map();
  const providerRequests = new Set();
  const providerController = (response) => {
    const controller = new AbortController();
    providerRequests.add(controller);
    response.once("close", () => {
      providerRequests.delete(controller);
      if (!response.writableEnded) controller.abort();
    });
    if (response.destroyed) controller.abort();
    return controller;
  };
  const allowedOrigin = (origin) => {
    if (!origin) return true;
    if (configuredOrigins.has(origin)) return true;
    const actualPort = server.address()?.port;
    return (
      actualPort &&
      [
        `http://127.0.0.1:${actualPort}`,
        `http://localhost:${actualPort}`,
      ].includes(origin)
    );
  };
  const server = http.createServer(async (request, response) => {
    const send = (status, data) => {
      if (!response.headersSent)
        response.writeHead(status, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
      if (!response.writableEnded) response.end(JSON.stringify(data));
    };
    try {
      let host;
      try {
        host = new URL(`http://${request.headers.host}`).hostname;
      } catch {
        host = "";
      }
      if (!["localhost", "127.0.0.1", "[::1]"].includes(host))
        return send(403, { error: "Invalid local bridge Host header." });
      const origin = request.headers.origin;
      if (!allowedOrigin(origin))
        return send(403, {
          error:
            "Origin is not allowed. Start the bridge with --allow-origin followed by the exact website origin.",
        });
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      if (origin) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
      }
      if (request.method === "OPTIONS") {
        response.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, DELETE, OPTIONS",
        );
        response.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, X-Session-Token",
        );
        response.setHeader("Access-Control-Max-Age", "600");
        if (
          request.headers["access-control-request-private-network"] === "true"
        )
          response.setHeader("Access-Control-Allow-Private-Network", "true");
        response.writeHead(204);
        return response.end();
      }
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/api/health" && request.method === "GET")
        return send(200, health());
      if (
        url.pathname.startsWith("/api/") &&
        !sameToken(request.headers["x-session-token"], sessionToken)
      )
        return send(401, {
          error:
            "Local bridge session is missing or expired. Reconnect to the bridge.",
        });
      if (url.pathname === "/api/workspace/pick" && request.method === "POST") {
        const body = await jsonBody(request);
        if (!sameToken(request.headers["x-session-token"], sessionToken))
          return send(401, {
            error: "The workspace session changed. Reconnect to the runtime.",
          });
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).length
        )
          return send(400, {
            error:
              "Folder selection takes no path arguments. Choose a folder in the system dialog.",
          });
        if (folderSelection || runs.size)
          return send(409, {
            error:
              "Finish or stop the current task or folder selection before changing workspaces.",
          });
        const controller = new AbortController();
        folderSelection = controller;
        const disconnected = () => {
          if (!response.writableEnded) controller.abort();
        };
        response.on("close", disconnected);
        try {
          const chosen = await pickDirectory(root, controller.signal);
          if (controller.signal.aborted) return;
          if (chosen === null)
            return send(200, { ...health(), cancelled: true });
          if (typeof chosen !== "string" || !path.isAbsolute(chosen))
            throw new Error("The folder picker did not return a valid folder.");
          const selectedRoot = await fs.realpath(chosen);
          if (!(await fs.stat(selectedRoot)).isDirectory())
            throw new Error("Select a project folder, not a file.");
          if (controller.signal.aborted) return;
          if (selectedRoot !== root) {
            root = selectedRoot;
            sessionToken = randomBytes(32).toString("hex");
          }
          return send(200, { ...health(), cancelled: false });
        } finally {
          response.removeListener("close", disconnected);
          folderSelection = null;
        }
      }
      if (url.pathname === "/api/connect" && request.method === "POST") {
        const config = providerConfig(await jsonBody(request));
        const controller = providerController(response);
        const available = await models(config, controller.signal);
        if (!available.length)
          throw new Error(
            "No models are available. Install or load a tool-capable model in the provider.",
          );
        const model =
          config.model && available.some((item) => item.id === config.model)
            ? config.model
            : available[0].id;
        return send(200, {
          ok: true,
          provider: config.provider,
          baseUrl: config.baseUrl,
          models: available,
          model,
        });
      }
      if (url.pathname === "/api/files" && request.method === "GET")
        return send(
          200,
          await listFiles(root, url.searchParams.get("path") || "."),
        );
      if (url.pathname === "/api/file" && request.method === "GET")
        return send(
          200,
          await readFile(root, url.searchParams.get("path") || ""),
        );
      if (url.pathname === "/api/diagnostics" && request.method === "POST") {
        const config = providerConfig(await jsonBody(request));
        const controller = providerController(response);
        return send(200, await diagnostics(config, controller.signal));
      }
      const approvalId = /^\/api\/approvals\/([^/]+)$/.exec(url.pathname)?.[1];
      if (approvalId && request.method === "POST") {
        const entry = approvals.get(approvalId);
        if (!entry)
          return send(404, { error: "Approval is no longer pending." });
        const body = await jsonBody(request);
        if (typeof body.approved !== "boolean")
          throw new Error("approved must be true or false.");
        approvals.delete(approvalId);
        entry.resolve(body.approved);
        return send(200, { ok: true, approved: body.approved });
      }
      const runId = /^\/api\/runs\/([^/]+)$/.exec(url.pathname)?.[1];
      if (runId && request.method === "DELETE") {
        const run = runs.get(runId);
        if (!run) return send(404, { error: "Run is no longer active." });
        run.controller.abort();
        return send(200, { ok: true, cancelled: true });
      }
      if (url.pathname === "/api/runs" && request.method === "POST") {
        if (runs.size >= 4)
          return send(429, {
            error: "At most four runs may be active at once.",
          });
        const input = await jsonBody(request);
        if (!sameToken(request.headers["x-session-token"], sessionToken))
          return send(401, {
            error: "The workspace session changed. Reconnect to the runtime.",
          });
        if (folderSelection)
          return send(409, {
            error: "Close the folder picker before starting a task.",
          });
        const config = providerConfig(input);
        if (!config.model)
          throw new Error("Select a model before starting a run.");
        const run = buildRun(input, config);
        runs.set(run.id, run);
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        response.flushHeaders();
        const emit = (type, data) => {
          if (!response.destroyed && !response.writableEnded)
            response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        const heartbeat = setInterval(() => {
          if (!response.destroyed) response.write(": keepalive\n\n");
        }, 15_000);
        response.on("close", () => {
          if (!response.writableEnded) run.controller.abort();
        });
        const requestApproval = (activeRun, call, args) =>
          new Promise((resolve, reject) => {
            const id = randomUUID();
            const clear = () => {
              approvals.delete(id);
              activeRun.controller.signal.removeEventListener("abort", abort);
            };
            const abort = () => {
              clear();
              reject(new Error("Run cancelled."));
            };
            approvals.set(id, {
              resolve: (approved) => {
                clear();
                resolve(approved);
              },
            });
            activeRun.controller.signal.addEventListener("abort", abort, {
              once: true,
            });
            emit("approval", {
              id,
              runId: activeRun.id,
              tool: call.name,
              args,
              warning:
                call.name === "run_command"
                  ? "This command runs with your account permissions and can access files outside the workspace."
                  : undefined,
            });
            if (activeRun.controller.signal.aborted) abort();
          });
        try {
          emit("done", await runAgent(run, { root, emit, requestApproval }));
        } catch (error) {
          const cancelled = run.controller.signal.aborted;
          settleInterruptedTools(run, cancelled ? "cancelled" : "error");
          if (!cancelled) emit("error", { message: error.message });
          emit("done", {
            id: run.id,
            state: cancelled ? "cancelled" : "error",
            messages: run.messages.filter((item) => item.role !== "system"),
          });
        } finally {
          clearInterval(heartbeat);
          runs.delete(run.id);
          if (!response.writableEnded) response.end();
        }
        return;
      }
      if (url.pathname.startsWith("/api/"))
        return send(404, { error: "API endpoint not found." });
      if (!["GET", "HEAD"].includes(request.method))
        return send(405, { error: "Method not allowed." });
      let candidate;
      try {
        candidate = path.resolve(
          staticDir,
          `.${decodeURIComponent(url.pathname)}`,
        );
      } catch {
        return send(400, { error: "Invalid path." });
      }
      if (!inside(path.resolve(staticDir), candidate))
        return send(403, { error: "Invalid static path." });
      try {
        if ((await fs.stat(candidate)).isDirectory())
          candidate = path.join(candidate, "index.html");
      } catch {
        if (path.extname(candidate))
          return send(404, { error: "File not found." });
        candidate = path.join(staticDir, "index.html");
      }
      let content;
      try {
        content = await fs.readFile(candidate);
      } catch {
        return send(404, {
          error:
            "Frontend build not found. Run npm run build, then restart the bridge.",
        });
      }
      response.writeHead(200, {
        "Content-Type":
          types[path.extname(candidate)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      return response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      send(error.status || 400, { error: error.message });
    }
  });
  server.requestTimeout = 0;
  return {
    server,
    get workspace() {
      return root;
    },
    get sessionToken() {
      return sessionToken;
    },
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.removeListener("error", reject);
          resolve(server.address());
        });
      }),
    close: () =>
      new Promise((resolve, reject) => {
        folderSelection?.abort();
        for (const controller of providerRequests) controller.abort();
        for (const run of runs.values()) run.controller.abort();
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}

function parseArgs(args) {
  const options = { allowedOrigins: [] };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${flag}.`);
    if (flag === "--workspace") options.workspace = value;
    else if (flag === "--port") {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
        throw new Error("Port must be between 1 and 65535.");
      options.port = Number(value);
    } else if (flag === "--allow-origin" || flag === "--origin")
      options.allowedOrigins.push(value);
    else throw new Error(`Unknown option: ${flag}`);
  }
  return options;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help)
      console.log(
        "Codex Local bridge\n\nnode server/index.mjs [--workspace <directory>] [--port 4318] [--allow-origin https://name.github.io]\n\nBinds to 127.0.0.1. Use Open folder in the app to choose or switch projects.",
      );
    else {
      const runtime = await createRuntime(options);
      const address = await runtime.listen();
      console.log(
        `Codex Local is ready at http://127.0.0.1:${address.port}\nWorkspace: ${runtime.workspace}`,
      );
      for (const signal of ["SIGINT", "SIGTERM"])
        process.once(signal, () => {
          runtime.close().finally(() => process.exit(0));
        });
    }
  } catch (error) {
    console.error(`Codex Local: ${error.message}`);
    process.exitCode = 1;
  }
}
