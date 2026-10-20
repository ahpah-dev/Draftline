export type Provider = "ollama" | "llamacpp";
export type View = "workspace" | "activity" | "guide";
export type ToolEvent = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  state: string;
  result?: unknown;
};
export type Approval = {
  id: string;
  runId: string;
  tool: string;
  args: Record<string, unknown>;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  demo?: boolean;
};
export type Thread = {
  id: string;
  title: string;
  updated: number;
  messages: Message[];
  tools: ToolEvent[];
  history?: unknown[];
  connection?: string;
  demo?: boolean;
};
export type Settings = {
  provider: Provider;
  baseUrl: string;
  model: string;
  runtimeUrl: string;
};
export type Health = {
  ok: boolean;
  workspace: string;
  sessionToken: string;
  version: string;
};
export type FileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
};
