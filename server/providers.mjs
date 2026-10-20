export function providerConfig(input) {
  if (!input || !["ollama", "llamacpp"].includes(input.provider))
    throw new Error("Provider must be ollama or llamacpp.");
  const defaultUrl =
    input.provider === "ollama"
      ? "http://127.0.0.1:11434"
      : "http://127.0.0.1:8080";
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

async function request(url, { signal, timeout = 120_000, ...options } = {}) {
  const timeoutSignal = AbortSignal.timeout(timeout);
  let response;
  try {
    response = await fetch(url, {
      ...options,
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });
  } catch (error) {
    if (signal?.aborted) throw new Error("Run cancelled.");
    if (timeoutSignal.aborted)
      throw new Error(
        `Provider request timed out after ${timeout / 1000} seconds.`,
      );
    throw new Error(`Cannot reach local provider: ${error.message}`);
  }
  const body = await response.text();
  if (body.length > 5_000_000)
    throw new Error("Provider response exceeds the 5 MB limit.");
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(
      `Provider returned invalid JSON (HTTP ${response.status}).`,
    );
  }
  if (!response.ok || data.error)
    throw new Error(
      `Provider error (${response.status}): ${typeof data.error === "string" ? data.error : data.error?.message || body.slice(0, 400)}`,
    );
  return data;
}

export async function models(config, signal) {
  const endpoint = config.provider === "ollama" ? "/api/tags" : "/v1/models";
  const result = await request(config.baseUrl + endpoint, {
    signal,
    timeout: 15_000,
  });
  const list =
    config.provider === "ollama"
      ? result.models?.map((model) => ({ id: model.name || model.model }))
      : result.data?.map((model) => ({ id: model.id }));
  if (!Array.isArray(list))
    throw new Error("Provider returned an invalid model list.");
  return list.filter((model) => typeof model.id === "string" && model.id);
}

export async function chat(config, messages, tools, signal) {
  if (!config.model) throw new Error("Select a model before starting a run.");
  const payload = {
    model: config.model,
    messages,
    stream: false,
    tools,
    ...(config.provider === "llamacpp"
      ? { tool_choice: "auto", parallel_tool_calls: false, temperature: 0.2 }
      : { options: { temperature: 0.2 } }),
  };
  const endpoint =
    config.provider === "ollama" ? "/api/chat" : "/v1/chat/completions";
  const result = await request(config.baseUrl + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
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
  if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls))
    throw new Error("Provider tool_calls must be an array.");
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
