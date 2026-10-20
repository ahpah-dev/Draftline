import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, Copy, LoaderCircle, Plug, ShieldCheck, Terminal, X, XCircle } from 'lucide-react';
import { health, request } from './api';
import type { Health, Provider, Settings } from './types';

type Props = {
  settings: Settings;
  onSave: (settings: Settings, health: Health, models: string[]) => void;
  onClose: () => void;
};
type CheckResult = { name: string; ok: boolean; detail: string };
type DiagnosticResult = { ok: boolean; checks: CheckResult[] };
const defaults: Record<Provider, string> = { ollama: 'http://localhost:11434', llamacpp: 'http://localhost:8080' };

function normalizeUrl(value: string, label: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(`${label} must be a complete http:// or https:// URL.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be an HTTP URL without credentials, a query, or a fragment.`);
  }
  return url.toString().replace(/\/$/, '');
}

export default function ConnectionDialog({ settings, onSave, onClose }: Props) {
  const [form, setForm] = useState<Settings>({ ...settings, runtimeUrl: settings.runtimeUrl || 'http://127.0.0.1:4318', baseUrl: settings.baseUrl || defaults[settings.provider] });
  const [connected, setConnected] = useState<Health | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<'connect' | 'diagnostics' | null>(null);
  const [error, setError] = useState('');
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult | null>(null);
  const [copied, setCopied] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const elements = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || []).filter(element => element.getClientRects().length > 0);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); modalRef.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !modalRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !modalRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); controllerRef.current?.abort(); previousFocus?.focus(); };
  }, []);

  const origin = window.location.origin;
  const needsOrigin = !['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
  const setupCommand = `git clone https://github.com/ahpah-dev/codex-local.git\ncd codex-local\nnpm install\nnpm run build\nnpm start -- --workspace /path/to/project${needsOrigin ? ` --origin ${origin}` : ''}`;

  function update(field: keyof Settings, value: string) {
    setForm(current => ({ ...current, [field]: value }));
    setError('');
    setDiagnostics(null);
    if (field !== 'model') { setConnected(null); setModels([]); }
  }

  function changeProvider(provider: Provider) {
    setForm(current => ({ ...current, provider, baseUrl: provider === settings.provider ? settings.baseUrl || defaults[provider] : defaults[provider], model: provider === settings.provider ? settings.model : '' }));
    setConnected(null); setModels([]); setError(''); setDiagnostics(null);
  }

  function checkedSettings(): Settings {
    return { ...form, runtimeUrl: normalizeUrl(form.runtimeUrl, 'Runtime URL'), baseUrl: normalizeUrl(form.baseUrl, 'Provider URL'), model: form.model.trim() };
  }

  async function connect() {
    const controller = new AbortController();
    controllerRef.current?.abort(); controllerRef.current = controller;
    setBusy('connect'); setError(''); setConnected(null); setModels([]); setDiagnostics(null);
    try {
      const config = checkedSettings();
      const runtime = await health(config, controller.signal);
      if (!runtime.ok || !runtime.sessionToken) throw new Error('The local runtime did not return a valid session. Check its terminal and restart it.');
      const result = await request<{ models: { id: string }[]; model?: string }>(config.runtimeUrl, '/api/connect', runtime.sessionToken, { provider: config.provider, baseUrl: config.baseUrl, model: config.model }, undefined, controller.signal);
      const available = [...new Set((result.models || []).map(model => model.id).filter(Boolean))];
      if (!available.length) throw new Error(config.provider === 'ollama' ? 'Ollama is reachable, but has no models. Pull a tool-capable model in Ollama, then connect again.' : 'The llama.cpp server did not list a loaded model. Start llama-server with a model, then connect again.');
      const selected = available.includes(config.model) ? config.model : result.model && available.includes(result.model) ? result.model : available[0];
      if (controller.signal.aborted) return;
      setForm({ ...config, model: selected }); setModels(available); setConnected(runtime);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not connect. Check that the runtime and model server are running.');
    } finally { if (!controller.signal.aborted) setBusy(null); }
  }

  async function runDiagnostics() {
    if (!connected || !form.model) return;
    const controller = new AbortController();
    controllerRef.current?.abort(); controllerRef.current = controller;
    setBusy('diagnostics'); setError(''); setDiagnostics(null);
    try {
      const config = checkedSettings();
      const result = await request<DiagnosticResult>(config.runtimeUrl, '/api/diagnostics', connected.sessionToken, { provider: config.provider, baseUrl: config.baseUrl, model: config.model }, undefined, controller.signal);
      if (controller.signal.aborted) return;
      const checks = Array.isArray(result.checks) ? result.checks : [];
      setDiagnostics({ ok: result.ok === true && checks.length > 0 && checks.every(check => check.ok === true), checks });
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The tool diagnostic could not finish.');
    } finally { if (!controller.signal.aborted) setBusy(null); }
  }

  async function copySetup() {
    try { await navigator.clipboard.writeText(setupCommand); setCopied(true); } catch { setError('Clipboard access is unavailable. Select and copy the setup commands below.'); }
  }

  return (
    <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal conn-modal" role="dialog" aria-modal="true" aria-labelledby="connection-title" aria-describedby="connection-description" ref={modalRef} tabIndex={-1}>
        <div className="modal-head">
          <div><div className="eyebrow">YOUR MACHINE. YOUR MODELS.</div><h2 id="connection-title">Connect a local model</h2></div>
          <button className="icon-button" type="button" aria-label="Close connection settings" onClick={onClose}><X size={20} /></button>
        </div>
        <p className="muted" id="connection-description">A small local runtime gives your model access to your project, terminal, and coding tools.</p>

        <div className="conn-provider-tabs" role="group" aria-label="Model provider">
          <button type="button" className={`conn-provider${form.provider === 'ollama' ? ' active' : ''}`} aria-pressed={form.provider === 'ollama'} disabled={!!busy} onClick={() => changeProvider('ollama')}><span>Ollama</span><small>Local model library</small></button>
          <button type="button" className={`conn-provider${form.provider === 'llamacpp' ? ' active' : ''}`} aria-pressed={form.provider === 'llamacpp'} disabled={!!busy} onClick={() => changeProvider('llamacpp')}><span>llama.cpp</span><small>OpenAI-compatible server</small></button>
        </div>

        <div className="conn-fields">
          <div className="field"><label htmlFor="provider-url">{form.provider === 'ollama' ? 'Ollama' : 'llama.cpp'} URL</label><input id="provider-url" type="url" spellCheck={false} autoComplete="off" value={form.baseUrl} onChange={event => update('baseUrl', event.target.value)} disabled={!!busy} ref={inputRef} /></div>
          <div className="field"><label htmlFor="runtime-url">Local runtime URL</label><input id="runtime-url" type="url" spellCheck={false} autoComplete="off" value={form.runtimeUrl} onChange={event => update('runtimeUrl', event.target.value)} disabled={!!busy} /></div>
        </div>
        <div className="conn-connect-row">
          <span className="muted conn-connect-note"><span className={`status-dot${connected ? ' connected' : ''}`} />{connected ? 'Model server connected' : 'Waiting for a local connection'}</span>
          <button className="button secondary" type="button" onClick={connect} disabled={!!busy}>{busy === 'connect' ? <LoaderCircle size={15} className="spin" /> : <Plug size={15} />}{busy === 'connect' ? 'Connecting…' : connected ? 'Reconnect' : 'Connect'}</button>
        </div>

        {connected && <div className="conn-connected">
          <div className="field"><label htmlFor="connection-model">Model</label><select id="connection-model" value={form.model} onChange={event => update('model', event.target.value)} disabled={!!busy}>{models.map(model => <option key={model} value={model}>{model}</option>)}</select></div>
          <p className="muted conn-workspace">Workspace <code>{connected.workspace}</code></p>
          <div className="conn-diagnostic-action"><div><strong>Check tool compatibility</strong><p className="muted">Test the selected model’s tool calls before starting a run.</p></div><button className="button secondary" type="button" onClick={runDiagnostics} disabled={!!busy || !form.model}>{busy === 'diagnostics' ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}{busy === 'diagnostics' ? 'Testing…' : 'Run check'}</button></div>
        </div>}

        {diagnostics && <div className={`conn-diagnostics ${diagnostics.ok ? 'success' : 'error'}`} role="status"><strong>{diagnostics.ok ? 'Tool checks passed' : 'Tool checks did not pass'}</strong>{diagnostics.checks.length ? <ul>{diagnostics.checks.map((check, index) => <li key={`${check.name}-${index}`}>{check.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}<div><span>{check.name}</span><p>{check.detail}</p></div></li>)}</ul> : <p>The runtime returned no check results. Try again before relying on this model’s tool support.</p>}</div>}
        {error && <div className="error conn-error" role="alert"><XCircle size={16} /><span>{error}</span></div>}

        <details className="conn-setup" open={!connected}>
          <summary><Terminal size={16} /><span>Start the local runtime</span></summary>
          <p className="muted">Install Node.js 22 or later. Run these commands in your terminal and replace <code>/path/to/project</code> with your project folder.</p>
          <div className="conn-code-wrap"><pre className="code-block"><code>{setupCommand}</code></pre><button className="icon-button conn-copy" type="button" onClick={copySetup} aria-label={copied ? 'Setup commands copied' : 'Copy setup commands'}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></div>
          <p className="muted">Start {form.provider === 'ollama' ? 'Ollama with a tool-capable model installed' : 'llama-server with your model and --jinja enabled'}. Keep both servers running. Your browser may ask to allow access to your local network.</p>
          {needsOrigin && <p className="muted">The <code>--origin</code> flag permits this website to reach your runtime. Files and commands run on your machine.</p>}
        </details>

        <div className="conn-footer"><span className="muted">{diagnostics?.ok ? 'Selected model passed the tool check.' : 'Compatibility depends on the selected model.'}</span><button className="button primary" type="button" disabled={!connected || !form.model || !!busy} onClick={() => { if (connected) onSave(checkedSettings(), connected, models); }}>Use this connection<ArrowRight size={16} /></button></div>
      </div>
    </div>
  );
}
