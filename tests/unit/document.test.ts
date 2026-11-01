import { beforeEach, describe, expect, it } from "vitest";
import {
  chunkText,
  extractDocument,
  locateSource,
} from "../../src/content/extraction";
import { retrieve, splitBatches } from "../../src/services/retrieval";
function fixture() {
  document.body.innerHTML = `<nav><p>不要提取的导航文本</p></nav><main><h1 id="guide">设备指南</h1><h2 id="init">初始化连接</h2><p id="connection">先创建通信接口，然后初始化设备对象。</p><pre><code>const robot = new Robot();\nrobot.init();</code></pre><table><tr><th>参数</th><th>说明</th></tr><tr><td>timeout</td><td>超时毫秒</td></tr></table><h2>里程计</h2><p>里程计根据运动信息估计位姿，测量误差会导致累计误差。</p><p hidden>隐藏的私人内容</p><textarea>私密表单</textarea><div contenteditable="true"><p>私密编辑区</p></div><div role="log"><p>私人聊天消息</p></div><p><a href="https://example.com/reference">更多参考</a></p></main><footer><p>不要提取的页脚文本</p></footer>`;
  document.title = "设备 SDK";
}
describe("结构化文档与可验证原文", () => {
  beforeEach(fixture);
  it("保留标题层级、代码、表格和链接，排除页面噪声及敏感区", () => {
    const d = extractDocument(document, "https://example.com/sdk");
    const text = d.sections.map((s) => s.content).join("\n");
    expect(text).not.toMatch(/导航|页脚|隐藏的私人|私密|私人聊天/);
    expect(d.sections.find((s) => s.type === "code")?.content).toContain("\n");
    expect(d.sections.find((s) => s.type === "table")?.content).toContain(
      "timeout | 超时毫秒",
    );
    expect(text).toContain("https://example.com/reference");
    expect(d.sections[0].headingPath).toEqual(["设备指南", "初始化连接"]);
    expect(new Set(d.sections.map((s) => s.id)).size).toBe(d.sections.length);
  });
  it("定位时校验文本，DOM 变化后回退，不定位到错误或歧义段落", () => {
    const d = extractDocument(document, "https://example.com/sdk");
    const source = d.sections[0];
    expect(locateSource(source.locator)?.id).toBe("connection");
    document.querySelector("#connection")!.removeAttribute("id");
    expect(locateSource(source.locator)?.textContent).toContain("通信接口");
    document.querySelector("main")!.innerHTML = "<p>完全不同的新页面内容。</p>";
    expect(locateSource(source.locator)).toBeNull();
    document.querySelector("main")!.innerHTML =
      `<div><p>${source.locator.textQuote}</p><p>${source.locator.textQuote}</p></div>`;
    expect(
      locateSource({
        ...source.locator,
        cssSelector: undefined,
        prefix: "",
        suffix: "",
      }),
    ).toBeNull();
  });
  it("中文与英文检索相关片段，并遵守上下文预算", () => {
    const d = extractDocument(document, "https://example.com/sdk");
    const found = retrieve(d, "里程计为什么会累计误差", 2000);
    expect(found.some((s) => s.content.includes("累计误差"))).toBe(true);
    expect(found.reduce((n, s) => n + s.content.length, 0)).toBeLessThanOrEqual(
      2000,
    );
    expect(retrieve(d, "unfindablewordzz", 1000)).toEqual([]);
    expect(retrieve(d, "timeout", 1000).some((s) => s.type === "table")).toBe(
      true,
    );
  });
  it("长文本分块与摘要分批不遗漏末尾", () => {
    const text = "第一章文字。".repeat(800) + "结尾很重要";
    const chunks = chunkText(text);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((s) => s.length <= 1800)).toBe(true);
    const d = extractDocument(document, "https://example.com/sdk");
    expect(splitBatches(d.sections, 100).flat()).toEqual(d.sections);
  });
  it("没有正文时明确失败", () => {
    document.body.innerHTML = '<main><img src="figure.png" /></main>';
    expect(() =>
      extractDocument(document, "https://example.com/image"),
    ).toThrow(/没有找到/);
  });
  it("访问拦截页不冒充目标文档", () => {
    document.title = "Access Restricted";
    expect(() => extractDocument(document, "https://example.com")).toThrow(
      /访问限制/,
    );
  });
  it("段落中的隐藏节点、输入框和定位元数据不会泄露私密文本", () => {
    document.body.innerHTML =
      '<main><p>公开正文。<span style="display:none">不应读取的隐藏内容</span><textarea>不应读取的输入</textarea></p></main>';
    const d = extractDocument(document, "https://example.com");
    expect(d.sections[0].content).toBe("公开正文。");
    expect(JSON.stringify(d)).not.toContain("不应读取");
  });
  it("列表中的多行代码保留为独立代码片段", () => {
    document.body.innerHTML =
      "<main><h1>教程</h1><ol><li><p>第一步创建对象。</p><pre>const robot = new Robot();\nrobot.init();</pre><ul><li>子步骤说明。</li></ul></li></ol></main>";
    const d = extractDocument(document, "https://example.com");
    expect(d.sections.filter((s) => s.type === "code")).toHaveLength(1);
    expect(d.sections.find((s) => s.type === "code")?.content).toContain("\n");
    expect(d.sections.filter((s) => s.content === "子步骤说明。")).toHaveLength(
      1,
    );
  });
});
