import { describe, expect, it, vi } from "vitest";
import { CompatibleProvider, apiUrl } from "../../src/services/llm";
import { DEFAULT_MODEL } from "../../src/types";
const config = { ...DEFAULT_MODEL, model: "test-model" };
describe("模型适配与流式协议", () => {
  it("拼接官方与兼容服务地址，不接受含认证信息的地址", () => {
    expect(apiUrl("https://example.com/v1/", "models")).toBe(
      "https://example.com/v1/models",
    );
    expect(apiUrl("https://example.com/v1/chat/completions", "models")).toBe(
      "https://example.com/v1/models",
    );
    expect(() => apiUrl("https://user:secret@example.com", "models")).toThrow();
    expect(() => apiUrl("http://example.com", "models")).toThrow();
    expect(apiUrl("http://127.0.0.1:3030", "models")).toContain("3030/models");
  });
  it("处理跨字节、跨事件边界、CRLF与无末尾换行的 SSE", async () => {
    const raw =
      'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"，世界"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\ndata: [DONE]';
    const bytes = new TextEncoder().encode(raw);
    const response = new Response(
      new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes.length; i += 3)
            c.enqueue(bytes.slice(i, i + 3));
          c.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
    const fetcher = vi.fn().mockResolvedValue(response);
    const onToken = vi.fn();
    const result = await new CompatibleProvider(
      config,
      "test-only-key",
      fetcher,
    ).complete([{ role: "user", content: "test" }], { stream: true, onToken });
    expect(result).toEqual({
      text: "你好，世界",
      usage: { input: 10, output: 4 },
    });
    expect(onToken).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).stream).toBe(true);
  });
  it.each([
    [401, "认证失败"],
    [429, "限流"],
    [404, "不存在"],
    [500, "HTTP 500"],
  ])("HTTP %s 提供明确错误而不泄露服务返回内容", async (status, text) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("secret-backend-diagnostic", { status }));
    await expect(
      new CompatibleProvider(config, "secret-key", fetcher).complete([]),
    ).rejects.toThrow(text);
  });
  it("损坏格式、空回答和网络中断不会被当作成功", async () => {
    const bad = vi.fn().mockResolvedValue(
      new Response("data: {oops}\n", {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    await expect(
      new CompatibleProvider(config, "key", bad).complete([], { stream: true }),
    ).rejects.toThrow(/损坏/);
    const empty = vi
      .fn()
      .mockResolvedValue(
        Response.json({ choices: [{ message: { content: "" } }] }),
      );
    await expect(
      new CompatibleProvider(config, "key", empty).complete([]),
    ).rejects.toThrow(/未返回/);
    const network = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      new CompatibleProvider(config, "key", network).complete([]),
    ).rejects.toThrow(/无法连接/);
  });
  it("传递取消信号并区分用户取消", async () => {
    const c = new AbortController();
    const fetcher = vi
      .fn()
      .mockImplementation(
        (_url, options) =>
          new Promise((_resolve, reject) =>
            options.signal.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            ),
          ),
      );
    const pending = new CompatibleProvider(config, "key", fetcher).complete(
      [],
      { signal: c.signal },
    );
    c.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });
  it("可省略厂商不支持的温度参数", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ choices: [{ message: { content: "OK" } }] }),
      );
    await new CompatibleProvider(
      { ...config, temperature: undefined },
      "key",
      fetcher,
    ).complete([]);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty(
      "temperature",
    );
  });
});
