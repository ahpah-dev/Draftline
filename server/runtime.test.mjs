import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRuntime } from "./index.mjs";
import { workspacePath, writeFile } from "./paths.mjs";
import { providerConfig } from "./providers.mjs";

async function fixture(t, provider, reply) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-local-test-"));
  await fs.writeFile(path.join(root, "hello.txt"), "hello workspace\n");
  const requests = [];
  const mock = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = body ? JSON.parse(body) : {};
    requests.push({ path: req.url, input });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/tags")
      return res.end(
        JSON.stringify({ models: [{ name: "local-tool-model" }] }),
      );
    if (req.url === "/v1/models")
      return res.end(JSON.stringify({ data: [{ id: "local-tool-model" }] }));
    try {
      const output = await reply(input, requests);
      res.end(
        JSON.stringify(
          provider === "ollama"
            ? { message: output }
            : {
                choices: [
                  {
                    message: output,
                    finish_reason: output.tool_calls?.length
                      ? "tool_calls"
                      : "stop",
                  },
                ],
              },
        ),
      );
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const runtime = await createRuntime({
    workspace: root,
    port: 0,
    allowedOrigins: ["https://example.github.io"],
  });
  const address = await runtime.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const config = {
    provider,
    baseUrl: `http://127.0.0.1:${mock.address().port}`,
    model: "local-tool-model",
  };
  const headers = {
    "Content-Type": "application/json",
    "X-Session-Token": runtime.sessionToken,
  };
  const api = (url, options = {}) =>
    fetch(base + url, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
  t.after(async () => {
    await runtime.close();
    await new Promise((resolve) => mock.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, base, config, api, requests, runtime };
}

async function run(f, input = {}, onEvent) {
  const response = await f.api("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      ...f.config,
      prompt: "Inspect the workspace",
      mode: "ask",
      ...input,
    }),
  });
  assert.equal(
    response.status,
    200,
    await (response.status === 200 ? Promise.resolve("") : response.text()),
  );
  const events = [];
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const part = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const type = /^event: (.+)$/m.exec(part)?.[1];
      const data = /^data: (.+)$/m.exec(part)?.[1];
      if (!type || !data) continue;
      const event = { type, data: JSON.parse(data) };
      events.push(event);
      await onEvent?.(event);
    }
  }
  return events;
}

for (const provider of ["ollama", "llamacpp"]) {
  test(`${provider}: native tool history, model discovery, and full conversation resume`, async (t) => {
    let count = 0;
    const f = await fixture(t, provider, (input) => {
      assert.equal(input.stream, false);
      assert.ok(input.tools.some((tool) => tool.function.name === "read_file"));
      assert.ok(
        !input.tools.some((tool) => tool.function.name === "write_file"),
      );
      if (count++ === 0)
        return {
          role: "assistant",
          content: "Reading the file.",
          tool_calls: [
            {
              id: "original-call-77",
              type: "function",
              function: {
                name: "read_file",
                arguments:
                  provider === "ollama"
                    ? { path: "hello.txt" }
                    : '{"path":"hello.txt"}',
              },
            },
          ],
        };
      const tool = input.messages.findLast(
        (message) => message.role === "tool",
      );
      assert.ok(JSON.parse(tool.content).content.includes("hello workspace"));
      if (provider === "ollama") {
        assert.equal(tool.tool_name, "read_file");
        assert.equal(tool.tool_call_id, undefined);
      } else {
        assert.equal(tool.tool_call_id, "original-call-77");
        assert.equal(
          typeof input.messages.find((message) => message.tool_calls)
            ?.tool_calls[0].function.arguments,
          "string",
        );
      }
      return {
        role: "assistant",
        content: "The file contains hello workspace.",
      };
    });
    const connection = await f.api("/api/connect", {
      method: "POST",
      body: JSON.stringify(f.config),
    });
    assert.deepEqual((await connection.json()).models, [
      { id: "local-tool-model" },
    ]);
    const events = await run(f);
    assert.ok(
      events.some(
        (event) => event.type === "tool" && event.data.state === "completed",
      ),
    );
    const done = events.find((event) => event.type === "done").data;
    assert.equal(done.state, "completed");
    assert.ok(done.messages.some((message) => message.role === "tool"));
    const resumed = await run(f, {
      prompt: "Continue from the previous result.",
      messages: done.messages,
    });
    assert.equal(
      resumed.find((event) => event.type === "done").data.state,
      "completed",
    );
  });

  test(`${provider}: diagnostic verifies actual native call and tool-result consumption`, async (t) => {
    let round = 0;
    const f = await fixture(t, provider, (input) => {
      if (round++ === 0) {
        const value = /value "([^"]+)"/.exec(input.messages[1].content)[1];
        return {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "echo-call",
              type: "function",
              function: {
                name: "diagnostic_echo",
                arguments:
                  provider === "ollama" ? { value } : JSON.stringify({ value }),
              },
            },
          ],
        };
      }
      const value = JSON.parse(input.messages.at(-1).content).value;
      if (provider === "llamacpp")
        assert.equal(input.messages.at(-1).tool_call_id, "echo-call");
      else assert.equal(input.messages.at(-1).tool_name, "diagnostic_echo");
      return { role: "assistant", content: value };
    });
    const response = await f.api("/api/diagnostics", {
      method: "POST",
      body: JSON.stringify(f.config),
    });
    const report = await response.json();
    assert.equal(report.ok, true);
    assert.equal(report.checks.length, 2);
  });
}

