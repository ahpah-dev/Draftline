import http from "node:http";
import https from "node:https";

// Local inference may be silent while loading a model or generating a response.
// Use Node's transport directly: fetch also imposes header/body deadlines.
export function providerRequest(
  url,
  { signal, method = "GET", headers = {}, body } = {},
) {
  return new Promise((resolve, reject) => {
    let response;
    let settled = false;
    const finish = (error, data) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (error) {
        reject(error);
        response?.destroy();
        outgoing.destroy();
      } else resolve(data);
    };
    const abort = () => finish(new Error("Run cancelled."));
    const transport = new URL(url).protocol === "https:" ? https : http;
    const outgoing = transport.request(
      url,
      {
        method,
        headers: {
          ...headers,
          ...(body === undefined
            ? {}
            : { "Content-Length": Buffer.byteLength(body) }),
        },
        timeout: 0,
        agent: false,
      },
      (incoming) => {
        response = incoming;
        if (incoming.statusCode >= 300 && incoming.statusCode < 400) {
          finish(
            new Error(
              "Local provider redirects are not allowed. Use its direct loopback URL.",
            ),
          );
          return;
        }
        const chunks = [];
        let bytes = 0;
        incoming.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 5_000_000) {
            finish(new Error("Provider response exceeds the 5 MB limit."));
            return;
          }
          chunks.push(chunk);
        });
        incoming.on("error", (error) =>
          finish(
            new Error(`Provider connection interrupted: ${error.message}`),
          ),
        );
        incoming.on("end", () => {
          if (settled) return;
          const text = Buffer.concat(chunks).toString("utf8");
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            finish(
              new Error(
                `Provider returned invalid JSON (HTTP ${incoming.statusCode}).`,
              ),
            );
            return;
          }
          if (!data || typeof data !== "object") {
            finish(new Error("Provider returned an invalid JSON response."));
            return;
          }
          if (
            incoming.statusCode < 200 ||
            incoming.statusCode >= 300 ||
            data.error
          ) {
            finish(
              new Error(
                `Provider error (${incoming.statusCode}): ${typeof data.error === "string" ? data.error : data.error?.message || text.slice(0, 400)}`,
              ),
            );
            return;
          }
          finish(null, data);
        });
      },
    );
    outgoing.on("error", (error) =>
      finish(new Error(`Cannot reach local provider: ${error.message}`)),
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    else outgoing.end(body);
  });
}
