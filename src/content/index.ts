import type {
  ActionKind,
  DocumentContext,
  PublicReaderSettings,
  QuickExplainStatus,
  SelectionContext,
} from "../types";
import { canonicalUrl, errorText, hash, normalize, send } from "../utils";
import {
  EXCLUDE,
  excluded,
  extractDocument,
  locatorFor,
  textOf,
} from "./extraction";
import { highlightSource } from "./highlight";
declare global {
  interface Window {
    __readingCopilot?: boolean;
  }
}
if (!window.__readingCopilot) {
  window.__readingCopilot = true;
  init();
}
function init() {
  const pageId = Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
    n.toString(16),
  ).join("-");
  let enabled = false,
    stateVersion = 0,
    theme = "system",
    selection: SelectionContext | null = null,
    busy = false,
    requestId = 0,
    cachedDoc: DocumentContext | undefined,
    lastUrl = location.href,
    lastSignature = "",
    timer: ReturnType<typeof setTimeout> | undefined;
  const host = document.createElement("div");
  host.id = "ai-reading-copilot";
  host.style.cssText =
    "all:initial!important;position:fixed!important;z-index:2147483646!important;left:0!important;top:0!important;pointer-events:none!important";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `:host{color-scheme:light dark}*{box-sizing:border-box}.tool{display:none;position:fixed;pointer-events:auto;background:#f8f9f5;color:#263b33;border:1px solid #d2dbd3;border-radius:9px;box-shadow:0 5px 25px #152a2829;font:13px/1.55 system-ui,sans-serif;padding:5px;max-width:calc(100vw - 16px)}.actions{display:flex;gap:2px;flex-wrap:wrap}button{font:inherit;background:transparent;color:inherit;border:0;padding:6px 9px;border-radius:5px;cursor:pointer}button:hover,button:focus-visible{background:#dfe9df;outline:2px solid transparent}button:disabled{opacity:.5;cursor:wait}.answer{display:none;white-space:pre-wrap;overflow-wrap:anywhere;max-height:270px;overflow:auto;width:330px;padding:9px;user-select:text}.foot{display:flex;justify-content:space-between;border-top:1px solid #ccd6cc;padding-top:4px}.note{font-size:11px;opacity:.65;margin:3px 9px}.dark{background:#192722;color:#e3ebe4;border-color:#46564c}.dark button:hover{background:#30453a}.dark .foot{border-color:#46564c}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}`;
  style.textContent += `.consent{display:none;width:330px;max-width:100%;padding:9px;overflow-wrap:anywhere}.consent p{margin:0 0 8px}.notice{display:none;position:fixed;right:20px;bottom:24px;max-width:calc(100vw - 40px);background:#235f4b;color:#fff;padding:10px 16px;border-radius:9px;box-shadow:0 5px 25px #152a2829;font:13px/1.6 system-ui,sans-serif}`;
  shadow.append(style);
  const tool = document.createElement("div");
  tool.className = "tool";
  tool.setAttribute("role", "dialog");
  tool.setAttribute("aria-label", "阅读助手划词工具");
  const actions = document.createElement("div");
  actions.className = "actions";
  const answer = document.createElement("div");
  answer.className = "answer";
  answer.setAttribute("aria-live", "polite");
  const consent = document.createElement("div");
  consent.className = "consent";
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.setAttribute("role", "status");
  let noticeTimer: ReturnType<typeof setTimeout>;
  const notify = (text: string) => {
    clearTimeout(noticeTimer);
    notice.textContent = text;
    notice.style.display = text ? "block" : "none";
    noticeTimer = setTimeout(() => {
      notice.style.display = "none";
    }, 4000);
  };
  const note = document.createElement("div");
  note.className = "note";
  note.textContent = "AI 解释可能有误，请结合原文判断";
  const footer = document.createElement("div");
  footer.className = "foot";
  const button = (label: string, handler: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => {
      if (e.isTrusted) handler();
    });
    return b;
  };
  const hide = () => {
    if (busy) {
      requestId++;
      busy = false;
      actions.querySelectorAll("button").forEach((b) => (b.disabled = false));
      void send({ type: "CANCEL_EXPLAIN" }).catch(() => {});
    }
    tool.style.display = "none";
    consent.style.display = "none";
  };
  const open = async () => {
    if (!selection || !enabled) return;
    try {
      await send({ type: "OPEN_PANEL" });
      await send({ type: "QUEUE_SELECTION", selection, action: "deep" });
    } catch (e) {
      answer.textContent = errorText(e);
      answer.style.display = "block";
    }
  };
  const explain = async (action: ActionKind, consentOrigin?: string) => {
    if (!selection || busy || !enabled) return;
    const request = ++requestId;
    busy = true;
    consent.style.display = "none";
    answer.style.display = "block";
    answer.textContent = "正在结合上下文解释…";
    actions.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const status = await send<QuickExplainStatus>({ type: "QUICK_STATUS" });
      if (request !== requestId) return;
      if (!status.configured || (!status.consent && !consentOrigin)) {
        answer.style.display = "none";
        const text = document.createElement("p");
        text.textContent = status.configured
          ? `点击发送后，所选文字和相关文档片段将发送到 ${status.serviceOrigin}。仅打开助手或选中文字不会调用模型。`
          : "请先在模型设置中填写 API Key 并选择模型，再回来使用划词解释。";
        consent.replaceChildren(text);
        if (status.configured)
          consent.append(
            button(
              "了解并发送",
              () => void explain(action, status.serviceOrigin),
            ),
            button("暂不发送", () => {
              consent.style.display = "none";
              position();
            }),
          );
        else
          consent.append(
            button("模型设置", () => {
              void send({ type: "OPEN_OPTIONS" }).catch(() => {});
            }),
          );
        consent.style.display = "block";
        return;
      }
      const text = await send<string>({
        type: "QUICK_EXPLAIN",
        selection,
        action,
        pageId,
        consentOrigin,
      });
      if (request === requestId) answer.textContent = text;
    } catch (e) {
      if (request === requestId) answer.textContent = errorText(e);
    } finally {
      if (request === requestId) {
        busy = false;
        actions.querySelectorAll("button").forEach((b) => (b.disabled = false));
        position();
      }
    }
  };
  actions.append(
    button("解释概念", () => void explain("explain")),
    button("结合上下文", () => void explain("simple")),
    button("举例说明", () => void explain("example")),
    button("向 AI 提问", () => void open()),
  );
  footer.append(
    button("详细解释 / 继续提问", () => void open()),
    button("关闭", () => {
      hide();
    }),
  );
  tool.append(actions, answer, consent, note, footer);
  shadow.append(tool, notice);
  const mount = () => {
    if (!host.isConnected) document.documentElement.append(host);
  };
  mount();
  const refreshSettings = () => {
    const version = stateVersion;
    void send<PublicReaderSettings>({
      type: "GET_PUBLIC_SETTINGS",
      pageId,
    })
      .then((p) => {
        if (version !== stateVersion) return;
        enabled = p.overlay;
        theme = p.theme;
        if (!enabled) hide();
      })
      .catch(() => {
        if (version === stateVersion) {
          enabled = false;
          hide();
        }
      });
  };
  refreshSettings();
  function getSelectionContext(): SelectionContext | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const fragment = sel.getRangeAt(0).cloneContents();
    if (fragment.querySelector("input,textarea,[contenteditable]")) return null;
    fragment.querySelectorAll(EXCLUDE).forEach((e) => e.remove());
    const text = (fragment.textContent || "").trim();
    if (!text || text.length > 6000) return null;
    const node =
      sel.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? (sel.anchorNode as Element)
        : sel.anchorNode?.parentElement;
    if (
      !node ||
      excluded(node) ||
      node.closest("input,textarea,[contenteditable]") ||
      host.contains(node)
    )
      return null;
    const element = node.closest("pre,p,li,td,blockquote,math") || node;
    return {
      text,
      surrounding: [
        element.previousElementSibling,
        element,
        element.nextElementSibling,
      ]
        .filter((e): e is Element => !!e && !excluded(e))
        .map(textOf)
        .join("\n")
        .slice(0, 3500),
      url: location.href,
      title: document.title,
      kind: node.closest("pre,code")
        ? "code"
        : node.closest("math,.katex")
          ? "math"
          : "text",
      locator: locatorFor(element),
    };
  }
  function position() {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const width = Math.min(tool.offsetWidth || 360, innerWidth - 16);
    const height = tool.offsetHeight || 45;
    tool.style.left =
      Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + "px";
    tool.style.top =
      (rect.bottom + height + 12 < innerHeight
        ? rect.bottom + 8
        : Math.max(8, rect.top - height - 8)) + "px";
  }
  const show = () => {
    if (!enabled || busy) return;
    selection = getSelectionContext();
    if (!selection) {
      hide();
      return;
    }
    tool.classList.toggle(
      "dark",
      theme === "dark" ||
        (theme === "system" &&
          matchMedia("(prefers-color-scheme:dark)").matches),
    );
    answer.style.display = "none";
    consent.style.display = "none";
    answer.textContent = "";
    tool.style.display = "block";
    position();
  };
  document.addEventListener("pointerup", (e) => {
    if (e.composedPath().includes(host)) return;
    setTimeout(show, 20);
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === "Escape") {
      hide();
    } else if (e.shiftKey) setTimeout(show, 10);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!e.composedPath().includes(host)) hide();
  });
  window.addEventListener("scroll", hide, { passive: true });
  document.addEventListener("selectionchange", () => {
    if (window.getSelection()?.isCollapsed) hide();
  });
  function invalidate() {
    stateVersion++;
    cachedDoc = undefined;
    hide();
    selection = null;
    if (canonicalUrl(lastUrl) !== canonicalUrl(location.href)) enabled = false;
    lastUrl = location.href;
    lastSignature = "";
    void send({ type: "PAGE_CHANGED" }).catch(() => {});
  }
  // MutationObserver catches pushState navigation without injecting code into the page world.
  const observer = new MutationObserver((records) => {
    if (
      records.every(
        (r) =>
          host.contains(r.target) ||
          (r.target as Element).closest?.("[data-reader-highlight]"),
      )
    )
      return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (location.href !== lastUrl) {
        invalidate();
        return;
      }
      if (!lastSignature) return; // Do not scan page text before the user has read it.
      const main =
        document.querySelector('article,main,[role="main"],.vp-doc') ||
        document.body;
      const signature = hash(normalize(main?.textContent || ""));
      if (lastSignature && signature !== lastSignature) invalidate();
      lastSignature = signature;
    }, 850);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  window.addEventListener("popstate", invalidate);
  window.addEventListener("hashchange", invalidate);
  window.addEventListener("pagehide", () => {
    hide();
    observer.disconnect();
    if (timer) clearTimeout(timer);
  });
  window.addEventListener("pageshow", () => {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    refreshSettings();
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    try {
      if (message.type === "PING") {
        respond({ ok: true, data: { pageId } });
        return false;
      }
      if (message.type === "PUBLIC_SETTINGS") {
        stateVersion++;
        enabled = !!message.overlay && message.pageId === pageId;
        theme = message.theme;
        if (!enabled) {
          hide();
        }
        respond({ ok: true, data: true });
      } else if (message.type === "READER_STATE") {
        if (
          message.enabled &&
          (message.pageId !== pageId ||
            message.url !== canonicalUrl(location.href))
        )
          throw new Error("网页已变化，请重新打开阅读助手。");
        stateVersion++;
        enabled = !!message.enabled;
        theme = message.theme || theme;
        if (!enabled) {
          hide();
          cachedDoc = undefined;
          selection = null;
          lastSignature = "";
        }
        notify(message.notice || "");
        respond({ ok: true, data: true });
      } else if (message.type === "READER_NOTICE") {
        notify(String(message.text || ""));
        respond({ ok: true, data: true });
      } else if (message.type === "EXTRACT") {
        const doc =
          !message.force && cachedDoc && cachedDoc.url === location.href
            ? cachedDoc
            : extractDocument();
        cachedDoc = doc;
        lastUrl = location.href;
        lastSignature = hash(
          normalize(
            (
              document.querySelector('article,main,[role="main"],.vp-doc') ||
              document.body
            ).textContent || "",
          ),
        );
        respond({ ok: true, data: doc });
      } else if (message.type === "CLEAR_CONTEXT") {
        hide();
        cachedDoc = undefined;
        selection = null;
        answer.textContent = "";
        respond({ ok: true, data: true });
      } else if (message.type === "GET_SELECTION")
        respond({ ok: true, data: getSelectionContext() });
      else if (message.type === "HIGHLIGHT") {
        if (message.url !== location.href)
          throw new Error("网页地址已改变，请重新读取文档。");
        highlightSource(message.locator);
        respond({ ok: true, data: true });
      }
    } catch (e) {
      respond({ ok: false, error: errorText(e) });
    }
    return false;
  });
}