test("llamacpp: null optional tool_calls is a valid completed assistant response", async (t) => {
  const f = await fixture(t, "llamacpp", () => ({
    role: "assistant",
    content: "Ready to code.",
    tool_calls: null,
  }));
  const events = await run(f);
  assert.equal(events.at(-1).data.state, "completed");
  assert.equal(events.at(-1).data.messages.at(-1).content, "Ready to code.");
});

test("llamacpp: legacy flat native calls preserve IDs and complete the tool round-trip", async (t) => {
  let count = 0;
  const f = await fixture(t, "llamacpp", (input) => {
    if (count++ === 0)
      return {
        content: null,
        tool_calls: [
          {
            id: "legacy-native",
            name: "read_file",
            arguments: '{"path":"hello.txt"}',
          },
        ],
      };
    assert.equal(input.messages.at(-1).tool_call_id, "legacy-native");
    assert.match(
      JSON.parse(input.messages.at(-1).content).content,
      /hello workspace/,
    );
    return { content: "Read successfully.", tool_calls: null };
  });
  const events = await run(f);
  assert.equal(events.at(-1).data.state, "completed");
  assert.ok(
    events.some(
      ({ type, data }) => type === "tool" && data.state === "completed",
    ),
  );
});

test("malformed tool JSON and file failures return structured error feedback to the model", async (t) => {
  let count = 0;
  const f = await fixture(t, "llamacpp", (input) => {
    const iteration = count++;
    if (iteration === 0)
      return {
        content: "",
        tool_calls: [
          {
            id: "bad-json",
            function: { name: "read_file", arguments: "{broken" },
          },
        ],
      };
    if (iteration === 1) {
      assert.match(
        JSON.parse(input.messages.at(-1).content).error,
        /valid JSON/,
      );
      return {
        content: "",
        tool_calls: [
          {
            id: "missing-file",
            function: {
              name: "read_file",
              arguments: '{"path":"missing.txt"}',
            },
          },
        ],
      };
    }
    assert.match(JSON.parse(input.messages.at(-1).content).error, /ENOENT/);
    return { content: "The requested file does not exist." };
  });
  const events = await run(f);
  assert.equal(
    events.filter(
      (event) => event.type === "tool" && event.data.state === "error",
    ).length,
    2,
  );
  assert.ok(
    events
      .filter((event) => event.type === "tool")
      .every(
        (event) =>
          event.data.args &&
          typeof event.data.args === "object" &&
          !Array.isArray(event.data.args),
      ),
  );
  assert.equal(events.at(-1).data.state, "completed");
});

test("writes require an individual approval even when approved:true is supplied to the run", async (t) => {
  let count = 0;
  const f = await fixture(t, "ollama", () =>
    count++ === 0
      ? {
          content: "",
          tool_calls: [
            {
              function: {
                name: "write_file",
                arguments: {
                  path: "nested/result.txt",
                  content: "approved change",
                },
              },
            },
          ],
        }
      : { content: "Saved the approved file." },
  );
  let approvals = 0;
  const events = await run(
    f,
    { mode: "agent", approved: true },
    async (event) => {
      if (event.type !== "approval") return;
      approvals++;
      await assert.rejects(fs.readFile(path.join(f.root, "nested/result.txt")));
      assert.equal(event.data.tool, "write_file");
      const approved = await f.api(`/api/approvals/${event.data.id}`, {
        method: "POST",
        body: '{"approved":true}',
      });
      assert.equal(approved.status, 200);
    },
  );
  assert.equal(approvals, 1);
  assert.equal(
    await fs.readFile(path.join(f.root, "nested/result.txt"), "utf8"),
    "approved change",
  );
  assert.equal(events.at(-1).data.state, "completed");
});

