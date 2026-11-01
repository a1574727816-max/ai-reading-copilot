import type { ActionKind, DocumentContext, SelectionContext } from "../types";
import { errorText, hash, normalize, send } from "../utils";
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
  let enabled = false,
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
  const note = document.createElement("div");
  note.className = "note";
  note.textContent = "AI 解释可能有误，请结合原文判断";
  const footer = document.createElement("div");
  footer.className = "foot";
  const button = (label: string, handler: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    b.addEventListener("click", handler);
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
  };
  const open = async () => {
    if (!selection) return;
    try {
      await send({ type: "OPEN_PANEL" });
      await send({ type: "QUEUE_SELECTION", selection, action: "deep" });
    } catch (e) {
      answer.textContent = errorText(e);
      answer.style.display = "block";
    }
  };
  const explain = async (action: ActionKind) => {
    if (!selection || busy) return;
    const request = ++requestId;
    busy = true;
    answer.style.display = "block";
    answer.textContent = "正在结合上下文解释…";
    actions.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const text = await send<string>({
        type: "QUICK_EXPLAIN",
        selection,
        action,
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
  tool.append(actions, answer, note, footer);
  shadow.append(tool);
  const mount = () => {
    if (!host.isConnected) document.documentElement.append(host);
  };
  mount();
  void send<{ overlay: boolean; theme: string }>({
    type: "GET_PUBLIC_SETTINGS",
  })
    .then((p) => {
      enabled = p.overlay;
      theme = p.theme;
    })
    .catch(() => {
      enabled = false;
    });
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
    cachedDoc = undefined;
    hide();
    selection = null;
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
    observer.disconnect();
    if (timer) clearTimeout(timer);
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    try {
      if (message.type === "PING") {
        respond({ ok: true, data: true });
        return false;
      }
      if (message.type === "PUBLIC_SETTINGS") {
        enabled = !!message.overlay;
        theme = message.theme;
        if (!enabled) {
          requestId++;
          busy = false;
          hide();
        }
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
