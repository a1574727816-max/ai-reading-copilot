import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  cacheDocument,
  clearDocuments,
  clearHistory,
  conversationsFor,
  getCachedDocument,
  listConversations,
  removeConversation,
  saveConversation,
} from "../../src/services/storage";
import type { Conversation, DocumentContext } from "../../src/types";
const doc: DocumentContext = {
  id: "doc-a",
  url: "https://example.com/a",
  title: "A",
  contentHash: "one",
  extractedAt: 1,
  sections: [],
  coverage: "complete",
  warnings: [],
  characterCount: 0,
};
const conversation: Conversation = {
  id: "session-a",
  documentId: "doc-a",
  url: doc.url,
  title: "A",
  updatedAt: 1,
  messages: [],
};
describe("文档缓存与历史独立清理", () => {
  afterEach(async () => {
    await clearDocuments();
    await clearHistory();
  });
  it("按文档恢复会话且不混入其他页面", async () => {
    await saveConversation(conversation);
    await saveConversation({
      ...conversation,
      id: "session-b",
      documentId: "doc-b",
    });
    expect((await conversationsFor("doc-a")).map((c) => c.id)).toEqual([
      "session-a",
    ]);
    await removeConversation("session-a");
    expect(await conversationsFor("doc-a")).toEqual([]);
  });
  it("缓存与会话可以单独清理", async () => {
    await cacheDocument(doc);
    await saveConversation(conversation);
    await clearDocuments();
    expect(await getCachedDocument("doc-a")).toBeUndefined();
    expect(await listConversations()).toHaveLength(1);
    await cacheDocument(doc);
    await clearHistory();
    expect(await listConversations()).toEqual([]);
    expect(await getCachedDocument("doc-a")).toBeDefined();
  });
});
