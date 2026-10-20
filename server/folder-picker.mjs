import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

function execute(command, args, { signal, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        signal,
        env,
        windowsHide: true,
        maxBuffer: 64 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (signal?.aborted)
          return reject(
            new DOMException("Folder selection cancelled.", "AbortError"),
          );
        if (error) {
          error.detail = stderr.trim();
          return reject(error);
        }
        resolve(stdout);
      },
    );
  });
}

// Only called by a session-authenticated, user-initiated request. The path comes
// from the operating system's dialog, never from a model or request argument.
export async function pickDirectory(initialPath, signal) {
  if (process.platform === "win32") {
    const script = fileURLToPath(
      new URL("./native-folder-picker.ps1", import.meta.url),
    );
    try {
      const command = Buffer.from(
        await fs.readFile(script, "utf8"),
        "utf16le",
      ).toString("base64");
      const output = await execute(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-STA",
          "-EncodedCommand",
          command,
        ],
        {
          signal,
          env: { ...process.env, CODEX_LOCAL_PICKER_INITIAL: initialPath },
        },
      );
      const result = JSON.parse(output.replace(/^\uFEFF/, "").trim());
      return result.cancelled ? null : result.path;
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new Error(
        `The Windows folder picker could not open. ${error.detail || error.message}`,
      );
    }
  }
  if (process.platform === "darwin") {
    try {
      return (
        await execute(
          "osascript",
          [
            "-e",
            'POSIX path of (choose folder with prompt "Open project folder")',
          ],
          { signal },
        )
      ).trim();
    } catch (error) {
      if (error.detail?.includes("(-128)")) return null;
      throw error;
    }
  }
  for (const [command, args] of [
    [
      "zenity",
      [
        "--file-selection",
        "--directory",
        "--title=Open project folder",
        `--filename=${initialPath}/`,
      ],
    ],
    [
      "kdialog",
      ["--getexistingdirectory", initialPath, "--title", "Open project folder"],
    ],
  ]) {
    try {
      return (await execute(command, args, { signal })).trim() || null;
    } catch (error) {
      if (error.name === "AbortError") throw error;
      if (error.code === 1) return null;
      if (error.code !== "ENOENT")
        throw new Error(
          `The desktop folder picker could not open. ${error.detail || error.message}`,
        );
    }
  }
  throw new Error(
    "No desktop folder picker is installed. Install zenity or kdialog, or start the runtime with --workspace /path/to/project.",
  );
}
