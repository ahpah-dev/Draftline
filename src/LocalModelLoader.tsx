import { useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  Square,
  Play,
} from "lucide-react";
import { health, request } from "./api";
import type { Settings } from "./types";

type LocalState = {
  phase: "stopped" | "loading" | "ready" | "error";
  engine: string | null;
  baseUrl: string;
  model?: string;
  modelId: string | null;
  message: string;
  models: {
    id: string;
    label: string;
    path: string;
    source: string;
    bytes: number;
  }[];
  selectedId?: string;
};

export default function LocalModelLoader({
  settings,
  preferredModel,
  onLoaded,
}: {
  settings: Settings;
  preferredModel: string;
  onLoaded: (settings: Settings) => void;
}) {
  const [state, setState] = useState<LocalState | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const token = useRef("");
  const completed = useRef("");
  const loadedRef = useRef(onLoaded);
  loadedRef.current = onLoaded;

  async function call(path: string, body?: unknown, signal?: AbortSignal) {
    if (!token.current) {
      const runtime = await health(settings, signal);
      if (!runtime.localModelLoader)
        throw new Error(
          "Update and restart the Draftline runtime to use the local GGUF loader.",
        );
      token.current = runtime.sessionToken;
    }
    return request<LocalState>(
      settings.runtimeUrl,
      path,
      token.current,
      body,
      undefined,
      signal,
    );
  }
  async function action(name = "refresh") {
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setBusy(name);
    setError("");
    try {
      const next =
        name === "refresh"
          ? await call("/api/llamacpp/local?refresh=1", undefined, abort.signal)
          : await call(
              `/api/llamacpp/${name}`,
              name === "start" ? { modelId: selected } : {},
              abort.signal,
            );
      if (abort.signal.aborted) return;
      setState(next);
      if (next.selectedId) setSelected(next.selectedId);
      else if (name === "refresh")
        setSelected((old) =>
          next.models.some((model) => model.id === old)
            ? old
            : next.models.find((model) => model.label === preferredModel)?.id ||
              "",
        );
      if (name === "start") completed.current = "";
    } catch (cause) {
      if (!abort.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not update local models.",
        );
    } finally {
      if (!abort.signal.aborted) setBusy("");
    }
  }
  useEffect(() => {
    token.current = "";
    void action();
    return () => controller.current?.abort();
  }, [settings.runtimeUrl]);

  const loading = state?.phase === "loading";
  useEffect(() => {
    if (!loading) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await call("/api/llamacpp/local", undefined, abort.signal);
        if (abort.signal.aborted) return;
        setState(next);
        if (next.phase === "error") setError(next.message);
        if (
          next.phase === "ready" &&
          next.model &&
          completed.current !== next.modelId
        ) {
          completed.current = next.modelId || "";
          loadedRef.current({
            ...settings,
            provider: "llamacpp",
            baseUrl: next.baseUrl,
            model: next.model,
          });
          return;
        }
        if (next.phase === "loading") timer = setTimeout(poll, 900);
      } catch (cause) {
        if (!abort.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Connection to the local loader was lost.",
          );
      }
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [loading, settings.runtimeUrl]);

  return (
    <section className="local-model-loader" aria-label="Local GGUF loader">
      <div className="local-loader-heading">
        <div>
          <strong>Open a local GGUF</strong>
          <p>Choose your model. Draftline starts llama.cpp on your computer.</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Rescan local models"
          disabled={!!busy || loading}
          onClick={() => void action()}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <div className="local-engine-row">
        <span title={state?.engine || ""}>
          {state?.engine
            ? "llama-server found"
            : "Choose your llama.cpp engine"}
        </span>
        <button
          type="button"
          className="button secondary"
          disabled={!!busy || loading || state?.phase === "ready"}
          onClick={() => void action("pick-engine")}
        >
          Choose engine
        </button>
      </div>
      <label className="sr-only" htmlFor="local-gguf">
        Local GGUF model
      </label>
      <select
        id="local-gguf"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        disabled={!!busy || loading}
      >
        <option value="">Choose a local model…</option>
        {state?.models.map((model) => (
          <option value={model.id} key={model.id}>
            {model.label} · {(model.bytes / 1024 ** 3).toFixed(1)} GB ·{" "}
            {model.source}
          </option>
        ))}
      </select>
      {selected && (
        <p className="local-selected-path">
          {state?.models.find((model) => model.id === selected)?.path}
        </p>
      )}
      <div className="local-loader-actions">
        <button
          type="button"
          className="button secondary"
          disabled={!!busy || loading}
          onClick={() => void action("pick-model")}
        >
          <FolderOpen size={14} />
          Browse GGUF…
        </button>
        {loading || state?.phase === "ready" ? (
          <button
            type="button"
            className="button secondary"
            disabled={!!busy}
            onClick={() => void action("stop")}
          >
            <Square size={12} />
            Stop local model
          </button>
        ) : null}
        <button
          type="button"
          className="button primary"
          disabled={!!busy || loading || !selected || !state?.engine}
          onClick={() => void action("start")}
        >
          {busy === "start" || loading ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Play size={13} />
          )}
          {loading ? "Loading model…" : "Load selected model"}
        </button>
      </div>
      {busy.startsWith("pick-") && (
        <p className="muted" role="status">
          Choose the file in the system dialog.
        </p>
      )}
      {loading && (
        <p className="muted" role="status">
          Loading can take a while. You can stop at any time.
        </p>
      )}
      {state?.phase === "ready" && (
        <p className="muted" role="status">
          {state.model} is ready at {state.baseUrl}.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
