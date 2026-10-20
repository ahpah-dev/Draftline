import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  Cpu,
  FileCode2,
  Folder,
  FolderOpen,
  Github,
  History,
  Loader2,
  Menu,
  MessageSquare,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  ShieldCheck,
  SquarePen,
  Square,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import ConnectionDialog from "./ConnectionDialog";
import AppearanceMenu from "./AppearanceMenu";
import ModeMenu from "./ModeMenu";
import WorkspaceDialog from "./WorkspaceDialog";
import { health as getHealth, request, streamRun } from "./api";
import { exampleFiles, initialThreads, suggestions } from "./demo";
import type {
  Approval,
  FileEntry,
  Health,
  Message,
  Settings,
  Thread,
  ToolEvent,
  View,
} from "./types";

const repo = "https://github.com/ahpah-dev/codex-local";
const localOrigin =
  ["localhost", "127.0.0.1"].includes(location.hostname) &&
  !["5173", "4173"].includes(location.port)
    ? location.origin
    : "http://127.0.0.1:4318";
const defaults: Settings = {
  provider: "ollama",
  baseUrl: "http://localhost:11434",
  model: "",
  runtimeUrl: localOrigin,
};
function stored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage may be unavailable in private browsing. */
  }
}
function id() {
  return crypto.randomUUID();
}
function formatTime(time: number) {
  const hours = (Date.now() - time) / 3600000;
  return hours < 1
    ? "Just now"
    : hours < 24
      ? `${Math.floor(hours)}h ago`
      : new Date(time).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
}
function Text({ content }: { content: string }) {
  return (
    <div className="message-text">
      {content
        .split(/(```[\s\S]*?```)/g)
        .map((part, i) =>
          part.startsWith("```") ? (
            <pre key={i}>
              {part.replace(/^```[^\n]*\n?/, "").replace(/```$/, "")}
            </pre>
          ) : (
            <span key={i}>
              {part
                .split(/(`[^`]+`)/g)
                .map((word, j) =>
                  word.startsWith("`") ? (
                    <code key={j}>{word.slice(1, -1)}</code>
                  ) : (
                    word
                  ),
                )}
            </span>
          ),
        )}
    </div>
  );
}
function ToolRow({ tool }: { tool: ToolEvent }) {
  return (
    <details className="tool-row">
      <summary>
        <span className={`tool-icon ${tool.state}`}>
          {tool.state === "completed" ? (
            <Check size={13} />
          ) : tool.state === "error" ? (
            <X size={13} />
          ) : (
            <Loader2 size={13} className="spin" />
          )}
        </span>
        <span>{tool.name.replace(/_/g, " ")}</span>
        <code>
          {String(
            tool.args.path || tool.args.command || tool.args.query || "",
          ).slice(0, 50)}
        </code>
        <ChevronDown size={12} />
      </summary>
      <pre>
        {JSON.stringify(tool.args, null, 2)}
        {tool.result !== undefined
          ? `\n\n${typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result, null, 2)}`
          : ""}
      </pre>
    </details>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => ({
    ...defaults,
    ...stored<Partial<Settings>>("codex-local:settings:v1", {}),
  }));
  const [threads, setThreads] = useState<Thread[]>(() =>
    stored("codex-local:threads:v1", initialThreads),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("workspace");
  const [health, setHealth] = useState<Health | null>(null);
  const [connected, setConnected] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [pickingWorkspace, setPickingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"agent" | "ask">("agent");
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [decidingApproval, setDecidingApproval] = useState(false);
  const [error, setError] = useState("");
  const [runStatus, setRunStatus] = useState("");
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    stored("codex-local:sidebar-collapsed:v1", false),
  );
  const [rightTab, setRightTab] = useState<"overview" | "files">("overview");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [folder, setFolder] = useState("");
  const [openFile, setOpenFile] = useState<{
    path: string;
    content: string;
  } | null>(null);
  const [fileError, setFileError] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [toast, setToast] = useState("");
  const controller = useRef<AbortController | null>(null);
  const initialConnection = useRef<AbortController | null>(null);
  const workspaceController = useRef<AbortController | null>(null);
  const pendingDecision = useRef<string | null>(null);
  const runId = useRef("");
  const textArea = useRef<HTMLTextAreaElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const mainShellRef = useRef<HTMLDivElement>(null);
  const focusComposer = useRef(false);
  const active = threads.find((t) => t.id === selected);
  const workspace =
    health?.workspace?.split(/[\\/]/).filter(Boolean).at(-1) ||
    health?.workspace ||
    "my-next-idea";
  const toolCount = threads.reduce(
    (sum, t) =>
      sum +
      t.tools.filter((tool) => tool.state === "completed" && !t.demo).length,
    0,
  );

  useEffect(() => save("codex-local:settings:v1", settings), [settings]);
  useEffect(
    () => save("codex-local:sidebar-collapsed:v1", sidebarCollapsed),
    [sidebarCollapsed],
  );
  useEffect(
    () => save("codex-local:threads:v1", threads.slice(0, 30)),
    [threads],
  );
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    if (!showSearch) return;
    const frame = requestAnimationFrame(() => searchInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [showSearch]);
  useEffect(() => {
    if (
      focusComposer.current &&
      !selected &&
      view === "workspace" &&
      !mobileSidebar
    ) {
      textArea.current?.focus();
      focusComposer.current = false;
    }
  }, [selected, view, mobileSidebar]);
  useEffect(() => {
    if (!mobileSidebar || !window.matchMedia("(max-width: 640px)").matches)
      return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const sidebar = sidebarRef.current;
    if (mainShellRef.current) mainShellRef.current.inert = true;
    const focusFrame = requestAnimationFrame(() => {
      (showSearch
        ? searchInput.current
        : sidebar?.querySelector<HTMLElement>("a[href], button:not([disabled])")
      )?.focus();
    });
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(
        sidebar?.querySelectorAll<HTMLElement>(
          "a[href],button:not([disabled]),input:not([disabled])",
        ) || [],
      ).filter(
        (element) =>
          element.getClientRects().length &&
          getComputedStyle(element).visibility !== "hidden",
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!sidebar?.contains(document.activeElement)) {
        event.preventDefault();
        first?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    const media = window.matchMedia("(max-width: 640px)");
    const handleResize = () => {
      if (!media.matches) setMobileSidebar(false);
    };
    media.addEventListener("change", handleResize);
    return () => {
      cancelAnimationFrame(focusFrame);
      media.removeEventListener("change", handleResize);
      document.removeEventListener("keydown", trap);
      if (mainShellRef.current) mainShellRef.current.inert = false;
      previousFocus?.focus();
    };
  }, [mobileSidebar]);
  useEffect(() => {
    messageEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [active?.messages.length, active?.tools.length, approval]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        if ((event.target as HTMLElement)?.closest?.(".modal")) return;
        event.preventDefault();
        setShowSearch((v) => !v);
        setSidebarCollapsed(false);
        if (window.matchMedia("(max-width: 640px)").matches)
          setMobileSidebar(true);
      }
      if (event.key === "Escape") setMobileSidebar(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!["localhost", "127.0.0.1"].includes(location.hostname)) return;
    const abort = new AbortController();
    initialConnection.current = abort;
    getHealth(settings, abort.signal)
      .then(async (h) => {
        if (abort.signal.aborted) return;
        setHealth(h);
        if (settings.model) {
          const result = await request<{ model: string }>(
            settings.runtimeUrl,
            "/api/connect",
            h.sessionToken,
            settings,
            undefined,
            abort.signal,
          );
          if (abort.signal.aborted) return;
          setSettings((current) => ({ ...current, model: result.model }));
          setConnected(true);
        }
      })
      .catch(() => {});
    return () => abort.abort();
    // Connection changes are explicit after the initial local-runtime discovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (rightTab !== "files") return;
    let live = true;
    setFileError("");
    setFileLoading(true);
    if (!health) {
      setFiles(
        Object.keys(exampleFiles)
          .filter((p) => !folder || p.startsWith(folder))
          .map((path) => ({ name: path, path, type: "file" })),
      );
      setFileLoading(false);
      return;
    }
    request<{ entries: FileEntry[] }>(
      settings.runtimeUrl,
      `/api/files?path=${encodeURIComponent(folder || ".")}`,
      health.sessionToken,
    )
      .then((data) => {
        if (live) setFiles(data.entries);
      })
      .catch((err) => {
        if (live) setFileError(err.message);
      })
      .finally(() => {
        if (live) setFileLoading(false);
      });
    return () => {
      live = false;
    };
  }, [rightTab, folder, connected, health, settings.runtimeUrl]);

  function openConnection() {
    if (busy || pickingWorkspace) {
      setToast("Stop the current task before changing connections");
      return;
    }
    initialConnection.current?.abort();
    setMobileSidebar(false);
    setShowConnection(true);
  }
  async function chooseWorkspace(runtimeUrl = settings.runtimeUrl) {
    if (busy || workspaceController.current) {
      if (busy) setToast("Stop the current task before changing folders");
      return;
    }
    const abort = new AbortController();
    workspaceController.current = abort;
    initialConnection.current?.abort();
    setMobileSidebar(false);
    setPickingWorkspace(true);
    setWorkspaceError("");
    try {
      const parsed = new URL(runtimeUrl);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        parsed.pathname !== "/"
      )
        throw new Error(
          "Enter a local runtime URL such as http://127.0.0.1:4318.",
        );
      const nextSettings = { ...settings, runtimeUrl: parsed.origin };
      let current: Health;
      try {
        current = await getHealth(
          nextSettings,
          AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
        );
      } catch (error) {
        if (abort.signal.aborted) throw error;
        throw new Error(
          "The local runtime is not reachable. Start it with the command below, then choose your folder.",
        );
      }
      if (!current.workspacePicker)
        throw new Error(
          "This runtime needs an update to open the system folder picker. Update your checkout and restart the runtime using the steps below.",
        );
      const opened = await request<Health & { cancelled: boolean }>(
        nextSettings.runtimeUrl,
        "/api/workspace/pick",
        current.sessionToken,
        {},
        undefined,
        abort.signal,
      );
      if (opened.cancelled || abort.signal.aborted) return;
      setSettings(nextSettings);
      setHealth(opened);
      if (nextSettings.runtimeUrl !== settings.runtimeUrl) setConnected(false);
      setSelected(null);
      setPrompt("");
      setError("");
      setFolder("");
      setOpenFile(null);
      setView("workspace");
      setRightTab("files");
      setShowWorkspace(false);
      setToast(
        `Opened ${opened.workspace.split(/[\\/]/).filter(Boolean).at(-1) || opened.workspace}`,
      );
    } catch (error) {
      if (!abort.signal.aborted) {
        setWorkspaceError((error as Error).message);
        setShowWorkspace(true);
      }
    } finally {
      workspaceController.current = null;
      setPickingWorkspace(false);
    }
  }
  function newTask() {
    if (busy || pickingWorkspace) return;
    focusComposer.current = true;
    setSelected(null);
    setView("workspace");
    setPrompt("");
    setError("");
    setMobileSidebar(false);
    textArea.current?.focus();
  }
  function updateThread(threadId: string, updater: (thread: Thread) => Thread) {
    setThreads((old) => old.map((t) => (t.id === threadId ? updater(t) : t)));
  }
  function appendMessage(
    threadId: string,
    content: string,
    role: Message["role"] = "assistant",
    demo = false,
  ) {
    updateThread(threadId, (t) => ({
      ...t,
      messages: [...t.messages, { id: id(), role, content, demo }],
    }));
  }
  async function openEntry(entry: FileEntry) {
    if (entry.type === "directory") {
      setFolder(entry.path);
      return;
    }
    setFileLoading(true);
    setFileError("");
    try {
      if (!health) {
        setOpenFile({
          path: entry.path,
          content: exampleFiles[entry.path] || "",
        });
      } else {
        const data = await request<{ path: string; content: string }>(
          settings.runtimeUrl,
          `/api/file?path=${encodeURIComponent(entry.path)}`,
          health.sessionToken,
        );
        setOpenFile(data);
      }
    } catch (err) {
      setFileError((err as Error).message);
    } finally {
      setFileLoading(false);
    }
  }
  async function submit(event?: FormEvent, supplied?: string) {
    event?.preventDefault();
    const value = (supplied ?? prompt).trim();
    if (!value || busy || pickingWorkspace) return;
    setError("");
    setPrompt("");
    setBusy(true);
    setRunStatus("Starting task");
    setView("workspace");
    const threadId = selected && active ? selected : id();
    const current = active;
    const user: Message = {
      id: id(),
      role: "user",
      content: value,
      demo: !connected,
    };
    if (selected && active) {
      updateThread(threadId, (t) => ({
        ...t,
        messages: [...t.messages, user],
        tools: connected && t.demo ? [] : t.tools,
        demo: !connected,
        updated: Date.now(),
      }));
    } else {
      setThreads((old) => [
        {
          id: threadId,
          title: value.length > 43 ? `${value.slice(0, 43)}…` : value,
          updated: Date.now(),
          messages: [user],
          tools: [],
          demo: !connected,
        },
        ...old,
      ]);
      setSelected(threadId);
    }
    controller.current = new AbortController();
    try {
      if (!connected || !health) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(resolve, 650);
          controller.current?.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              reject(new DOMException("Cancelled", "AbortError"));
            },
            { once: true },
          );
        });
        updateThread(threadId, (t) => ({
          ...t,
          tools: [
            ...t.tools,
            {
              id: id(),
              name: "list_files",
              args: { path: "." },
              state: "completed",
              result: Object.keys(exampleFiles),
            },
          ],
        }));
        appendMessage(
          threadId,
          `Here’s how I’d start: inspect the project, read the relevant files, then propose a focused change. You can explore the sample files in the right panel.\n\nThis is an interactive preview. To run “${value}” against your own code, connect the local runtime with a tool-capable model. File changes and terminal commands will ask for your approval.`,
          "assistant",
          true,
        );
      } else {
        const connection = JSON.stringify([
          settings.runtimeUrl.replace(/\/$/, ""),
          health.workspace,
          settings.provider,
          settings.baseUrl,
          settings.model,
        ]);
        await streamRun(
          settings,
          health.sessionToken,
          {
            ...settings,
            prompt: value,
            mode,
            messages: current?.demo
              ? []
              : (current?.connection === connection
                  ? current?.history
                  : undefined) ||
                current?.messages.map((m) => ({
                  role: m.role,
                  content: m.content,
                })) ||
                [],
          },
          controller.current.signal,
          (event, data) => {
            if (event === "status") {
              runId.current = String(data.id || "");
              setRunStatus(String(data.message || "Working on your task"));
            }
            if (event === "message" && data.content)
              appendMessage(threadId, String(data.content));
            if (event === "tool") {
              const tool = {
                ...data,
                id: `${runId.current}:${data.id}`,
                args:
                  data.args && typeof data.args === "object"
                    ? data.args
                    : { value: data.args },
              } as unknown as ToolEvent;
              updateThread(threadId, (t) => ({
                ...t,
                tools: t.tools.some((item) => item.id === tool.id)
                  ? t.tools.map((item) =>
                      item.id === tool.id ? { ...item, ...tool } : item,
                    )
                  : [...t.tools, tool],
              }));
              setRunStatus(`${tool.name.replace(/_/g, " ")} · ${tool.state}`);
            }
            if (event === "approval") {
              setApproval(data as unknown as Approval);
              setRunStatus("Waiting for your approval");
            }
            if (event === "done") {
              if (Array.isArray(data.messages))
                updateThread(threadId, (t) => ({
                  ...t,
                  history: data.messages as unknown[],
                  connection,
                  demo: false,
                }));
              if (data.state === "cancelled") setToast("Task stopped");
            }
            if (event === "error")
              setError(String(data.message || "The run could not finish."));
          },
        );
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setToast("Task stopped");
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
      setApproval(null);
      setRunStatus("");
      runId.current = "";
      controller.current = null;
    }
  }
  async function stop() {
    if (runId.current && health) {
      try {
        await request(
          settings.runtimeUrl,
          `/api/runs/${runId.current}`,
          health.sessionToken,
          undefined,
          "DELETE",
          AbortSignal.timeout(5000),
        );
        return;
      } catch {
        /* Aborting the stream also closes the run. */
      }
    }
    controller.current?.abort();
  }
  async function decide(approved: boolean) {
    if (!approval || !health || pendingDecision.current) return;
    const approvalId = approval.id;
    pendingDecision.current = approvalId;
    setDecidingApproval(true);
    setRunStatus(
      approved ? "Continuing task" : "Permission denied; continuing",
    );
    try {
      await request(
        settings.runtimeUrl,
        `/api/approvals/${approvalId}`,
        health.sessionToken,
        { approved },
      );
      setApproval((current) => (current?.id === approvalId ? null : current));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      pendingDecision.current = null;
      setDecidingApproval(false);
    }
  }
  async function copy(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setToast("Copied to clipboard");
    } catch {
      setToast("Clipboard unavailable in this browser");
    }
  }

  const composer = (
    <form className={`composer ${active ? "compact" : ""}`} onSubmit={submit}>
      <label className="sr-only" htmlFor="task-prompt">
        Describe your coding task
      </label>
      <textarea
        ref={textArea}
        id="task-prompt"
        placeholder={
          active
            ? "Keep the conversation going…"
            : "Describe a task, ask a question, or start building…"
        }
        value={prompt}
        disabled={busy || pickingWorkspace}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="composer-bottom">
        <div className="composer-controls">
          <button
            type="button"
            className="context-button icon-button"
            aria-label="Browse workspace files"
            title="Browse workspace files"
            onClick={() =>
              setRightTab((tab) => (tab === "files" ? "overview" : "files"))
            }
          >
            <Plus size={21} />
          </button>
          <ModeMenu
            mode={mode}
            onChange={setMode}
            disabled={busy || pickingWorkspace}
          />
          <span className="composer-divider" />
          <button
            type="button"
            className="model-button"
            onClick={() => openConnection()}
            disabled={busy}
          >
            <span>{connected ? settings.model : "Choose model"}</span>
            <ChevronDown size={12} />
          </button>
        </div>
        {busy ? (
          <button
            type="button"
            className="send-button stop"
            onClick={() => void stop()}
            aria-label="Stop task"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            className="send-button"
            disabled={!prompt.trim() || pickingWorkspace}
            aria-label="Send task"
          >
            <ArrowUp size={19} />
          </button>
        )}
      </div>
    </form>
  );

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {mobileSidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Close sidebar"
          onClick={() => setMobileSidebar(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        className={`sidebar ${mobileSidebar ? "is-open" : ""}`}
        role={mobileSidebar ? "dialog" : undefined}
        aria-modal={mobileSidebar ? true : undefined}
        aria-label="Task navigation"
      >
        <div className="sidebar-top">
          <a
            className="brand"
            aria-label="Codex Local home"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              newTask();
            }}
          >
            <span className="brand-mark">
              <Terminal size={22} strokeWidth={1.8} />
            </span>
            <span>
              Codex<span className="brand-local">Local</span>
            </span>
          </a>
          <button
            className="icon-button sidebar-toggle"
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setSidebarCollapsed((v) => !v)}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={19} />
            ) : (
              <PanelLeftClose size={19} />
            )}
          </button>
        </div>
        <div className="sidebar-actions">
          <button
            className="new-task"
            aria-label="New task"
            onClick={newTask}
            disabled={busy}
          >
            <SquarePen size={19} />
            <span>New task</span>
          </button>
          <button
            className={`search-button ${showSearch ? "active" : ""}`}
            aria-label="Search tasks"
            onClick={() => {
              setShowSearch((v) => !v);
              setSidebarCollapsed(false);
            }}
          >
            <Search size={16} />
            <span>Search tasks</span>
            <kbd>Ctrl K</kbd>
          </button>
          {showSearch && (
            <input
              aria-label="Search tasks"
              ref={searchInput}
              className="task-search"
              placeholder="Search your tasks…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          <button
            className={view === "workspace" ? "active" : ""}
            onClick={() => {
              setView("workspace");
              setMobileSidebar(false);
            }}
          >
            <Code2 size={17} />
            Workspace
          </button>
          <button
            className={view === "activity" ? "active" : ""}
            onClick={() => {
              setView("activity");
              setMobileSidebar(false);
            }}
          >
            <History size={17} />
            Activity
            <span className="nav-count">
              {threads.filter((t) => !t.demo).length}
            </span>
          </button>
          <button
            className={view === "guide" ? "active" : ""}
            onClick={() => {
              setView("guide");
              setMobileSidebar(false);
            }}
          >
            <CircleHelp size={17} />
            Getting started
            <ArrowRight className="nav-arrow" size={14} />
          </button>
        </nav>
        <div className="thread-heading">
          <span>Recent tasks</span>
          <button
            className="icon-button"
            aria-label="New task"
            onClick={newTask}
            disabled={busy}
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="thread-list">
          {threads
            .filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
            .map((t) => (
              <button
                key={t.id}
                className={`thread-button ${t.id === selected && view === "workspace" ? "active" : ""}`}
                onClick={() => {
                  if (busy) return;
                  setSelected(t.id);
                  setView("workspace");
                  setError("");
                  setMobileSidebar(false);
                }}
              >
                <MessageSquare size={14} />
                <span>{t.title}</span>
                {t.demo && <span className="demo-tag">demo</span>}
              </button>
            ))}
          {threads.length === 0 && (
            <p className="empty-tasks">Your next idea starts here.</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <button
            className="workspace-switch"
            aria-label="Open project folder"
            title={health?.workspace || "Choose a project folder"}
            onClick={() => void chooseWorkspace()}
            disabled={busy || pickingWorkspace}
          >
            <span className="workspace-avatar">
              {workspace[0].toUpperCase()}
            </span>
            <span>
              {workspace}
              <small>
                {pickingWorkspace
                  ? "Choose a folder in the system dialog…"
                  : health
                    ? "Change project folder"
                    : "Open a project folder"}
              </small>
            </span>
            {pickingWorkspace ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <FolderOpen size={15} />
            )}
          </button>
        </div>
      </aside>
      <div className="main-shell" ref={mainShellRef}>
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileSidebar((v) => !v)}
              aria-label="Open sidebar"
            >
              <Menu size={19} />
            </button>
            <button
              className="product-switch"
              onClick={openConnection}
              disabled={busy}
            >
              Codex Local <ChevronDown size={15} />
            </button>
            <span className="view-label">
              {view === "activity"
                ? "Activity"
                : view === "guide"
                  ? "Getting started"
                  : active
                    ? "Task"
                    : ""}
            </span>
          </div>
          <div className="topbar-actions">
            {!connected && (
              <span className="preview-badge">
                {health ? "No model" : "Preview"}
              </span>
            )}
            <AppearanceMenu />
            <button
              className={`icon-button files-toggle ${rightTab === "files" ? "active" : ""}`}
              aria-label={rightTab === "files" ? "Close files" : "Open files"}
              title="Workspace files"
              onClick={() => {
                setView("workspace");
                setRightTab((tab) => (tab === "files" ? "overview" : "files"));
              }}
            >
              {rightTab === "files" ? (
                <PanelRightClose size={19} />
              ) : (
                <PanelRightOpen size={19} />
              )}
            </button>
            <a
              className="github-link"
              href={repo}
              target="_blank"
              rel="noreferrer"
              aria-label="View source on GitHub"
              title="View source on GitHub"
            >
              <Github size={18} />
            </a>
            <span className="topbar-separator" />
            <button
              className={`connection-status ${connected ? "connected" : ""}`}
              onClick={() => openConnection()}
              disabled={busy}
            >
              <span className="status-dot" />
              {connected ? "Connected" : "Connect model"}
            </button>
          </div>
        </header>
        <div
          className={`workspace-layout ${view !== "workspace" ? "full-width" : ""}`}
        >
          <main className="main-content">
            {view === "workspace" && !active && (
              <div className="home-view">
                <div className="hero">
                  <div className="hero-kicker">
                    <Terminal size={16} />
                    <span>Your local coding workspace</span>
                  </div>
                  <h1>What do you want to build?</h1>
                  <p>Plan, write, and improve code with your local models.</p>
                </div>
                <div className="workspace-select-row">
                  <button
                    className="workspace-select"
                    onClick={() => void chooseWorkspace()}
                    disabled={busy || pickingWorkspace}
                    title={health?.workspace || "Choose your project folder"}
                  >
                    {pickingWorkspace ? (
                      <Loader2 size={15} className="spin" />
                    ) : (
                      <FolderOpen size={15} />
                    )}
                    <span>
                      {pickingWorkspace
                        ? "Waiting for folder selection…"
                        : "Open folder"}
                    </span>
                    <ChevronDown size={12} />
                  </button>
                </div>
                {composer}
                <div className="suggestions">
                  {suggestions.map((s, i) => (
                    <button
                      key={s.kind}
                      className="suggestion"
                      onClick={() => {
                        setPrompt(s.prompt);
                        setMode(i === 0 ? "ask" : "agent");
                        textArea.current?.focus();
                      }}
                    >
                      <span className="suggestion-icon">
                        {i === 0 ? (
                          <Search size={18} />
                        ) : i === 1 ? (
                          <Code2 size={18} />
                        ) : (
                          <Zap size={18} />
                        )}
                      </span>
                      <strong>{s.title}</strong>
                    </button>
                  ))}
                </div>
                <button
                  className="runtime-card"
                  onClick={openConnection}
                  disabled={busy}
                >
                  <span className="runtime-card-icon">
                    <Cpu size={22} />
                  </span>
                  <span className="runtime-card-copy">
                    <strong>
                      {connected ? settings.model : "Connect your local model"}
                    </strong>
                    <span>
                      {connected
                        ? `${settings.provider === "ollama" ? "Ollama" : "llama.cpp"} · ${workspace}`
                        : "Use Ollama or llama.cpp. Your code stays on your machine."}
                    </span>
                  </span>
                  <span className="runtime-card-action">
                    {connected ? "Manage" : "Set up"}
                    <ArrowRight size={15} />
                  </span>
                </button>
                {threads.some((t) => !t.demo) && (
                  <div className="recent-section">
                    <div className="section-title">
                      <h2>Recent tasks</h2>
                      <button onClick={() => setView("activity")}>
                        View all
                        <ArrowRight size={12} />
                      </button>
                    </div>
                    {threads
                      .filter((t) => !t.demo)
                      .slice(0, 3)
                      .map((t) => (
                        <button
                          className="recent-task"
                          key={t.id}
                          onClick={() => {
                            if (!busy) setSelected(t.id);
                          }}
                          disabled={busy}
                        >
                          <span className="recent-icon">
                            <MessageSquare size={16} />
                          </span>
                          <span>
                            <strong>{t.title}</strong>
                            <small>
                              {t.demo
                                ? "Sample task · explore the experience"
                                : `${t.messages.filter((m) => m.role === "user").length} messages · ${t.tools.length} tool calls`}
                            </small>
                          </span>
                          <span className="recent-time">
                            {formatTime(t.updated)}
                          </span>
                          <ChevronRight size={14} />
                        </button>
                      ))}
                  </div>
                )}
                <div className="home-footer">
                  <ShieldCheck size={13} />
                  <span>
                    You review every file change and terminal command.
                  </span>
                </div>
              </div>
            )}
            {view === "workspace" && active && (
              <div className="conversation-view">
                <div className="conversation-header">
                  <div>
                    <span className="eyebrow">
                      {active.demo ? "ILLUSTRATIVE DEMO" : "LOCAL TASK"}
                    </span>
                    <h1>{active.title}</h1>
                  </div>
                  <button
                    className="icon-button"
                    title="Copy conversation"
                    aria-label="Copy conversation"
                    onClick={() =>
                      void copy(
                        active.messages
                          .map((m) => `${m.role}: ${m.content}`)
                          .join("\n\n"),
                      )
                    }
                  >
                    <Copy size={16} />
                  </button>
                </div>
                <div className="conversation-messages" aria-live="polite">
                  {active.messages.map((message) => (
                    <article
                      className={`message ${message.role}`}
                      key={message.id}
                    >
                      <div className={`message-avatar ${message.role}`}>
                        {message.role === "user" ? "Y" : <Terminal size={16} />}
                      </div>
                      <div className="message-body">
                        <div className="message-heading">
                          {message.role === "user" ? "You" : "Codex Local"}
                          {message.demo && <span>Demo</span>}
                        </div>
                        <Text content={message.content} />
                      </div>
                    </article>
                  ))}
                  {active.tools.length > 0 && (
                    <div className="tools-block">
                      <div className="tools-heading">
                        <Terminal size={13} />
                        {active.demo ? "Sample tool activity" : "Tool activity"}
                        <span>{active.tools.length}</span>
                      </div>
                      {active.tools.map((tool) => (
                        <ToolRow tool={tool} key={tool.id} />
                      ))}
                    </div>
                  )}
                  {approval && (
                    <div className="approval-card">
                      <div className="approval-title">
                        <ShieldCheck size={18} />
                        <strong>Your approval is needed</strong>
                      </div>
                      <p>
                        The agent wants to{" "}
                        {approval.tool === "write_file"
                          ? "write a file"
                          : "run a terminal command"}
                        .
                      </p>
                      {approval.tool === "run_command" && (
                        <p className="approval-warning">
                          This runs with your account permissions and may access
                          files outside the workspace.
                        </p>
                      )}
                      <pre>
                        {approval.tool === "write_file"
                          ? `${approval.args.path}\n\n${approval.args.content}`
                          : String(approval.args.command)}
                      </pre>
                      <div className="approval-actions">
                        <button
                          className="button secondary"
                          disabled={decidingApproval}
                          onClick={() => void decide(false)}
                        >
                          Deny
                        </button>
                        <button
                          className="button primary"
                          disabled={decidingApproval}
                          onClick={() => void decide(true)}
                        >
                          Approve this action
                          <Check size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                  {error && (
                    <div className="inline-error" role="alert">
                      <X size={16} />
                      <span>{error}</span>
                      <button onClick={() => openConnection()}>
                        Check connection
                      </button>
                    </div>
                  )}
                  {busy && (
                    <div className="working-status">
                      <Loader2 className="spin" size={14} />
                      {runStatus}
                    </div>
                  )}
                  <div ref={messageEnd} />
                </div>
                <div className="conversation-composer">
                  {composer}
                  <p className="conversation-note">
                    {mode === "agent"
                      ? "File changes and commands require your approval."
                      : "Ask mode uses read-only tools."}
                  </p>
                </div>
              </div>
            )}
            {view === "activity" && (
              <div className="secondary-view">
                <span className="eyebrow">Workspace</span>
                <h1>Task history</h1>
                <p className="view-subtitle">
                  Your conversations and tool activity, saved on this device.
                </p>
                <div className="activity-stats">
                  <div>
                    <span>Tasks started</span>
                    <strong>
                      {threads
                        .filter((t) => !t.demo)
                        .length.toString()
                        .padStart(2, "0")}
                    </strong>
                  </div>
                  <div>
                    <span>Tools completed</span>
                    <strong>{toolCount.toString().padStart(2, "0")}</strong>
                  </div>
                  <div>
                    <span>Execution</span>
                    <strong className="stat-local">
                      <span className="status-dot" />
                      Local
                    </strong>
                  </div>
                </div>
                <div className="section-title">
                  <h2>Your task history</h2>
                  <button onClick={newTask}>
                    <Plus size={13} />
                    New task
                  </button>
                </div>
                {threads.map((t) => (
                  <div className="activity-row" key={t.id}>
                    <button
                      onClick={() => {
                        if (!busy) {
                          setSelected(t.id);
                          setView("workspace");
                        }
                      }}
                      disabled={busy}
                    >
                      <MessageSquare size={17} />
                      <span>
                        <strong>{t.title}</strong>
                        <small>
                          {t.demo
                            ? "Illustrative demo"
                            : `${t.messages.length} messages · ${t.tools.length} tool calls`}
                        </small>
                      </span>
                      <span className="recent-time">
                        {formatTime(t.updated)}
                      </span>
                      <ArrowRight size={15} />
                    </button>
                    <button
                      className="icon-button delete-task"
                      title="Remove task"
                      aria-label={`Remove ${t.title}`}
                      disabled={busy}
                      onClick={() => {
                        setThreads((old) =>
                          old.filter((item) => item.id !== t.id),
                        );
                        if (selected === t.id) setSelected(null);
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {view === "guide" && (
              <div className="secondary-view guide-view">
                <span className="eyebrow">Getting started</span>
                <h1>Set up your workspace</h1>
                <p className="view-subtitle">
                  Connect a local model and give it a project to work on.
                </p>
                <div className="guide-step">
                  <span className="step-number">01</span>
                  <div>
                    <h2>Bring a local model</h2>
                    <p>
                      Start Ollama or llama.cpp with a model that supports
                      native tool calling. For llama.cpp, enable{" "}
                      <code>--jinja</code> and use the model’s compatible chat
                      template.
                    </p>
                    <div className="provider-links">
                      <a
                        href="https://docs.ollama.com/capabilities/tool-calling"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ollama tool guide
                        <ArrowRight size={13} />
                      </a>
                      <a
                        href="https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md"
                        target="_blank"
                        rel="noreferrer"
                      >
                        llama.cpp tool guide
                        <ArrowRight size={13} />
                      </a>
                    </div>
                  </div>
                </div>
                <div className="guide-step">
                  <span className="step-number">02</span>
                  <div>
                    <h2>Open your workspace</h2>
                    <p>
                      Install Codex Local, build the app, and start the runtime.
                      Then choose your project using Open folder.
                    </p>
                    <div className="code-block">
                      <button
                        className="icon-button"
                        onClick={() =>
                          void copy(
                            "git clone https://github.com/ahpah-dev/codex-local.git\ncd codex-local\nnpm install\nnpm run build\nnpm start",
                          )
                        }
                        aria-label="Copy setup commands"
                      >
                        <Copy size={13} />
                      </button>
                      <pre>
                        git clone https://github.com/ahpah-dev/codex-local.git
                        {`\n`}cd codex-local{`\n`}npm install{`\n`}npm run build
                        {`\n`}npm start
                      </pre>
                    </div>
                    <p className="small-text">
                      Then open <code>http://127.0.0.1:4318</code> and click
                      Open folder.
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span className="step-number">03</span>
                  <div>
                    <h2>Check your connection. Then create.</h2>
                    <p>
                      Choose your provider and model, and run the tool
                      diagnostic. Ask mode explores with read-only tools. Agent
                      mode can propose file edits and terminal commands, each
                      with your approval.
                    </p>
                    <button
                      className="button primary"
                      onClick={() => openConnection()}
                    >
                      Connect your runtime
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
                <div className="guide-note">
                  <ShieldCheck size={19} />
                  <p>
                    <strong>You’re in control.</strong> File tools stay inside
                    your selected workspace. Approved shell commands run with
                    your account’s permissions; they are not an operating system
                    sandbox. Review every command before approving it.
                  </p>
                </div>
                <p className="independent-note">
                  An independent, open-source project inspired by the focus of
                  Codex. Not affiliated with or endorsed by OpenAI.
                  Compatibility depends on your model, template, and provider
                  version.
                </p>
              </div>
            )}
          </main>
          {view === "workspace" && rightTab === "files" && (
            <aside className="context-panel" aria-label="Workspace files">
              <div className="context-tabs">
                <div className="file-drawer-title">
                  <FolderOpen size={17} />
                  <strong>Workspace files</strong>
                </div>
                <div className="file-drawer-actions">
                  <button
                    className="icon-button"
                    aria-label="Choose project folder"
                    title="Open folder"
                    onClick={() => void chooseWorkspace()}
                    disabled={busy || pickingWorkspace}
                  >
                    {pickingWorkspace ? (
                      <Loader2 size={17} className="spin" />
                    ) : (
                      <FolderOpen size={17} />
                    )}
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Close files panel"
                    title="Close files"
                    onClick={() => setRightTab("overview")}
                  >
                    <PanelRightClose size={18} />
                  </button>
                </div>
              </div>
              <div className="file-panel">
                <div className="panel-section-heading">
                  {health ? "WORKSPACE FILES" : "SAMPLE FILES"}
                  <button
                    className="icon-button"
                    title="Go to root"
                    aria-label="Go to root folder"
                    onClick={() => {
                      setFolder("");
                      setOpenFile(null);
                    }}
                  >
                    <FolderOpen size={14} />
                  </button>
                </div>
                {folder && (
                  <button
                    className="folder-back"
                    onClick={() =>
                      setFolder(folder.split("/").slice(0, -1).join("/"))
                    }
                  >
                    ← Parent directory
                  </button>
                )}
                {fileLoading && (
                  <p className="muted">
                    <Loader2 size={14} className="spin" />
                    Loading files…
                  </p>
                )}
                {fileError && (
                  <p className="error" role="alert">
                    {fileError}
                  </p>
                )}
                {files.map((entry) => (
                  <button
                    className={`file-entry ${openFile?.path === entry.path ? "active" : ""}`}
                    key={entry.path}
                    onClick={() => void openEntry(entry)}
                  >
                    {entry.type === "directory" ? (
                      <Folder size={14} />
                    ) : (
                      <FileCode2 size={14} />
                    )}
                    <span>{entry.name}</span>
                    {entry.type === "directory" && <ChevronRight size={12} />}
                  </button>
                ))}
                {!health && (
                  <p className="sample-notice">
                    Illustrative project. Connect locally to browse your files.
                  </p>
                )}
                {openFile && (
                  <div className="file-preview">
                    <div>
                      <span>{openFile.path}</span>
                      <button
                        className="icon-button"
                        aria-label="Close file preview"
                        onClick={() => setOpenFile(null)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <pre>{openFile.content}</pre>
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
        <footer className="statusbar">
          <span className="runtime-indicator">
            <span
              className={"status-dot " + (connected ? "connected" : "neutral")}
            />
            {health ? "Local runtime connected" : "Preview workspace"}
          </span>
          <span className="footer-safety">
            Codex Local can make mistakes. Review its work.
          </span>
          <span className="statusbar-shortcut">Ctrl ↵ to send</span>
        </footer>
      </div>
      {showConnection && (
        <ConnectionDialog
          settings={settings}
          onClose={() => setShowConnection(false)}
          onSave={(next, h) => {
            initialConnection.current?.abort();
            if (health && health.workspace !== h.workspace) {
              setSelected(null);
              setPrompt("");
              setFolder("");
              setOpenFile(null);
            }
            setSettings(next);
            setHealth(h);
            setConnected(true);
            setShowConnection(false);
            setToast("Local model connected");
          }}
        />
      )}
      {showWorkspace && (
        <WorkspaceDialog
          settings={settings}
          error={workspaceError}
          busy={pickingWorkspace}
          onClose={() => {
            workspaceController.current?.abort();
            setShowWorkspace(false);
          }}
          onRetry={(url) => void chooseWorkspace(url)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={14} />
          {toast}
        </div>
      )}
    </div>
  );
}
