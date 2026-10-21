import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function pickLocalFile(kind, signal) {
  const title = kind === "engine" ? "Choose llama-server" : "Open GGUF model";
  const run = (command, args, env, allowCancel = false) =>
    new Promise((resolve, reject) => {
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
          if (signal?.aborted) return reject(new Error("Selection cancelled."));
          if ((allowCancel && error?.code === 1) || stderr?.includes("(-128)"))
            return resolve(null);
          if (error)
            return reject(
              new Error(
                `The file picker could not open: ${stderr?.trim() || error.message}`,
              ),
            );
          resolve(stdout.trim() || null);
        },
      );
    });
  if (process.platform === "win32") {
    const source = await fs.readFile(
      fileURLToPath(new URL("./native-file-picker.ps1", import.meta.url)),
      "utf8",
    );
    const result = await run(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-STA",
        "-EncodedCommand",
        Buffer.from(source, "utf16le").toString("base64"),
      ],
      { ...process.env, DRAFTLINE_PICK_KIND: kind },
    );
    return result ? JSON.parse(result).path : null;
  }
  if (process.platform === "darwin")
    return run("osascript", [
      "-e",
      `POSIX path of (choose file with prompt "${title}")`,
    ]);
  try {
    return await run(
      "zenity",
      [
        "--file-selection",
        `--title=${title}`,
        ...(kind === "model" ? ["--file-filter=GGUF models | *.gguf"] : []),
      ],
      undefined,
      true,
    );
  } catch (error) {
    if (!/ENOENT/.test(error.message)) throw error;
    return run(
      "kdialog",
      [
        "--getopenfilename",
        ".",
        kind === "model" ? "*.gguf" : "*",
        "--title",
        title,
      ],
      undefined,
      true,
    );
  }
}