test("approval remains pending beyond ten minutes and still requires a decision", async (t) => {
  let count = 0;
  const f = await fixture(t, "ollama", () =>
    count++ === 0
      ? {
          content: "",
          tool_calls: [
            {
              function: {
                name: "write_file",
                arguments: { path: "waiting.txt", content: "approved later" },
              },
            },
          ],
        }
      : { content: "Saved after approval." },
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events = await run(f, { mode: "agent" }, async (event) => {
    if (event.type !== "approval") return;
    t.mock.timers.tick(600_001);
    await assert.rejects(fs.readFile(path.join(f.root, "waiting.txt")));
    const approved = await f.api(`/api/approvals/${event.data.id}`, {
      method: "POST",
      body: '{"approved":true}',
    });
    assert.equal(approved.status, 200);
  });
  assert.equal(events.at(-1).data.state, "completed");
  assert.equal(
    await fs.readFile(path.join(f.root, "waiting.txt"), "utf8"),
    "approved later",
  );
});

test("denied write is reported to the model and leaves the workspace unchanged", async (t) => {
  let count = 0;
  const f = await fixture(t, "llamacpp", (input) => {
    if (count++ === 0)
      return {
        content: "",
        tool_calls: [
          {
            id: "deny-write",
            function: {
              name: "write_file",
              arguments: '{"path":"hello.txt","content":"bad"}',
            },
          },
        ],
      };
    assert.equal(JSON.parse(input.messages.at(-1).content).denied, true);
    return { content: "The file was left unchanged." };
  });
  await run(f, { mode: "agent" }, async (event) => {
    if (event.type === "approval")
      await f.api(`/api/approvals/${event.data.id}`, {
        method: "POST",
        body: '{"approved":false}',
      });
  });
  assert.equal(
    await fs.readFile(path.join(f.root, "hello.txt"), "utf8"),
    "hello workspace\n",
  );
});

test("ask mode rejects a model attempting a mutation", async (t) => {
  let count = 0;
  const f = await fixture(t, "ollama", () =>
    count++ === 0
      ? {
          content: "",
          tool_calls: [
            {
              function: {
                name: "write_file",
                arguments: { path: "hello.txt", content: "bad" },
              },
            },
          ],
        }
      : { content: "Ask mode is read-only." },
  );
  const events = await run(f);
  assert.ok(!events.some((event) => event.type === "approval"));
  assert.match(
    events.find((event) => event.type === "tool").data.result.error,
    /not available in ask/,
  );
  assert.equal(
    await fs.readFile(path.join(f.root, "hello.txt"), "utf8"),
    "hello workspace\n",
  );
});

test("cancellation clears a pending approval without executing the tool", async (t) => {
  const f = await fixture(t, "ollama", () => ({
    content: "",
    tool_calls: [
      {
        function: {
          name: "write_file",
          arguments: { path: "cancelled.txt", content: "bad" },
        },
      },
    ],
  }));
  let pending;
  const events = await run(f, { mode: "agent" }, async (event) => {
    if (event.type === "approval") {
      pending = event.data.id;
      await f.api(`/api/runs/${event.data.runId}`, { method: "DELETE" });
    }
  });
  assert.equal(events.at(-1).data.state, "cancelled");
  await assert.rejects(fs.readFile(path.join(f.root, "cancelled.txt")));
  assert.equal(
    (
      await f.api(`/api/approvals/${pending}`, {
        method: "POST",
        body: '{"approved":true}',
      })
    ).status,
    404,
  );
});

test("duplicate native IDs fail before tools execute", async (t) => {
  const f = await fixture(t, "llamacpp", () => ({
    content: "",
    tool_calls: [1, 2].map((index) => ({
      id: "same-id",
      function: {
        name: "write_file",
        arguments: JSON.stringify({ path: `file-${index}`, content: "bad" }),
      },
    })),
  }));
  const events = await run(f, { mode: "agent" });
  assert.match(
    events.find((event) => event.type === "error").data.message,
    /duplicate tool call IDs/,
  );
  assert.ok(!events.some((event) => event.type === "approval"));
});

test("security: origin allowlist, session token, and confined traversal", async (t) => {
  const f = await fixture(t, "ollama", () => ({ content: "OK" }));
  assert.equal(
    (
      await fetch(f.base + "/api/health", {
        headers: { Origin: "https://attacker.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(f.base + "/api/health", {
        headers: { Origin: "http://localhost:59999" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(f.base + "/api/health", {
        headers: { Origin: "http://127.0.0.1:5173" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(f.base + "/api/health", { headers: { Origin: f.base } }))
      .status,
    200,
  );
  assert.equal(
    (
      await fetch(f.base + "/api/health", {
        headers: { Origin: "https://example.github.io" },
      })
    ).headers.get("access-control-allow-origin"),
    "https://example.github.io",
  );
  assert.equal((await fetch(f.base + "/api/files")).status, 401);
  assert.equal((await f.api("/api/file?path=../outside.txt")).status, 400);
  assert.equal(
    (await f.api("/api/file?path=C:%5CWindows%5Cwin.ini")).status,
    400,
  );
  assert.equal((await f.api("/api/file?path=hello.txt")).status, 200);
  const preflight = await f.api("/api/runs", {
    method: "OPTIONS",
    headers: {
      Origin: "https://example.github.io",
      "Access-Control-Request-Private-Network": "true",
    },
  });
  assert.equal(
    preflight.headers.get("access-control-allow-private-network"),
    "true",
  );
});

test("security: external symlink and junction paths cannot be read or written", async (t) => {
  const f = await fixture(t, "ollama", () => ({ content: "OK" }));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "codex-outside-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, "secret.txt"), "outside");
  try {
    await fs.symlink(
      outside,
      path.join(f.root, "link"),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error.code === "EPERM") return t.skip("Symlink privilege unavailable");
    throw error;
  }
  await assert.rejects(
    workspacePath(f.root, "link/secret.txt"),
    /outside the workspace/,
  );
  await assert.rejects(
    writeFile(f.root, "link/new.txt", "bad"),
    /outside the workspace/,
  );
});

test("security: dangling symlinks cannot redirect writes to missing outside targets", async (t) => {
  const f = await fixture(t, "ollama", () => ({ content: "OK" }));
  const outside = await fs.mkdtemp(
    path.join(os.tmpdir(), "codex-outside-missing-"),
  );
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const missing = path.join(outside, "not-yet-existing.txt");
  try {
    await fs.symlink(missing, path.join(f.root, "new.txt"), "file");
  } catch (error) {
    if (error.code === "EPERM")
      return t.skip("File symlink privilege unavailable");
    throw error;
  }
  await assert.rejects(
    writeFile(f.root, "new.txt", "must stay inside"),
    /dangling symbolic link/,
  );
  await assert.rejects(fs.readFile(missing));
});

test("security: a dangling directory junction is rejected before creating missing parents", async (t) => {
  const f = await fixture(t, "ollama", () => ({ content: "OK" }));
  const outside = await fs.mkdtemp(
    path.join(os.tmpdir(), "codex-dangling-parent-"),
  );
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const missing = path.join(outside, "missing-directory");
  try {
    await fs.symlink(
      missing,
      path.join(f.root, "dangling-parent"),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error.code === "EPERM")
      return t.skip("Directory symlink privilege unavailable");
    throw error;
  }
  await assert.rejects(
    writeFile(f.root, "dangling-parent/nested/new.txt", "must stay inside"),
    /dangling symbolic link/,
  );
  await assert.rejects(fs.stat(missing));
});

test("provider URLs reject remote hosts, credentials, arbitrary paths, and redirects", () => {
  for (const baseUrl of [
    "http://example.com",
    "http://127.0.0.1.evil.com",
    "file:///tmp",
    "http://user:password@localhost",
    "http://localhost/proxy",
  ])
    assert.throws(() => providerConfig({ provider: "ollama", baseUrl }));
  assert.equal(
    providerConfig({
      provider: "llamacpp",
      baseUrl: "http://localhost:8080/v1",
    }).baseUrl,
    "http://localhost:8080",
  );
});

test("approved commands return real exit status and output to the provider", async (t) => {
  let count = 0;
  const command = `"${process.execPath}" -e "console.log('command-output'); process.exit(3)"`;
  const f = await fixture(t, "llamacpp", (input) => {
    if (count++ === 0)
      return {
        content: "",
        tool_calls: [
          {
            id: "command-id",
            function: {
              name: "run_command",
              arguments: JSON.stringify({ command }),
            },
          },
        ],
      };
    const result = JSON.parse(input.messages.at(-1).content);
    assert.equal(result.exitCode, 3);
    assert.match(result.stdout, /command-output/);
    return { content: "The command returned exit code 3." };
  });
  const events = await run(f, { mode: "agent" }, async (event) => {
    if (event.type === "approval") {
      assert.equal(event.data.args.command, command);
      assert.match(event.data.warning, /account permissions/);
      await f.api(`/api/approvals/${event.data.id}`, {
        method: "POST",
        body: '{"approved":true}',
      });
    }
  });
  assert.equal(events.at(-1).data.state, "completed");
});

test("repeated native ID replays the prior result without repeating a mutation", async (t) => {
  let count = 0;
  const f = await fixture(t, "llamacpp", () =>
    count++ < 2
      ? {
          content: "",
          tool_calls: [
            {
              id: "stable-write-id",
              function: {
                name: "write_file",
                arguments: '{"path":"result.txt","content":"only once"}',
              },
            },
          ],
        }
      : { content: "Done." },
  );
  let approvals = 0;
  const events = await run(f, { mode: "agent" }, async (event) => {
    if (event.type === "approval") {
      approvals++;
      await f.api(`/api/approvals/${event.data.id}`, {
        method: "POST",
        body: '{"approved":true}',
      });
    }
  });
  assert.equal(approvals, 1);
  assert.equal(
    events.filter(
      (event) => event.type === "tool" && event.data.state === "running",
    ).length,
    1,
  );
  assert.equal(
    await fs.readFile(path.join(f.root, "result.txt"), "utf8"),
    "only once",
  );
});

test("a model that repeatedly requests invalid tools stops at the bounded turn limit", async (t) => {
  let count = 0;
  const f = await fixture(t, "ollama", () => ({
    content: "",
    tool_calls: [
      {
        id: `bad-${count++}`,
        function: { name: "imaginary_tool", arguments: {} },
      },
    ],
  }));
  const events = await run(f);
  assert.equal(count, 20);
  assert.match(
    events.find((event) => event.type === "error").data.message,
    /20-turn limit/,
  );
  assert.equal(events.at(-1).data.state, "error");
});

test("unsupported native tool behavior yields an actionable diagnostic failure", async (t) => {
  const f = await fixture(t, "ollama", () => ({
    content: '<tool_call>{"name":"diagnostic_echo"}</tool_call>',
  }));
  const response = await f.api("/api/diagnostics", {
    method: "POST",
    body: JSON.stringify(f.config),
  });
  const report = await response.json();
  assert.equal(report.ok, false);
  assert.match(report.checks[0].detail, /native tool call/);
});

for (const provider of ["ollama", "llamacpp"]) {
  test(`${provider}: cancelled multi-call turn exports paired tool results and can resume`, async (t) => {
    let count = 0;
    const f = await fixture(t, provider, (input) => {
      if (count++ === 0)
        return {
          content: "",
          tool_calls: [1, 2].map((index) => ({
            id: `pending-${index}`,
            function: {
              name: "write_file",
              arguments:
                provider === "ollama"
                  ? { path: `pending-${index}.txt`, content: "no" }
                  : JSON.stringify({
                      path: `pending-${index}.txt`,
                      content: "no",
                    }),
            },
          })),
        };
      const assistantIndex = input.messages.findIndex(
        (message) => message.tool_calls?.length,
      );
      const calls = input.messages[assistantIndex].tool_calls;
      const results = input.messages
        .slice(assistantIndex + 1)
        .filter((message) => message.role === "tool");
      assert.equal(results.length, calls.length);
      for (let index = 0; index < calls.length; index++) {
        assert.equal(JSON.parse(results[index].content).interrupted, true);
        if (provider === "llamacpp")
          assert.equal(results[index].tool_call_id, calls[index].id);
        else assert.equal(results[index].tool_name, calls[index].function.name);
      }
      return {
        content: "The interrupted tools are accounted for. Ready to continue.",
      };
    });
    const interrupted = await run(f, { mode: "agent" }, async (event) => {
      if (event.type === "approval")
        await f.api(`/api/runs/${event.data.runId}`, { method: "DELETE" });
    });
    const done = interrupted.at(-1).data;
    assert.equal(done.state, "cancelled");
    const resumed = await run(f, {
      mode: "agent",
      messages: done.messages,
      prompt: "Continue safely from the cancelled turn.",
    });
    assert.equal(resumed.at(-1).data.state, "completed");
    await assert.rejects(fs.readFile(path.join(f.root, "pending-1.txt")));
    await assert.rejects(fs.readFile(path.join(f.root, "pending-2.txt")));
  });
}
