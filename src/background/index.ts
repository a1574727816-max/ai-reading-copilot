import type { ActionKind, SelectionContext } from "../types";
import { errorText, isBlocked, readableUrl } from "../utils";
import { loadKey, loadSettings, secureStorage } from "../services/storage";
import { createProvider } from "../services/llm";
import { systemPrompt } from "../services/context";
const ready = secureStorage();
const quickRequests = new Map<number, AbortController>();
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
  return result.data;
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
    chrome.contextMenus.create({
      id: "reader-explain",
      title: "用阅读助手解释选中内容",
      contexts: ["selection"],
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
      const origin =
        tab.url && readableUrl(tab.url) ? new URL(tab.url).origin + "/*" : "";
      const allowed =
        !!origin &&
        !isBlocked(tab.url!, preferences.blockedDomains) &&
        (await chrome.permissions.contains({ origins: [origin] }));
      void chrome.tabs
        .sendMessage(tab.id, {
          type: "PUBLIC_SETTINGS",
          overlay: preferences.overlay && allowed,
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
      for (const tab of tabs)
        if (tab.id)
          void chrome.tabs
            .sendMessage(tab.id, { type: "CLEAR_CONTEXT" })
            .catch(() => {});
    });
  }
});
function openReaderForTab(tab: chrome.tabs.Tab) {
  if (tab.id === undefined) return;
  const tabId = tab.id;
  // Native auto-toggle bypasses action.onClicked and activeTab granting.
  // Open explicitly in this click/command's user gesture, before any await.
  void chrome.sidePanel
    .open({ tabId })
    .then(() => {
      // A panel may already be open with a permission error. Opening it again
      // does not remount React or activate a new tab, so request a fresh read.
      void chrome.runtime
        .sendMessage({ type: "READ_REQUESTED", tabId, windowId: tab.windowId })
        .catch(() => {});
    })
    .catch(() => {});
}
chrome.action.onClicked.addListener(openReaderForTab);
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-reader" && tab?.id) {
    openReaderForTab(tab);
  }
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "reader-explain" || !tab?.id) return;
  const tabId = tab.id;
  void chrome.sidePanel.open({ tabId });
  void (async () => {
    await checkedTab(tabId);
    await inject(tabId);
    const result = await chrome.tabs.sendMessage(tabId, {
      type: "GET_SELECTION",
    });
    if (result?.ok && result.data) {
      await chrome.storage.session.set({
        ["pending-" + tabId]: {
          selection: result.data,
          action: "explain",
          createdAt: Date.now(),
        },
      });
      void chrome.runtime
        .sendMessage({ type: "PENDING_SELECTION", tabId })
        .catch(() => {});
    }
  })().catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  quickRequests.get(tabId)?.abort();
  quickRequests.delete(tabId);
  void chrome.storage.session.remove(["pending-" + tabId]);
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
      () => respond({ ok: false, error: "请点击浏览器工具栏图标打开侧边栏。" }),
    );
    return true;
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
        await chrome.storage.session.remove("pending-" + tabId);
        void chrome.runtime
          .sendMessage({ type: "DOCUMENT_INVALIDATED", tabId, url: sender.url })
          .catch(() => {});
        return true;
      }
      if (message.type === "GET_PUBLIC_SETTINGS") {
        const { preferences } = await loadSettings();
        return { overlay: preferences.overlay, theme: preferences.theme };
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
        const { preferences, config } = await loadSettings();
        if (!preferences.consent)
          throw new Error(
            "首次调用前，请打开侧边栏确认文本发送提示并配置模型。",
          );
        const provider = createProvider(config, await loadKey());
        quickRequests.get(tabId)?.abort();
        const controller = new AbortController();
        quickRequests.set(tabId, controller);
        try {
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
                content: `网页标题：${selection.title}\n<UNTRUSTED_SELECTION>\n${selection.text}\n</UNTRUSTED_SELECTION>\n<UNTRUSTED_CONTEXT>\n${selection.surrounding}\n</UNTRUSTED_CONTEXT>\n用户要求：${actionPrompt[action]}`,
              },
            ],
            {
              stream: false,
              maxTokens: Math.min(config.maxTokens, 1400),
              timeoutMs: 25000,
              signal: controller.signal,
            },
          );
          return result.text;
        } finally {
          if (quickRequests.get(tabId) === controller)
            quickRequests.delete(tabId);
        }
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
    .catch((e) => respond({ ok: false, error: errorText(e) }));
  return true;
});
