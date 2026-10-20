import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { providerRequest } from "./transport.mjs";
import { models, chat } from "./providers.mjs";
import { executeTool } from "./tools.mjs";
import { createRuntime } from "./index.mjs";

async function provider(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

for (const operation of ["models", "chat"]) {
  test(`${operation}: slow local provider survives ten minutes of elapsed clock time`, async (t) => {
    const received = Promise.withResolvers();
    const baseUrl = await provider(t, (_req, res) => received.resolve(res));
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const config = { provider: "ollama", baseUrl, model: "test" };
    const pending =
      operation === "models" ? models(config) : chat(config, [], []);
    const response = await received.promise;
    t.mock.timers.tick(600_001);
    response.end(
      JSON.stringify(
        operation === "models"
          ? { models: [{ name: "test" }] }
          : { message: { role: "assistant", content: "Finished loading." } },
      ),
    );
    const result = await pending;
    assert.deepEqual(
      result,
      operation === "models"
        ? [{ id: "test" }]
        : { role: "assistant", content: "Finished loading." },
    );
  });
}

for (const phase of ["headers", "body"]) {
  test(`Stop cancels a provider waiting for ${phase} and closes its socket`, async (t) => {
    const received = Promise.withResolvers();
    const closed = Promise.withResolvers();
    const url = await provider(t, (_req, res) => {
      res.on("close", closed.resolve);
      if (phase === "body") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write('{"message":');
      }
      received.resolve();
    });
    const controller = new AbortController();
    const pending = providerRequest(url, { signal: controller.signal });
    const rejected = assert.rejects(pending, /Run cancelled/);
    await received.promise;
    controller.abort();
    await rejected;
    await closed.promise;
  });
}

test("provider responses reject redirects, invalid JSON, and oversized bodies", async (t) => {
  const url = await provider(t, (req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "http://example.com" });
      res.end();
    } else if (req.url === "/large") res.end('"' + "x".repeat(5_000_000) + '"');
    else res.end("Not JSON");
  });
  await assert.rejects(
    providerRequest(url + "/redirect"),
    /redirects are not allowed/,
  );
  await assert.rejects(providerRequest(url + "/large"), /5 MB limit/);
  await assert.rejects(providerRequest(url), /invalid JSON/);
});

test("interrupted provider bodies fail clearly without retrying generation", async (t) => {
  let calls = 0;
  const url = await provider(t, (_req, res) => {
    calls++;
    res.writeHead(200, { "Content-Length": "200" });
    res.write('{"message":');
    res.socket.end();
  });
  await assert.rejects(
    providerRequest(url),
    /connection interrupted|Cannot reach local provider/i,
  );
  assert.equal(calls, 1);
});

test(
  "runtime shutdown cancels pending model discovery instead of hanging",
  { timeout: 5_000 },
  async (t) => {
    const received = Promise.withResolvers();
    const baseUrl = await provider(t, () => received.resolve());
    const runtime = await createRuntime({ port: 0 });
    const { port } = await runtime.listen();
    let closing;
    t.after(() => (closing ||= runtime.close()));
    const pending = fetch(`http://127.0.0.1:${port}/api/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Token": runtime.sessionToken,
      },
      body: JSON.stringify({ provider: "ollama", baseUrl }),
    });
    await received.promise;
    closing = runtime.close();
    const response = await pending;
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /cancelled/);
    await closing;
  },
);

test(
  "approved commands can finish beyond the former 30-second limit",
  { timeout: 45_000 },
  async (t) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "codex-long-command-"),
    );
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const result = await executeTool(root, "run_command", {
      command: `"${process.execPath}" -e "setTimeout(()=>console.log('finished'),31000)"`,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.match(result.stdout, /finished/);
  },
);

test("Stop terminates a running command", { timeout: 10_000 }, async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "codex-cancel-command-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const controller = new AbortController();
  const pending = executeTool(
    root,
    "run_command",
    {
      command: `"${process.execPath}" -e "setInterval(()=>{},1000)"`,
    },
    controller.signal,
  );
  const timer = setTimeout(() => controller.abort(), 250);
  t.after(() => clearTimeout(timer));
  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.notEqual(result.exitCode, 0);
});
