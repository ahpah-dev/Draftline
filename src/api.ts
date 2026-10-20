import type { Health, Settings } from "./types";
export async function request<T>(
  runtime: string,
  path: string,
  token = "",
  body?: unknown,
  method?: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${runtime.replace(/\/$/, "")}${path}`, {
    method: method || (body === undefined ? "GET" : "POST"),
    signal,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { "X-Session-Token": token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error || data.message || `Runtime returned ${response.status}`,
    );
  return data as T;
}
export function health(settings: Settings, signal?: AbortSignal) {
  return request<Health>(
    settings.runtimeUrl,
    "/api/health",
    "",
    undefined,
    undefined,
    signal,
  );
}
export async function streamRun(
  settings: Settings,
  token: string,
  payload: unknown,
  signal: AbortSignal,
  onEvent: (event: string, data: Record<string, unknown>) => void,
) {
  const response = await fetch(
    `${settings.runtimeUrl.replace(/\/$/, "")}/api/runs`,
    {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "X-Session-Token": token },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const data = await response.json();
    throw new Error(
      data.error || data.message || `Runtime returned ${response.status}`,
    );
  }
  if (!response.body)
    throw new Error("This browser does not support response streaming.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;
  try {
    while (true) {
      const result = await reader.read();
      buffer += decoder
        .decode(result.value, { stream: !result.done })
        .replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const type =
          block
            .split("\n")
            .find((line) => line.startsWith("event:"))
            ?.slice(6)
            .trim() || "message";
        const raw = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (raw) {
          const data = JSON.parse(raw);
          onEvent(type, data);
          if (type === "done" || type === "error") ended = true;
        }
      }
      if (result.done) break;
    }
    if (!ended)
      throw new Error(
        "The connection closed before the run finished. Check the runtime and retry.",
      );
  } finally {
    reader.releaseLock();
  }
}
