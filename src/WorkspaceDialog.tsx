import { m } from "motion/react";
import { backdropVariants, dialogVariants } from "./motion";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, FolderOpen, Loader2, X } from "lucide-react";
import type { Settings } from "./types";

type Props = {
  settings: Settings;
  error: string;
  busy: boolean;
  onClose: () => void;
  onRetry: (runtimeUrl: string) => void;
};
export default function WorkspaceDialog({
  settings,
  error,
  busy,
  onClose,
  onRetry,
}: Props) {
  const [url, setUrl] = useState(settings.runtimeUrl);
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const remote = !["localhost", "127.0.0.1", "[::1]"].includes(
    location.hostname,
  );
  const command = `npm start${remote ? ` -- --allow-origin ${location.origin}` : ""}`;
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    input.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),a[href]",
        ) || [],
      ).filter((element) => element.getClientRects().length);
      const first = controls[0],
        last = controls[controls.length - 1];
      if (!dialog.current?.contains(document.activeElement)) {
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
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <m.div
      variants={backdropVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <m.div
        variants={dialogVariants}
        className="modal workspace-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-title"
        aria-describedby="workspace-description"
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">Workspace</span>
            <h2 id="workspace-title">Open a project folder</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close folder setup"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <p className="muted" id="workspace-description">
          The local runtime opens your computer’s folder picker and gives the
          agent access to the project you choose. No model connection is needed
          to select a folder.
        </p>
        {error && (
          <p className="error workspace-error" role="alert">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor="workspace-runtime">Local runtime URL</label>
          <input
            id="workspace-runtime"
            ref={input}
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={busy}
          />
        </div>
        <div className="workspace-setup">
          <strong>Start the runtime</strong>
          <p className="muted">
            In your Codex Local checkout, run <code>git pull</code>, then{" "}
            <code>npm install</code> and <code>npm run build</code>. Start the
            updated runtime:
          </p>
          <div className="code-block">
            <pre>{command}</pre>
            <button
              className="icon-button"
              onClick={() => void copy()}
              aria-label="Copy runtime command"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
          <p className="muted">
            Keep it running, then choose a folder below. The system dialog opens
            on the computer running the runtime.
          </p>
        </div>
        <div className="conn-footer">
          <button className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !url.trim()}
            onClick={() => onRetry(url.trim())}
          >
            {busy ? (
              <Loader2 className="spin" size={15} />
            ) : (
              <FolderOpen size={16} />
            )}{" "}
            {busy ? "Waiting for folder selection…" : "Choose folder"}
          </button>
        </div>
      </m.div>
    </m.div>
  );
}
