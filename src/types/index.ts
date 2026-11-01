export type ContextMode = "auto" | "selection" | "document" | "general";
export type ActionKind = "explain" | "simple" | "example" | "why" | "deep";
export interface SourceLocator {
  headingId?: string;
  cssSelector?: string;
  textQuote: string;
  prefix?: string;
  suffix?: string;
}
export interface DocumentSection {
  id: string;
  headingPath: string[];
  content: string;
  type: "text" | "code" | "table" | "math";
  locator: SourceLocator;
  order: number;
}
export interface DocumentContext {
  id: string;
  url: string;
  title: string;
  contentHash: string;
  extractedAt: number;
  sections: DocumentSection[];
  coverage: "complete" | "partial";
  warnings: string[];
  characterCount: number;
}
export interface SelectionContext {
  text: string;
  surrounding: string;
  url: string;
  title: string;
  locator: SourceLocator;
  kind: "text" | "code" | "math";
}
export interface Preferences {
  language: string;
  detail: "brief" | "normal" | "deep";
  theme: "system" | "light" | "dark";
  overlay: boolean;
  stream: boolean;
  retainHistory: boolean;
  allowFullDocument: boolean;
  blockedDomains: string[];
  consent: boolean;
  contextBudget: number;
}
export interface ModelConfig {
  provider: "deepseek" | "compatible";
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens: number;
  keyMode: "session" | "local";
}
export interface Credentials {
  apiKey: string;
}
export interface Citation {
  id: string;
  section: DocumentSection;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  citations?: Citation[];
  status?: "done" | "stopped" | "error";
  notice?: string;
  usage?: { input?: number; output?: number };
}
export interface Conversation {
  id: string;
  documentId: string;
  contentHash?: string;
  url: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export const DEFAULT_PREFERENCES: Preferences = {
  language: "中文",
  detail: "normal",
  theme: "system",
  overlay: true,
  stream: true,
  retainHistory: true,
  allowFullDocument: false,
  blockedDomains: [],
  consent: false,
  contextBudget: 12000,
};
export const DEFAULT_MODEL: ModelConfig = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "",
  temperature: 0.3,
  maxTokens: 2048,
  keyMode: "session",
};
