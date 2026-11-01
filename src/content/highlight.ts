import type { SourceLocator } from "../types";
import { locateSource } from "./extraction";
let cleanup: (() => void) | undefined;
export function highlightSource(locator: SourceLocator) {
  cleanup?.();
  const target = locateSource(locator);
  if (!target)
    throw new Error(
      "无法可靠定位原文。页面可能已更新，请重新读取；仍可查看引用文本。",
    );
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  const root = document.createElement("div");
  root.setAttribute("aria-hidden", "true");
  root.dataset.readerHighlight = "true";
  root.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483645";
  document.documentElement.append(root);
  const draw = () => {
    const rect = target.getBoundingClientRect();
    root.replaceChildren();
    const box = document.createElement("div");
    box.style.cssText = `position:fixed;left:${Math.max(0, rect.left - 5)}px;top:${rect.top - 4}px;width:${rect.width + 10}px;height:${rect.height + 8}px;background:rgba(217,164,65,.17);border:2px solid #cf9d3c;border-radius:6px;box-sizing:border-box;transition:opacity .2s`;
    root.append(box);
  };
  draw();
  window.addEventListener("scroll", draw, true);
  window.addEventListener("resize", draw);
  const timeout = setTimeout(() => cleanup?.(), 2600);
  cleanup = () => {
    clearTimeout(timeout);
    window.removeEventListener("scroll", draw, true);
    window.removeEventListener("resize", draw);
    root.remove();
    cleanup = undefined;
  };
}
