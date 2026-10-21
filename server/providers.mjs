import { providerRequest as request } from "./transport.mjs";
import { setTimeout as delay } from "node:timers/promises";

export function providerConfig(input) {
  if (!input || !["ollama", "llamacpp"].includes(input.provider))
    throw new Error("Provider must be ollama or llamacpp.");
  const defaultUrl =
    input.provider === "ollama"
      ? "http://127.0.0.1:11434"
      : "http://127.0.0.1:9931";
  let url;
  try {
    url = new URL(input.baseUrl || defaultUrl);
  } catch {
    throw new Error("Enter a valid provider base URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Provider URL must use a loopback host (localhost, 127.0.0.1, or ::1), without credentials or query parameters.",
    );
  const pathname = url.pathname.replace(/\/$/, "");
  if (pathname && pathname !== "/v1")
    throw new Error("Provider base URL may have only an optional /v1 suffix.");
  url.pathname = "";
  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (model.length > 300) throw new Error("Model name is too long.");
  return {
    provider: input.provider,
    baseUrl: url.href.replace(/\/$/, ""),
    model,
  };
}

async function providerRequest(config, endpoint, options = {}, onWaiting) {
  let reportedLoading = false;
  for (;;) {
    try {
      return await request(config.baseUrl + endpoint, options);
    } catch (error) {
      if (options.signal?.aborted) throw new Error("Run cancelled.");
      // A documented loading response means generation has not started. Never
      // replay requests after connection loss or other ambiguous failures.
      if (
        config.provider === "llamacpp" &&
        error.status === 503 &&
        /loading model|model (?:is )?loading/i.test(error.providerMessage || "")
      ) {
        if (!reportedLoading) {
          onWaiting?.();
          reportedLoading = true;
        }
        try {
          await delay(800, undefined, { signal: options.signal });
        } catch {
          throw new Error("Run cancelled.");
        }
        continue;
      }
      if (
        config.provider === "llamacpp" &&
        ["ECONNREFUSED", "ENOTFOUND"].includes(error.code)
      ) {
        throw new Error(
          `llama.cpp is not reachable at ${config.baseUrl}. Start llama-server with your GGUF, --jinja, and the port in this URL. Keep the server running, then reconnect.`,
          { cause: error },
        );
      }
      throw error;
    }
  }
}

export async function models(config, signal) {
  const endpoint = config.provider === "ollama" ? "/api/tags" : "/v1/models";
  const result = await providerRequest(config, endpoint, {
    signal,
  });
  const list =
    config.provider === "ollama"
      ? result.models?.map((model) => ({ id: model.name || model.model }))
      : result.data?.map((model) => ({ id: model.id }));
  if (!Array.isArray(list))
    throw new Error("Provider returned an invalid model list.");
  return list.filter((model) => typeof model.id === "string" && model.id);
}

export async function chat(
  config,
  messages,
  tools,
  signal,
  { onWaiting } = {},
) {
  if (!config.model) throw new Error("Select a model before starting a run.");
  const payload = {
    model: config.model,
    messages,
    stream: false,
    tools,
    ...(config.provider === "llamacpp"
      ? {
          tool_choice: "auto",
          parallel_tool_calls: false,
          temperature: 0.2,
        }
      : { options: { temperature: 0.2 } }),
  };
  const endpoint =
    config.provider === "ollama" ? "/api/chat" : "/v1/chat/completions";
  const result = await providerRequest(
    config,
    endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    },
    onWaiting,
  );
  const message =
    config.provider === "ollama"
      ? result.message
      : result.choices?.[0]?.message;
  if (
    result.choices?.[0]?.finish_reason === "length" ||
    result.done_reason === "length"
  )
    throw new Error(
      "Model response reached its generation limit. Increase the provider output/context limit and try a smaller task. No partial tool calls were executed.",
    );
  if (!message || typeof message !== "object" || Array.isArray(message))
    throw new Error("Provider did not return an assistant message.");
  if (message.tool_calls != null && !Array.isArray(message.tool_calls))
    throw new Error("Provider tool_calls must be an array.");
  if (message.tool_calls == null) delete message.tool_calls;
  if (config.provider === "llamacpp" && message.tool_calls) {
    // Older llama.cpp releases returned flat {name, arguments} tool entries.
    message.tool_calls = message.tool_calls.map((call) =>
      call && !call.function && typeof call.name === "string"
        ? { ...call, function: { name: call.name, arguments: call.arguments } }
        : call,
    );
  }
  if (
    message.content !== undefined &&
    message.content !== null &&
    typeof message.content !== "string"
  )
    throw new Error("Provider message content must be text.");
  return message;
}

export function assistantHistory(provider, message, calls) {
  return {
    role: "assistant",
    content: message.content || "",
    ...(provider === "ollama" && typeof message.thinking === "string"
      ? { thinking: message.thinking }
      : {}),
    ...(provider === "llamacpp" && typeof message.reasoning_content === "string"
      ? { reasoning_content: message.reasoning_content }
      : {}),
    ...(calls.length
      ? {
          tool_calls: calls.map((call) => ({
            ...(provider === "llamacpp"
              ? { id: call.id, type: "function" }
              : {}),
            function: {
              name: call.name,
              arguments:
                provider === "ollama"
                  ? call.historyArgs
                  : typeof call.originalArgs === "string"
                    ? call.originalArgs
                    : JSON.stringify(call.originalArgs ?? {}),
            },
          })),
        }
      : {}),
  };
}

export function toolHistory(provider, call, result) {
  return {
    role: "tool",
    ...(provider === "ollama"
      ? { tool_name: call.name }
      : { tool_call_id: call.id }),
    content: JSON.stringify(result),
  };
}
