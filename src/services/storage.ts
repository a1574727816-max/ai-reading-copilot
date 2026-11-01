import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  DEFAULT_MODEL,
  DEFAULT_PREFERENCES,
  type Conversation,
  type DocumentContext,
  type ModelConfig,
  type Preferences,
} from "../types";
interface ReaderDB extends DBSchema {
  documents: { key: string; value: DocumentContext };
  conversations: {
    key: string;
    value: Conversation;
    indexes: { "by-document": string };
  };
}
let connection: Promise<IDBPDatabase<ReaderDB>> | undefined;
const db = () =>
  (connection ??= openDB<ReaderDB>("reading-copilot", 1, {
    upgrade(d) {
      d.createObjectStore("documents", { keyPath: "id" });
      const c = d.createObjectStore("conversations", { keyPath: "id" });
      c.createIndex("by-document", "documentId");
    },
    terminated() {
      connection = undefined;
    },
  }));
export async function secureStorage() {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  await chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
}
export async function loadSettings(): Promise<{
  preferences: Preferences;
  config: ModelConfig;
}> {
  const data = (await chrome.storage.local.get([
    "preferences",
    "modelConfig",
  ])) as {
    preferences?: Partial<Preferences>;
    modelConfig?: Partial<ModelConfig>;
  };
  return {
    preferences: { ...DEFAULT_PREFERENCES, ...data.preferences },
    config: { ...DEFAULT_MODEL, ...data.modelConfig },
  };
}
export async function savePreferences(preferences: Preferences) {
  await chrome.storage.local.set({ preferences });
}
export async function loadKey(): Promise<string> {
  const { config } = await loadSettings();
  const area =
    config.keyMode === "local" ? chrome.storage.local : chrome.storage.session;
  const data = await area.get("apiKey");
  return typeof data.apiKey === "string" ? data.apiKey : "";
}
export async function saveModel(config: ModelConfig, key: string) {
  await secureStorage();
  await chrome.storage.local.remove("apiKey");
  await chrome.storage.session.remove("apiKey");
  await (
    config.keyMode === "local" ? chrome.storage.local : chrome.storage.session
  ).set({ apiKey: key.trim() });
  await chrome.storage.local.set({ modelConfig: config });
}
export async function clearCredentials() {
  await chrome.storage.local.remove("apiKey");
  await chrome.storage.session.remove("apiKey");
}
export async function cacheDocument(doc: DocumentContext) {
  const d = await db();
  await d.put("documents", doc);
  const all = await d.getAll("documents");
  if (all.length > 30) {
    const sorted = all.sort((a, b) => a.extractedAt - b.extractedAt);
    await Promise.all(
      sorted.slice(0, all.length - 30).map((x) => d.delete("documents", x.id)),
    );
  }
}
export async function getCachedDocument(id: string) {
  return (await db()).get("documents", id);
}
export async function saveConversation(conversation: Conversation) {
  await (await db()).put("conversations", conversation);
}
export async function conversationsFor(documentId: string) {
  return (
    await (
      await db()
    ).getAllFromIndex("conversations", "by-document", documentId)
  ).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function listConversations() {
  return (await (await db()).getAll("conversations")).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}
export async function removeConversation(id: string) {
  await (await db()).delete("conversations", id);
}
export async function clearDocuments() {
  await (await db()).clear("documents");
}
export async function clearHistory() {
  await (await db()).clear("conversations");
}
