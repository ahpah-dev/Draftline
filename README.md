# Codex Local

A focused, Codex-inspired coding workspace for local models. Connect an Ollama or llama.cpp server, open a project, and work with an agent that can inspect files, propose edits, and run approved commands.

[Open the live demo](https://ahpah-dev.github.io/codex-local/)

Codex Local is an independent community project. It is not affiliated with, endorsed by, or an official product of OpenAI. OpenAI and Codex are trademarks of their respective owners.

## Run locally

Requires Node.js 22 or later (Node.js 24 recommended), npm, and a running [Ollama](https://ollama.com/) or [llama.cpp](https://github.com/ggml-org/llama.cpp) server.

```sh
git clone https://github.com/ahpah-dev/codex-local.git
cd codex-local
npm install
npm run build
npm start -- --workspace /absolute/path/to/your/project
```

Open [localhost:4318](http://localhost:4318). On Windows, quote a project path containing spaces:

```powershell
npm start -- --workspace "C:\Users\you\Projects\my-app"
```

The workspace argument selects the project the agent may access. Start with a small, version-controlled project so proposed changes are easy to review.

## Connect a model

In the app’s connection settings, choose a provider, confirm its server URL, and select a model.

| Provider | Default server URL | Requirements |
| --- | --- | --- |
| Ollama | `http://127.0.0.1:11434` | A running Ollama server and an installed model with native tool support. |
| llama.cpp | `http://127.0.0.1:8080` | `llama-server`, a compatible model, and its correct tool-capable chat template. |

For Ollama, start the service and install a tool-capable model using the commands in the model’s documentation. The app uses the provider’s native tool-call protocol rather than interpreting arbitrary prose as commands.

For llama.cpp, a typical server invocation is:

```sh
llama-server -m /path/to/tool-capable-model.gguf --port 8080 --jinja
```

Use the model’s recommended template and server options. `--jinja` enables the template machinery; it does not give every model tool support. See the official [llama.cpp function calling guide](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md) for model-specific requirements.

## Working with the agent

1. Start the local runtime with your project’s workspace path.
2. Connect your provider and model.
3. Describe a concrete coding task. The agent can request workspace tools as it works.
4. Review approval requests before allowing operations that change files or run commands.
5. Inspect the resulting changes and run your project’s checks.

Tool compatibility depends on the model, chat template, provider version, and context available to the model. No application can guarantee correct tool use across every local model. Use explicit tasks, inspect tool results, and treat a model’s claim of success as something to verify.

## GitHub Pages

The published GitHub Pages site is a browser demo and an introduction to the local setup. GitHub Pages serves static files; it cannot run the Node runtime or access your filesystem. Real coding sessions run through the local application at `http://localhost:4318`.

The included [Pages workflow](.github/workflows/pages.yml) builds and deploys the frontend on pushes to `main` and manual runs. To enable it in a GitHub repository:

1. Open **Settings → Pages**.
2. Set **Build and deployment → Source** to **GitHub Actions**.
3. Push to `main` or run **Deploy GitHub Pages** from the Actions tab.

Vite uses a relative asset base so the build supports project sites under a repository path.

## Trust and security

Run Codex Local only with projects and model servers you trust. Treat repository contents, model output, and tool requests as untrusted input.

- File tools are confined to the selected workspace. The runtime rejects paths outside that workspace.
- Changes and command execution use approval prompts. Read each request before approving it.
- **Shell commands run as your operating system user after per-call approval. This is not an operating system sandbox.** A command may access files, networks, credentials, and installed tools available to your account. Workspace path checks on file tools do not confine shell commands.
- Use a disposable checkout, container, or restricted user account when stronger isolation is required. Keep secrets out of the project and review changes with Git.
- Keep the local runtime bound to your own machine. Do not expose it publicly or place it behind a public tunnel without implementing an appropriate authentication and isolation layer.
- Browser task history is saved in local storage on this device. Clearing site data removes it. Runtime session tokens stay in memory and expire when the runtime restarts.

Your configured provider processes prompts and tool results. With a locally hosted provider, those requests go to that local server; any additional network behavior depends on the server, model configuration, and approved commands.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Provider cannot be reached | Start the provider and confirm its URL and port. Use the server URL, not a model-download page. |
| Model list is empty | Install or load a model and verify it appears in your provider’s own model listing. |
| The model writes tool JSON as text | Confirm native tool support and the correct chat template. For llama.cpp, check `--jinja` and the model’s function-calling instructions. |
| Tool calls are rejected | Read the tool result, check the arguments, and retry with a compatible model. Never paste model-generated commands into a shell without review. |
| A file cannot be read or edited | Confirm the runtime was started with the intended workspace. File tools cannot reach outside it. |
| Generation is slow or stops | Check the provider logs, available RAM/VRAM, model size, context size, and provider timeout settings. |
| The Pages demo cannot edit a project | Start the local runtime and open its localhost address. The published site is static. |

When reporting a problem, include your operating system, Node.js version, provider/version, model identifier, and a redacted reproduction. Do not include credentials or private project contents.

## Development

```sh
npm install
npm run dev
```

The frontend is built with React, TypeScript, and Vite. For live tool use during frontend development, start the runtime in another terminal with the exact Vite origin explicitly allowed:

```sh
npm start -- --workspace /absolute/path/to/project --allow-origin http://127.0.0.1:5173
```

If Vite selects a different port, allow that exact origin instead. The runtime trusts its own origin by default. The local Node runtime is in `server/index.mjs`; its API is documented in [server/README.md](server/README.md).

```sh
npm test
npm run build
```

The automated tests exercise tool and provider behavior against controlled fixtures. They do not certify all model families, model templates, provider releases, or hardware configurations. Validate a representative task with your own local provider before relying on it for a project.

## License

[MIT](LICENSE), copyright © 2026 ahpah-dev.
