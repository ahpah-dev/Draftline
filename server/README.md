# Local coding bridge

Requires Node.js 22 or newer. No backend dependencies are required.

```sh
node server/index.mjs --workspace /absolute/path/to/project
```

The bridge binds to `127.0.0.1:4318`, serves `dist/`, and pins the workspace until restart. Build the frontend first with `npm run build`. Options: `--port 4318`, `--workspace <directory>`, and repeatable `--allow-origin <exact-origin>` (`--origin` is an alias). For a GitHub Pages frontend, use its origin, for example `--allow-origin https://ahpah-dev.github.io`; do not include the repository path. Only the bridge's own `http://127.0.0.1:<port>` and `http://localhost:<port>` origins are trusted by default. For Vite development, explicitly add `--allow-origin http://127.0.0.1:5173` (or the exact origin your development server uses). Your browser may ask permission to access a local network service. Using the bridge's own local URL provides the most direct local experience.

Ollama uses `/api/tags` and native `/api/chat`; llama.cpp uses `/v1/models` and `/v1/chat/completions`. Provider base URLs must be loopback HTTP(S) hosts and may include an optional `/v1` suffix. Default ports are 11434 and 8080 respectively. llama.cpp needs `--jinja` and a tool-compatible chat template; the loaded model must support tool use. A successful connection only verifies discovery. Run diagnostics to verify a real structured call and tool-result round-trip. Model and template behavior cannot be guaranteed by a client application.

## API

All responses use JSON except run streams. Get `GET /api/health` first. It returns `{ok,version,workspace,sessionToken,providers}`. Supply `X-Session-Token` on every subsequent API request, including file reads. The token changes on restart. Origins are checked before exposing health or API data; Host headers are restricted to loopback hosts. Requests without Origin are permitted for local CLI clients. No wildcard CORS is used.

| Method | Path | Request / response |
| --- | --- | --- |
| POST | `/api/connect` | `{provider,baseUrl,model?}` → `{ok,provider,baseUrl,models:[{id}],model}` |
| GET | `/api/files?path=.` | `{path,entries:[{name,path,type}]}`; types: `file`, `directory`, `symlink` |
| GET | `/api/file?path=README.md` | `{path,content}` |
| POST | `/api/diagnostics` | `{provider,baseUrl,model}` → `{ok,provider,model,checks:[{name,ok,detail}]}` |
| POST | `/api/runs` | `{prompt,provider,baseUrl,model,mode:'ask'\|'agent',messages?:[]}` → SSE |
| POST | `/api/approvals/:id` | `{approved:true\|false}` → `{ok,approved}` |
| DELETE | `/api/runs/:id` | Cancels the active run and any pending approval |

Run SSE events use `event: <type>` followed by a JSON `data:` line:

- `status`: `{id,state,step?,message?}`. The initial event supplies the run ID.
- `message`: `{role:'assistant',content}`. Each is a complete model message rather than a token delta.
- `tool`: `{id,name,args,state:'pending'|'running'|'completed'|'error',result?}`.
- `approval`: `{id,runId,tool,args,warning?}`. The ID is the approval ID, not the tool-call ID.
- `error`: `{message}`. A `done` event still follows while the connection remains open.
- `done`: `{id,state:'completed'|'cancelled'|'error',messages}`. Persist `messages` for the next turn; it includes full provider-specific native call and result history. Start a new conversation when changing provider.

Both protocols request `stream:false` from the model. The bridge streams complete messages and tool activity to the browser, preventing partial argument JSON from being executed. Ollama tool results use `tool_name`; llama.cpp results preserve `tool_call_id`. Invalid tool arguments and tool execution errors are sent back as structured tool errors. Duplicate IDs in one response are rejected before any tool executes; repeated IDs later in a run replay the cached result when arguments match. There are no automatic provider retries. Each run permits 20 model turns and 16 calls per turn; provider requests time out after two minutes. Runs are cancelled when their browser stream disconnects. Interrupted turns receive explicit tool-error results in exported history so the next turn remains protocol-valid and does not assume interrupted actions succeeded.

Read-only tools: `list_files({path?})`, `read_file({path})`, and `search_files({query,path?})`. Agent mode additionally permits `write_file({path,content})` and `run_command({command,cwd?})`. Every write and command requires explicit approval through its own endpoint; a run-level `approved` field grants no permission. Approvals expire after ten minutes. Commands time out after 30 seconds and retain bounded output.

File tools reject absolute paths, traversal, and links escaping the workspace. Text reads and writes are limited to 512 KB. Directory listing and search skip dependency/build metadata and have bounded results. Shell commands run with the current user's account permissions; the workspace directory is their starting directory, **not an operating-system sandbox**. Only approve commands and file replacements you have reviewed.

## Tests

```sh
node --test server/*.test.mjs
```

The suite uses real HTTP mock providers and temporary workspaces to check native histories for both protocols, real diagnostic round-trips, malformed arguments, execution failures, individual approval, denial, cancellation, session/origin restrictions, traversal, and symlink confinement. It does not replace checking the installed model with runtime diagnostics.

Protocol references: [Ollama tool calling](https://github.com/ollama/ollama/blob/main/docs/capabilities/tool-calling.mdx), [llama.cpp function calling](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md).
