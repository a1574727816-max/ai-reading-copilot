import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { safeLink } from "../utils";
export function Markdown({
  text,
  onCitation,
  allowedIds = [],
}: {
  text: string;
  onCitation?: (id: string) => void;
  allowedIds?: string[];
}) {
  const transformed = text.replace(/\[\[([^\]\n]+)\]\]/g, (_, id: string) =>
    allowedIds.includes(id)
      ? `[原文 ${allowedIds.indexOf(id) + 1}](https://reading-copilot.invalid/source/${encodeURIComponent(id)})`
      : "（无效引用）",
  );
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeSanitize,
          [
            rehypeKatex,
            { trust: false, strict: "ignore", throwOnError: false },
          ],
          [rehypeHighlight, { detect: false }],
        ]}
        urlTransform={(url) => safeLink(url) || ""}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("https://reading-copilot.invalid/source/"))
              return (
                <button
                  className="inline-source"
                  onClick={() =>
                    onCitation?.(decodeURIComponent(href.split("/").at(-1)!))
                  }
                >
                  {children}
                </button>
              );
            return href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
          img: ({ alt }) => (
            <span className="image-placeholder">
              [图片：{alt || "模型输出图片已禁用"}]
            </span>
          ),
          pre: ({ children }) => (
            <div className="code-wrap">
              <button
                className="code-copy"
                onClick={async (e) => {
                  const button = e.currentTarget;
                  const el = button.parentElement?.querySelector("pre");
                  if (el) {
                    await navigator.clipboard.writeText(el.textContent || "");
                    button.textContent = "已复制";
                  }
                }}
              >
                复制
              </button>
              <pre>{children}</pre>
            </div>
          ),
        }}
      >
        {transformed}
      </ReactMarkdown>
    </div>
  );
}
