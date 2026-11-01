import { Readability } from "@mozilla/readability";
import type { DocumentContext, DocumentSection, SourceLocator } from "../types";
import { hash, normalize, pageIdentity } from "../utils";
export const EXCLUDE =
  'nav,header,footer,aside,button,input,textarea,select,script,style,noscript,[hidden],[aria-hidden="true"],[contenteditable="true"],[role="navigation"],[role="dialog"],[role="log"],[data-message-author-role],.sidebar,.navbar,.toc,.VPDocAside,.theme-doc-sidebar-container,.pagination-nav,.table-of-contents,#ai-reading-copilot';
const BLOCK =
  'h1,h2,h3,h4,h5,h6,p,li,pre,table,blockquote,dt,dd,math,.katex-display,[role="math"]';
export function excluded(element: Element): boolean {
  if (element.closest(EXCLUDE)) return true;
  const view = element.ownerDocument.defaultView;
  for (let e: Element | null = element; e; e = e.parentElement) {
    const s = view?.getComputedStyle(e);
    if (s?.display === "none" || s?.visibility === "hidden") return true;
  }
  return false;
}
const cssEscape = (s: string) =>
  s.replace(
    /[^a-zA-Z0-9_-]/g,
    (c) => "\\" + c.codePointAt(0)!.toString(16) + " ",
  );
