import path from "node:path";
import { spawn, execFile } from "node:child_process";
import {
  listFiles,
  readFile,
  searchFiles,
  writeFile,
  workspacePath,
} from "./paths.mjs";

const string = (description) => ({ type: "string", description });
const definitions = [
  [
    "list_files",
    "List files in a workspace directory.",
    { path: string("Relative directory path; defaults to .") },
    [],
  ],
  [
    "read_file",
    "Read a UTF-8 text file from the workspace.",
    { path: string("Relative file path") },
    ["path"],
  ],
  [
    "search_files",
    "Search text literally, case-insensitively across workspace files.",
    {
      query: string("Literal text to find"),
      path: string("Relative directory path; defaults to ."),
    },
    ["query"],
  ],
  [
    "write_file",
    "Create or replace one UTF-8 text file. Requires user approval for every call.",
    {
      path: string("Relative file path"),
      content: string("Complete replacement file contents"),
    },
    ["path", "content"],
  ],
  [
    "run_command",
    "Run a shell command in the workspace. Requires user approval for every call. Commands can access the full local computer; keep commands focused on this project.",
    {
      command: string("Exact shell command"),
      cwd: string("Relative working directory; defaults to ."),
    },
    ["command"],
  ],
];

export const schemas = definitions.map(
  ([name, description, properties, required]) => ({
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
  }),
);
export const mutationTools = new Set(["write_file", "run_command"]);

export function toolsFor(mode) {
  return schemas.filter(
    (tool) => mode === "agent" || !mutationTools.has(tool.function.name),
  );
}

export function validateArgs(name, raw, mode) {
  const schema = toolsFor(mode).find((tool) => tool.function.name === name)
    ?.function.parameters;
  if (!schema)
    throw new Error(
      `Tool ${name || "(missing name)"} is not available in ${mode} mode.`,
    );
  let args = raw;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      throw new Error(
        "Tool arguments must be valid JSON. Return the call again with a JSON object.",
      );
    }
  }
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new Error("Tool arguments must be a JSON object.");
  for (const key of schema.required)
    if (!(key in args)) throw new Error(`Missing required argument: ${key}.`);
  for (const [key, value] of Object.entries(args)) {
    if (!Object.hasOwn(schema.properties, key))
      throw new Error(`Unknown argument: ${key}.`);
    if (typeof value !== "string")
      throw new Error(`Argument ${key} must be a string.`);
    if (value.includes("\0"))
      throw new Error(`Argument ${key} contains a null byte.`);
  }
  if (args.path !== undefined && !args.path.trim())
    throw new Error("Path may not be empty.");
  if (
    args.query !== undefined &&
    (!args.query.trim() || args.query.length > 300)
  )
    throw new Error("Search query must contain 1–300 characters.");
  if (
    args.command !== undefined &&
    (!args.command.trim() || args.command.length > 4000)
  )
    throw new Error("Command must contain 1–4,000 characters.");
  if (
    args.content !== undefined &&
    Buffer.byteLength(args.content) > 512 * 1024
  )
    throw new Error("Write exceeds the 512 KB limit.");
  return args;
}

async function runCommand(root, args, signal) {
  const cwd = await workspacePath(root, args.cwd || ".");
  return new Promise((resolve, reject) => {
    const child = spawn(args.command, {
      cwd,
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    const collect = (which) => (data) => {
      const current = which === "stdout" ? stdout : stderr;
      if (current.length >= 128_000) {
        truncated = true;
        return;
      }
      if (which === "stdout")
        stdout += data.toString().slice(0, 128_000 - current.length);
      else stderr += data.toString().slice(0, 128_000 - current.length);
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === "win32")
        execFile(
          "taskkill",
          ["/pid", String(child.pid), "/T", "/F"],
          { windowsHide: true },
          () => {},
        );
      else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    signal?.addEventListener("abort", stop, { once: true });
    const cleanup = () => {
      signal?.removeEventListener("abort", stop);
    };
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code, terminationSignal) => {
      cleanup();
      resolve({
        command: args.command,
        cwd: path.relative(root, cwd) || ".",
        exitCode: code,
        stdout,
        stderr,
        timedOut: false,
        cancelled: Boolean(signal?.aborted),
        signal: terminationSignal,
        truncated,
      });
    });
    if (signal?.aborted) stop();
  });
}

export async function executeTool(root, name, args, signal) {
  if (signal?.aborted) throw new Error("Run cancelled.");
  switch (name) {
    case "list_files":
      return listFiles(root, args.path || ".");
    case "read_file":
      return readFile(root, args.path);
    case "search_files":
      return searchFiles(root, args.query, args.path || ".");
    case "write_file":
      return writeFile(root, args.path, args.content);
    case "run_command":
      return runCommand(root, args, signal);
    default:
      throw new Error(`Unknown tool: ${name}.`);
  }
}
