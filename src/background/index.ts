import type { ActionKind, DocumentContext, SelectionContext } from "../types";
import { canonicalUrl, errorText, isBlocked, readableUrl } from "../utils";
import {
  loadKey,
  loadSettings,
  savePreferences,
  secureStorage,
} from "../services/storage";
import { createProvider } from "../services/llm";
import { systemPrompt } from "../services/context";
import { retrieve } from "../services/retrieval";
const ready = secureStorage();
const quickRequests = new Map<number, AbortController>();
const toggles = new Map<number, Promise<void>>();
interface ReadingPage {
  url: string;
  // A fresh content-script lifetime prevents a same-URL reload inheriting mode.
  pageId: string;
}
async function readingPage(tabId: number): Promise<ReadingPage | undefined> {
  const key = "reader-" + tabId;
  return (await chrome.storage.session.get(key))[key] as
    ReadingPage | undefined;
}
async function syncMenu(tabId: number) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== tabId) return;
  const active = !!(await readingPage(tabId));
  await chrome.contextMenus
    .update("reader-toggle", {
      title: active ? "关闭阅读助手" : "打开阅读助手",
    })
    .catch(() => {});
}
async function disableReader(tabId: number, notice = "") {
  quickRequests.get(tabId)?.abort();
  quickRequests.delete(tabId);
  await chrome.storage.session.remove(["reader-" + tabId, "pending-" + tabId]);
  await chrome.tabs
    .sendMessage(tabId, { type: "READER_STATE", enabled: false, notice })
    .catch(() => {});
  await chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  await chrome.action
    .setTitle({ tabId, title: "打开/关闭阅读助手" })
    .catch(() => {});
  await syncMenu(tabId);
}
async function toggleReader(tabId: number) {
  await ready;
  const tab = await checkedTab(tabId);
  await inject(tabId);
  const ping = await chrome.tabs.sendMessage(tabId, { type: "PING" });
  const active = await readingPage(tabId);
  if (active?.pageId === ping.data.pageId) {
    await disableReader(tabId, "阅读助手已关闭");
    return;
  }
  // EXTRACT caches the document in this page; activating never opens a sidebar.
  const doc = await readTab(tabId);
  const state: ReadingPage = {
    url: canonicalUrl(doc.url),
    pageId: ping.data.pageId,
  };
  await chrome.storage.session.set({ ["reader-" + tabId]: state });
  const { preferences } = await loadSettings();
  const result = await chrome.tabs.sendMessage(tabId, {
    type: "READER_STATE",
    enabled: preferences.overlay,
    theme: preferences.theme,
    ...state,
    notice: preferences.overlay
      ? `阅读助手已打开 · 已读取 ${doc.sections.length} 个片段，选中文字即可使用${doc.coverage === "partial" ? "（部分内容未提取）" : ""}`
      : "文档已读取；划词浮层已在设置中关闭",
  });
  if (!result?.ok) throw new Error("网页已变化，请重新打开阅读助手。");
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#235f4b" });
  await chrome.action.setBadgeText({ tabId, text: "ON" });
  await chrome.action.setTitle({ tabId, title: "打开/关闭阅读助手" });
  await syncMenu(tabId);
  void chrome.runtime
    .sendMessage({ type: "READ_REQUESTED", tabId, windowId: tab.windowId })
    .catch(() => {});
}
function requestToggle(tab: chrome.tabs.Tab) {
  if (tab.id === undefined) return;
  const tabId = tab.id;
  const task = (toggles.get(tabId) || Promise.resolve())
    .then(() => toggleReader(tabId))
    .catch(async (error) => {
      await disableReader(tabId);
      await chrome.action.setBadgeText({ tabId, text: "!" }).catch(() => {});
      await chrome.action
        .setTitle({ tabId, title: errorText(error) })
        .catch(() => {});
      await chrome.tabs
        .sendMessage(tabId, { type: "READER_NOTICE", text: errorText(error) })
        .catch(() => {});
    })
    .finally(() => {
      if (toggles.get(tabId) === task) toggles.delete(tabId);
    });
  toggles.set(tabId, task);
}
const actionPrompt: Record<ActionKind, string> = {
  explain:
    "解释这个词语或这段内容。给出简明定义、当前上下文中的含义，必要时给一个例子。",
  simple: "用更简单的语言解释，给一个直观类比。",
  example: "结合上下文，举一个具体例子。",
  why: "解释它为什么成立，说明条件与前置知识。",
  deep: "深入解释其原理、执行过程和应用边界。",
};
async function inject(tabId: number) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
  } catch {
    await chrome.scripting
      .executeScript({
        target: { tabId },
        files: ["content.js"],
      })
      .catch(() => {
        throw new Error(
          "尚无权限读取此网页。请点击工具栏中的阅读助手图标，或授予当前网站访问权限。",
        );
      });
  }
}
async function checkedTab(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  const { preferences } = await loadSettings();
  // Chrome omits URL metadata before activeTab or a host grant. That does not
  // imply the page is an internal or otherwise unsupported browser page.
  if (!tab.url) {
    try {
      // Use the same browser-enforced scripting permission as normal reading.
      // This can recover metadata after a grant without requesting global tabs.
      const [frame] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => location.href,
      });
      if (typeof frame?.result === "string") tab.url = frame.result;
    } catch (error) {
      // Restricted protocols are distinguishable even when their URL metadata
      // is redacted; ordinary missing host permissions must remain a grant error.
      if (
        /cannot access (?:a )?(?:chrome|edge|devtools|chrome-extension):\/\/|extensions gallery cannot be scripted/i.test(
          errorText(error),
        )
      ) {
        throw new Error(
          "此页面受浏览器限制，或不属于受支持的 HTTP/HTTPS 网页。",
        );
      }
    }
  }
  if (!tab.url)
    throw new Error(
      "尚未获得当前网页的读取权限。请点击工具栏中的阅读助手图标，或使用网页右键入口授权当前页。",
    );
  if (!readableUrl(tab.url))
    throw new Error("此页面受浏览器限制，或不属于受支持的 HTTP/HTTPS 网页。");
  if (isBlocked(tab.url, preferences.blockedDomains))
    throw new Error("此域名已在设置中禁用。");
  return tab;
}
async function readTab(tabId: number, force = false) {
  await checkedTab(tabId);
  await inject(tabId);
  const result = await chrome.tabs.sendMessage(tabId, {
    type: "EXTRACT",
    force,
  });
  if (!result?.ok)
    throw new Error(result?.error || "网页读取失败，请刷新后重试。");
  return result.data as DocumentContext;
}
async function registerSites() {
  const { siteOrigins } = await chrome.storage.local.get("siteOrigins");
  const existing = await chrome.scripting.getRegisteredContentScripts();
  if (existing.length)
    await chrome.scripting.unregisterContentScripts({
      ids: existing.map((x) => x.id),
    });
  const allowed: string[] = [];
  for (const origin of Array.isArray(siteOrigins) ? siteOrigins : [])
    if (
      typeof origin === "string" &&
      (await chrome.permissions.contains({ origins: [origin] }))
    )
      allowed.push(origin);
  if (allowed.length)
    await chrome.scripting.registerContentScripts([
      {
        id: "reader-authorized-sites",
        matches: allowed,
        js: ["content.js"],
        runAt: "document_idle",
        persistAcrossSessions: true,
      },
    ]);
}
chrome.runtime.onInstalled.addListener(() => {
  void ready.then(async () => {
    await chrome.contextMenus.removeAll();
    // A single normal item stays directly in the page menu; checkboxes are grouped.
    chrome.contextMenus.create({
      id: "reader-toggle",
      title: "打开阅读助手",
      contexts: ["page"],
      documentUrlPatterns: ["https://*/*", "http://*/*"],
    });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    await registerSites();
  });
});
chrome.runtime.onStartup.addListener(() => {
  void ready.then(async () => {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    await registerSites();
  });
});
chrome.permissions.onRemoved.addListener(() => {
  void registerSites();
  void notifyPublicSettings();
});
async function notifyPublicSettings() {
  const { preferences } = await loadSettings();
  for (const tab of await chrome.tabs.query({}))
    if (tab.id) {
      const active = await readingPage(tab.id);
      const allowed =
        !!active && !isBlocked(active.url, preferences.blockedDomains);
      if (!allowed || !preferences.overlay) quickRequests.get(tab.id)?.abort();
      void chrome.tabs
        .sendMessage(tab.id, {
          type: "PUBLIC_SETTINGS",
          overlay: preferences.overlay && allowed,
          pageId: active?.pageId,
          theme: preferences.theme,
        })
        .catch(() => {});
    }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.preferences) void notifyPublicSettings();
  if (area === "local" && changes.dataClearedAt) {
    for (const controller of quickRequests.values()) controller.abort();
    quickRequests.clear();
    void chrome.tabs.query({}).then((tabs) => {
      for (const tab of tabs) if (tab.id) void disableReader(tab.id);
    });
  }
});
chrome.action.onClicked.addListener(requestToggle);
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-reader" && tab?.id) {
    requestToggle(tab);
  }
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "reader-toggle" && tab?.id) requestToggle(tab);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  quickRequests.get(tabId)?.abort();
  quickRequests.delete(tabId);
  void chrome.storage.session.remove(["pending-" + tabId, "reader-" + tabId]);
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void syncMenu(tabId);
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") void disableReader(tabId);
  else if (change.url)
    void readingPage(tabId).then((state) => {
      if (state && canonicalUrl(change.url!) !== state.url)
        void disableReader(tabId);
    });
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  const isUI =
    !!sender.url &&
    ["sidepanel.html", "options.html"].some(
      (path) => sender.url === chrome.runtime.getURL(path),
    );
  const fromPage = !isUI && !!sender.tab?.id && sender.frameId === 0;
  // Preserve the click's user gesture; awaiting storage first loses it in Chrome.
  if (fromPage && message.type === "OPEN_PANEL") {
    void chrome.sidePanel.open({ tabId: sender.tab!.id! }).then(
      () => respond({ ok: true, data: true }),
      () =>
        respond({
          ok: false,
          error: "侧边栏未能打开，请重新点击“向 AI 提问”。",
        }),
    );
    return true;
  }
  const quick =
    fromPage && message.type === "QUICK_EXPLAIN"
      ? new AbortController()
      : undefined;
  if (quick) {
    quickRequests.get(sender.tab!.id!)?.abort();
    quickRequests.set(sender.tab!.id!, quick);
  }
  const run = async () => {
    await ready;
    if (fromPage) {
      const tabId = sender.tab!.id!;
      if (message.type === "CANCEL_EXPLAIN") {
        quickRequests.get(tabId)?.abort();
        quickRequests.delete(tabId);
        return true;
      }
      await checkedTab(tabId);
      if (message.type === "PAGE_CHANGED") {
        quickRequests.get(tabId)?.abort();
        const state = await readingPage(tabId);
        if (state && canonicalUrl(sender.url!) !== state.url)
          await disableReader(tabId);
        await chrome.storage.session.remove("pending-" + tabId);
        void chrome.runtime
          .sendMessage({ type: "DOCUMENT_INVALIDATED", tabId, url: sender.url })
          .catch(() => {});
        return true;
      }
      if (message.type === "GET_PUBLIC_SETTINGS") {
        const { preferences } = await loadSettings();
        const state = await readingPage(tabId);
        return {
          overlay:
            preferences.overlay &&
            state?.pageId === message.pageId &&
            state?.url === canonicalUrl(sender.url!),
          theme: preferences.theme,
        };
      }
      if (message.type === "OPEN_OPTIONS") {
        await chrome.runtime.openOptionsPage();
        return true;
      }
      if (message.type === "QUICK_STATUS") {
        const { preferences, config } = await loadSettings();
        return {
          configured: !!config.model.trim() && !!(await loadKey()),
          consent: preferences.consent,
          serviceOrigin: new URL(config.baseUrl).origin,
        };
      }
      if (
        message.type === "QUEUE_SELECTION" ||
        message.type === "QUICK_EXPLAIN"
      ) {
        const s = message.selection as SelectionContext;
        if (
          !s ||
          typeof s.text !== "string" ||
          !s.text.trim() ||
          s.text.length > 6000 ||
          s.url !== sender.url
        )
          throw new Error("选区已失效，请重新选择。");
        const selection: SelectionContext = {
          text: s.text,
          surrounding: String(s.surrounding || "").slice(0, 3500),
          url: s.url,
          title: String(s.title || "").slice(0, 300),
          kind: ["text", "code", "math"].includes(s.kind) ? s.kind : "text",
          locator: {
            textQuote: String(s.locator?.textQuote || "").slice(0, 700),
            cssSelector:
              typeof s.locator?.cssSelector === "string"
                ? s.locator.cssSelector
                : undefined,
          },
        };
        const action: ActionKind = Object.hasOwn(actionPrompt, message.action)
          ? message.action
          : "explain";
        if (message.type === "QUEUE_SELECTION") {
          await chrome.storage.session.set({
            ["pending-" + tabId]: { selection, action, createdAt: Date.now() },
          });
          void chrome.runtime
            .sendMessage({ type: "PENDING_SELECTION", tabId })
            .catch(() => {});
          return true;
        }
        const state = await readingPage(tabId);
        if (
          !state ||
          state.pageId !== message.pageId ||
          state.url !== canonicalUrl(sender.url!)
        )
          throw new Error("请先在网页空白处右键，打开阅读助手。");
        const { preferences, config } = await loadSettings();
        if (!preferences.overlay) throw new Error("划词浮层已在设置中关闭。");
        if (
          !preferences.consent &&
          message.consentOrigin === new URL(config.baseUrl).origin
        ) {
          preferences.consent = true;
          await savePreferences(preferences);
        }
        if (!preferences.consent)
          throw new Error("请先确认小浮窗中的文本发送提示。");
        const provider = createProvider(config, await loadKey());
        const doc = await readTab(tabId);
        const related = retrieve(
          doc,
          selection.text,
          Math.min(preferences.contextBudget, 6000),
          selection,
        )
          .map((s) => `章节：${s.headingPath.join(" → ")}\n${s.content}`)
          .join("\n\n");
        quick!.signal.throwIfAborted();
        const result = await provider.complete(
          [
            {
              role: "system",
              content:
                systemPrompt(preferences) +
                "\n这是小型解释卡片，控制在约200字。没有 SOURCE 引用编号时不要生成引用。",
            },
            {
              role: "user",
              content: `网页标题：${doc.title}\n读取覆盖：${doc.coverage}，仅提供相关片段。\n<UNTRUSTED_SELECTION>\n${selection.text}\n</UNTRUSTED_SELECTION>\n<UNTRUSTED_CONTEXT>\n${selection.surrounding}\n</UNTRUSTED_CONTEXT>\n<UNTRUSTED_DOCUMENT>\n${related || "未检索到相关片段。"}\n</UNTRUSTED_DOCUMENT>\n用户要求：${actionPrompt[action]}`,
            },
          ],
          {
            stream: false,
            maxTokens: Math.min(config.maxTokens, 1400),
            timeoutMs: 25000,
            signal: quick!.signal,
          },
        );
        return result.text;
      }
      throw new Error("不支持的页面请求。");
    }
    if (!isUI) throw new Error("请求来源无权限。");
    if (message.type === "READ_TAB")
      return readTab(message.tabId, !!message.force);
    if (message.type === "HIGHLIGHT") {
      await checkedTab(message.tabId);
      await inject(message.tabId);
      const result = await chrome.tabs.sendMessage(message.tabId, {
        type: "HIGHLIGHT",
        locator: message.locator,
        url: message.url,
      });
      if (!result?.ok) throw new Error(result?.error || "定位失败。");
      return true;
    }
    if (message.type === "GET_PENDING") {
      const key = "pending-" + message.tabId;
      const data = await chrome.storage.session.get(key);
      await chrome.storage.session.remove(key);
      const value = data[key] as { createdAt: number } | undefined;
      if (value && Date.now() - value.createdAt < 300000) return value;
      return null;
    }
    if (message.type === "ENABLE_SITE") {
      const tab = await checkedTab(message.tabId);
      const origin = new URL(tab.url!).origin + "/*";
      if (!(await chrome.permissions.contains({ origins: [origin] })))
        throw new Error("尚未获得网站访问权限。");
      const { siteOrigins } = await chrome.storage.local.get("siteOrigins");
      await chrome.storage.local.set({
        siteOrigins: [
          ...new Set([
            ...(Array.isArray(siteOrigins) ? siteOrigins : []),
            origin,
          ]),
        ],
      });
      await registerSites();
      await inject(message.tabId);
      return true;
    }
    throw new Error("未知扩展请求。");
  };
  void run()
    .then((data) => respond({ ok: true, data }))
    .catch((e) => respond({ ok: false, error: errorText(e) }))
    .finally(() => {
      if (quick && quickRequests.get(sender.tab!.id!) === quick)
        quickRequests.delete(sender.tab!.id!);
    });
  return true;
});