export function cssPath(element: Element): string {
  const path: string[] = [];
  let current: Element | null = element;
  while (current && path.length < 9) {
    if (
      current.id &&
      current.ownerDocument.querySelectorAll("#" + cssEscape(current.id))
        .length === 1
    ) {
      path.unshift("#" + cssEscape(current.id));
      break;
    }
    const parent: Element | null = current.parentElement;
    const index = parent
      ? Array.from(parent.children)
          .filter((x) => x.tagName === current!.tagName)
          .indexOf(current) + 1
      : 1;
    path.unshift(current.tagName.toLowerCase() + `:nth-of-type(${index})`);
    current = parent;
  }
  return path.join(" > ");
}
export function locatorFor(
  element: Element,
  text = normalize(textOf(element)),
): SourceLocator {
  return {
    cssSelector: cssPath(element),
    headingId: element.closest("[id]")?.id || undefined,
    textQuote: text.slice(0, 700),
    prefix:
      element.previousElementSibling &&
      !excluded(element.previousElementSibling)
        ? normalize(textOf(element.previousElementSibling)).slice(-70)
        : "",
    suffix:
      element.nextElementSibling && !excluded(element.nextElementSibling)
        ? normalize(textOf(element.nextElementSibling)).slice(0, 70)
        : "",
  };
}
export function textOf(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  const originals = [...element.querySelectorAll("*")];
  [...clone.querySelectorAll("*")].forEach((copy, index) => {
    if (excluded(originals[index])) copy.remove();
  });
  clone.querySelectorAll(EXCLUDE).forEach((e) => e.remove());
  clone.querySelectorAll(".katex").forEach((katex) => {
    const tex = katex.querySelector(
      'annotation[encoding="application/x-tex"]',
    )?.textContent;
    if (tex)
      katex.replaceWith(element.ownerDocument.createTextNode("$" + tex + "$"));
  });
  if (element.matches("li"))
    clone.querySelectorAll("pre,table,ul,ol").forEach((e) => e.remove());
  if (element.matches("pre"))
    return (clone.textContent || "").replace(/\n{4,}/g, "\n\n\n").trim();
  if (element.matches("table"))
    return [...clone.querySelectorAll("tr")]
      .map((row) =>
        [...row.querySelectorAll("th,td")]
          .map((cell) => normalize(cell.textContent || ""))
          .join(" | "),
      )
      .join("\n");
  if (element.matches('math,.katex-display,[role="math"]'))
    return (
      element.querySelector('annotation[encoding="application/x-tex"]')
        ?.textContent || normalize(clone.textContent || "")
    );
  clone.querySelectorAll("a[href]").forEach((a) => {
    const href = (a as HTMLAnchorElement).href;
    if (/^https?:/.test(href) && a.textContent?.trim())
      a.textContent = `${a.textContent} (${href})`;
  });
  return normalize(clone.textContent || "");
}
function chooseRoot(doc: Document): Element {
  const selectors = [
    ".theme-doc-markdown",
    ".vp-doc",
    "article",
    "main",
    '[role="main"]',
    ".markdown-body",
    ".document",
    ".content",
  ];
  const candidates = [
    ...new Set(selectors.flatMap((s) => [...doc.querySelectorAll(s)])),
  ].filter((e) => !excluded(e));
  let root: Element | undefined,
    score = 0;
  for (const candidate of candidates) {
    const blocks = [...candidate.querySelectorAll("p,pre,li,table")].filter(
      (e) => !excluded(e),
    );
    const value = blocks.reduce(
      (n, e) => n + Math.min((e.textContent || "").length, 2500),
      0,
    );
    if (value > score) {
      score = value;
      root = candidate;
    }
  }
  return root || doc.body;
}
export function chunkText(text: string, size = 1800): string[] {
  const result: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = Math.max(
      rest.lastIndexOf("\n", size),
      rest.lastIndexOf("。", size) + 1,
      rest.lastIndexOf(". ", size) + 1,
    );
    if (cut < size * 0.5) cut = size;
    result.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) result.push(rest);
  return result;
}
export function extractDocument(
  doc: Document = document,
  url = doc.URL,
): DocumentContext {
  if (
    /access (restricted|denied)|just a moment|checking your browser|访问受限|安全验证|人机验证/i.test(
      doc.title,
    )
  ) {
    throw new Error(
      "网站返回了访问限制或验证页面，尚未读取目标文档。请在浏览器中完成验证后重新读取。",
    );
  }
  const root = chooseRoot(doc);
  let elements = [...root.querySelectorAll(BLOCK)].filter((e) => !excluded(e));
  elements = elements.filter((e) => {
    if (
      e.parentElement?.closest(
        'pre,table,blockquote,math,.katex-display,[role="math"]',
      )
    )
      return false;
    return (
      !e.parentElement?.closest("li") ||
      e.matches('li,pre,table,math,.katex-display,[role="math"]')
    );
  });
  const warnings: string[] = [];
  const sections: DocumentSection[] = [];
  const headingPath: string[] = [];
  let chars = 0;
  const MAX = 500000;
  for (const element of elements) {
    if (/^H[1-6]$/.test(element.tagName)) {
      const level = Number(element.tagName[1]);
      headingPath.length = level - 1;
      headingPath[level - 1] = normalize(element.textContent || "");
      continue;
    }
    let content = textOf(element);
    if (!content || content.length < 2) continue;
    const truncated = chars + content.length > MAX;
    if (truncated) {
      content = content.slice(0, MAX - chars);
      warnings.push("页面超过本地解析上限，仅提取部分内容。");
    }
    const type: DocumentSection["type"] = element.matches("pre")
      ? "code"
      : element.matches("table")
        ? "table"
        : element.matches('math,.katex-display,[role="math"]')
          ? "math"
          : "text";
    const locator = locatorFor(element);
    for (const text of chunkText(content, type === "code" ? 3200 : 1800)) {
      const order = sections.length;
      sections.push({
        id: "s" + order.toString(36) + "-" + hash(text),
        headingPath: headingPath.filter(Boolean),
        content: text,
        type,
        locator,
        order,
      });
    }
    chars += content.length;
    if (truncated) break;
  }
  if (!sections.length) {
    const clone = doc.cloneNode(true) as Document;
    const originals = [...doc.querySelectorAll("*")];
    [...clone.querySelectorAll("*")].forEach((element, index) => {
      if (excluded(originals[index])) element.remove();
    });
    const article = new Readability(clone).parse();
    if (article?.textContent) {
      const text = normalize(article.textContent);
      if (text.length > 80) {
        for (const content of chunkText(text.slice(0, MAX))) {
          sections.push({
            id: "s" + sections.length.toString(36) + "-" + hash(content),
            headingPath: [],
            content,
            type: "text",
            locator: { textQuote: content.slice(0, 700) },
            order: sections.length,
          });
        }
        chars = Math.min(text.length, MAX);
        warnings.push("已使用正文回退提取，结构与原文定位可能不完整。");
      }
    }
  }
  if (!sections.length)
    throw new Error(
      "没有找到可阅读的正文。页面可能尚未加载、需要登录，或主要内容是图片/PDF；请加载完成后重新读取。",
    );
  if (root.querySelector("iframe")) warnings.push("未读取 iframe 中的内容。");
  if ([...root.querySelectorAll("*")].some((e) => !!e.shadowRoot))
    warnings.push("未读取 Shadow DOM 中的内容。");
  if (root.querySelector("img") && !sections.some((s) => s.type === "math"))
    warnings.push("图片中的文字、图表与公式未进行视觉识别。");
  const contentHash = hash(
    sections
      .map((s) => JSON.stringify([s.headingPath, s.type, s.content]))
      .join("\n"),
  );
  return {
    id: pageIdentity(url),
    url,
    title:
      doc.title ||
      doc.querySelector("h1")?.textContent ||
      new URL(url).hostname,
    contentHash,
    extractedAt: Date.now(),
    sections,
    coverage: warnings.length ? "partial" : "complete",
    warnings,
    characterCount: chars,
  };
}
export function locateSource(
  locator: SourceLocator,
  doc: Document = document,
): Element | null {
  const quote = normalize(locator.textQuote);
  if (!quote) return null;
  if (locator.cssSelector) {
    try {
      const found = doc.querySelector(locator.cssSelector);
      if (found && !excluded(found) && normalize(textOf(found)).includes(quote))
        return found;
    } catch {
      /* Fall back to verified text. */
    }
  }
  const candidates = [
    ...doc.querySelectorAll("p,li,pre,table,blockquote,div,span,section"),
  ].filter((e) => !excluded(e) && normalize(textOf(e)).includes(quote));
  const minimal = candidates.filter(
    (e) => !candidates.some((child) => child !== e && e.contains(child)),
  );
  if (minimal.length === 1) return minimal[0];
  if (minimal.length > 1 && (locator.prefix || locator.suffix)) {
    const matches = minimal.filter((e) => {
      const text = normalize(e.parentElement ? textOf(e.parentElement) : "");
      return (
        (!locator.prefix || text.includes(locator.prefix)) &&
        (!locator.suffix || text.includes(locator.suffix))
      );
    });
    if (matches.length === 1) return matches[0];
  }
  return null;
}
