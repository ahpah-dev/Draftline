import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRuntime } from "./index.mjs";

async function setup(t, picker) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "codex-workspace-"),
  );
  const first = path.join(directory, "first project");
  const second = path.join(directory, "second project ü");
  await fs.mkdir(first);
  await fs.mkdir(second);
  await fs.writeFile(path.join(first, "project.txt"), "original project");
  await fs.writeFile(path.join(second, "project.txt"), "selected project");
  const runtime = await createRuntime({
    workspace: first,
    port: 0,
    pickDirectory: (initial, signal) =>
      picker({ first, second, initial, signal }),
  });
  const address = await runtime.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const api = (route, options = {}) =>
    fetch(base + route, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Session-Token": runtime.sessionToken,
        ...options.headers,
      },
    });
  const pick = (options = {}) =>
    api("/api/workspace/pick", { method: "POST", body: "{}", ...options });
  t.after(async () => {
    await runtime.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { runtime, base, api, pick, first, second };
}

test("folder selection switches the real workspace and expires the previous session", async (t) => {
  const f = await setup(t, ({ first, second, initial }) => {
    assert.equal(initial, first);
    return second;
  });
  const oldToken = f.runtime.sessionToken;
  const response = await f.pick();
  assert.equal(response.status, 200);
  const opened = await response.json();
  assert.equal(opened.cancelled, false);
  assert.equal(opened.workspace, f.second);
  assert.notEqual(opened.sessionToken, oldToken);
  assert.equal(f.runtime.workspace, f.second);
  const file = await f.api("/api/file?path=project.txt");
  assert.equal((await file.json()).content, "selected project");
  const expired = await f.api("/api/file?path=project.txt", {
    headers: { "X-Session-Token": oldToken },
  });
  assert.equal(expired.status, 401);
  const escape = await f.api("/api/file?path=../first%20project/project.txt");
  assert.equal(escape.status, 400);
});

test("cancelling or reselecting a folder preserves the existing workspace and token", async (t) => {
  let call = 0;
  const f = await setup(t, ({ first }) => (call++ === 0 ? null : first));
  const token = f.runtime.sessionToken;
  const cancelled = await (await f.pick()).json();
  assert.equal(cancelled.cancelled, true);
  assert.equal(f.runtime.workspace, f.first);
  assert.equal(f.runtime.sessionToken, token);
  const same = await (await f.pick()).json();
  assert.equal(same.cancelled, false);
  assert.equal(same.sessionToken, token);
});

test("folder selection rejects untrusted origins, missing sessions, and caller-supplied paths", async (t) => {
  let calls = 0;
  const f = await setup(t, () => {
    calls++;
    return null;
  });
  assert.equal(
    (await f.pick({ headers: { "X-Session-Token": "" } })).status,
    401,
  );
  assert.equal(
    (await f.pick({ headers: { Origin: "https://untrusted.example" } })).status,
    403,
  );
  assert.equal(
    (await f.pick({ body: JSON.stringify({ path: f.second }) })).status,
    400,
  );
  assert.equal(calls, 0);
});

test("invalid picker results never change the workspace", async (t) => {
  let result = "relative/path";
  const f = await setup(t, () => result);
  assert.equal((await f.pick()).status, 400);
  result = path.join(f.second, "project.txt");
  assert.equal((await f.pick()).status, 400);
  result = path.join(f.second, "missing");
  assert.equal((await f.pick()).status, 400);
  assert.equal(f.runtime.workspace, f.first);
});

test("an open system dialog blocks duplicate pickers and new agent runs", async (t) => {
  let release, started;
  const began = new Promise((resolve) => {
    started = resolve;
  });
  const f = await setup(t, ({ second }) => {
    started();
    return new Promise((resolve) => {
      release = () => resolve(second);
    });
  });
  const selection = f.pick();
  await began;
  assert.equal((await f.pick()).status, 409);
  const run = await f.api("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      provider: "ollama",
      model: "test",
      prompt: "Read project.txt",
    }),
  });
  assert.equal(run.status, 409);
  release();
  assert.equal((await selection).status, 200);
});

test("disconnecting from a folder request cancels the native picker", async (t) => {
  let started, cancelled;
  const began = new Promise((resolve) => {
    started = resolve;
  });
  const ended = new Promise((resolve) => {
    cancelled = resolve;
  });
  const f = await setup(
    t,
    ({ signal }) =>
      new Promise((resolve, reject) => {
        started();
        signal.addEventListener(
          "abort",
          () => {
            cancelled();
            reject(new Error("Cancelled"));
          },
          { once: true },
        );
      }),
  );
  const abort = new AbortController();
  const pending = f.pick({ signal: abort.signal });
  await began;
  abort.abort();
  await assert.rejects(pending);
  await Promise.race([
    ended,
    new Promise((_, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Native picker was not cancelled")),
        2000,
      );
      timeout.unref();
    }),
  ]);
  assert.equal(f.runtime.workspace, f.first);
});

test("workspace changes are blocked until an active agent run has finished", async (t) => {
  let pickerCalls = 0;
  const f = await setup(t, () => {
    pickerCalls++;
    return null;
  });
  const provider = http.createServer(async (req, res) => {
    for await (const _ of req) {
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              function: {
                name: "write_file",
                arguments: { path: "approved.txt", content: "test" },
              },
            },
          ],
        },
      }),
    );
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => provider.close(resolve)));
  const run = await f.api("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      provider: "ollama",
      baseUrl: `http://127.0.0.1:${provider.address().port}`,
      model: "test",
      prompt: "Create a file",
      mode: "agent",
    }),
  });
  const reader = run.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    runId;
  while (!buffer.includes("event: approval")) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    buffer += decoder.decode(chunk.value);
    const status = /event: status\ndata: ([^\n]+)/.exec(buffer);
    if (status) runId = JSON.parse(status[1]).id;
  }
  assert.equal((await f.pick()).status, 409);
  assert.equal(pickerCalls, 0);
  assert.equal(
    (await f.api(`/api/runs/${runId}`, { method: "DELETE" })).status,
    200,
  );
  while (!(await reader.read()).done) {}
  reader.releaseLock();
  assert.equal((await f.pick()).status, 200);
  assert.equal(pickerCalls, 1);
});
