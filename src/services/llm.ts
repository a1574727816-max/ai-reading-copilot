import type { ModelConfig } from "../types";
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface CompletionOptions {
  signal?: AbortSignal;
  stream?: boolean;
  onToken?: (token: string) => void;
  maxTokens?: number;
  timeoutMs?: number;
}
export interface Completion {
  text: string;
  usage?: { input?: number; output?: number };
}
export class ProviderError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
export function apiUrl(
  base: string,
  resource: "models" | "chat/completions",
): string {
  const u = new URL(base.trim());
  if (u.username || u.password || u.search || u.hash)
    throw new ProviderError("config", "接口地址不能包含账号、查询参数或片段。");
  if (
    u.protocol !== "https:" &&
    !(
      u.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
    )
  )
    throw new ProviderError(
      "config",
      "接口必须使用 HTTPS；本机服务可使用 HTTP。",
    );
  u.pathname =
    u.pathname
      .replace(/\/(chat\/completions|models)\/?$/, "")
      .replace(/\/$/, "") +
    "/" +
    resource;
  return u.href;
}
function httpError(status: number): ProviderError {
  if (status === 401 || status === 403)
    return new ProviderError(
      "auth",
      "认证失败，请检查 API Key、模型权限及服务地址。",
    );
  if (status === 429)
    return new ProviderError(
      "rate",
      "服务限流或额度不足，请稍后重试并检查账户额度。",
    );
  if (status === 404)
    return new ProviderError(
      "not-found",
      "接口或模型不存在，请检查 Base URL 和模型 ID。",
    );
  if (status === 400 || status === 422)
    return new ProviderError(
      "parameters",
      "服务不接受当前参数，请检查模型 ID、温度及最大输出长度。",
    );
  return new ProviderError(
    "http",
    `模型服务返回错误（HTTP ${status}），请稍后重试。`,
  );
}
function translateError(error: unknown, signal?: AbortSignal): never {
  if (error instanceof ProviderError) throw error;
  if (error instanceof SyntaxError)
    throw new ProviderError(
      "format",
      "模型服务返回了无法解析的数据，请检查接口是否兼容。",
    );
  if (signal?.aborted) throw new ProviderError("cancelled", "已停止生成。");
  if (error instanceof DOMException && error.name === "TimeoutError")
    throw new ProviderError("timeout", "模型请求超时，请重试或减少上下文。");
  if (error instanceof Error && error.name === "AbortError")
    throw new ProviderError("timeout", "模型请求超时，请重试。");
  throw new ProviderError(
    "network",
    "无法连接模型服务，请检查网络、接口地址及网站访问权限。",
  );
}
export interface LLMProvider {
  models(signal?: AbortSignal): Promise<string[]>;
  complete(
    messages: LLMMessage[],
    options?: CompletionOptions,
  ): Promise<Completion>;
}
export class CompatibleProvider implements LLMProvider {
  constructor(
    private config: ModelConfig,
    private key: string,
    private request: typeof fetch = fetch.bind(globalThis),
  ) {}
  private headers() {
    if (!this.key)
      throw new ProviderError("config", "请先在设置中填写 API Key。");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.key}`,
    };
  }
  async models(signal?: AbortSignal): Promise<string[]> {
    try {
      const response = await this.request(
        apiUrl(this.config.baseUrl, "models"),
        {
          headers: this.headers(),
          signal: AbortSignal.any([
            AbortSignal.timeout(20000),
            ...(signal ? [signal] : []),
          ]),
        },
      );
      if (!response.ok) throw httpError(response.status);
      const body = await response.json();
      if (!Array.isArray(body.data))
        throw new ProviderError(
          "format",
          "服务未返回标准模型列表，可手动填写模型 ID。",
        );
      return body.data
        .filter(
          (m: unknown): m is { id: string } =>
            !!m &&
            typeof m === "object" &&
            typeof (m as { id?: unknown }).id === "string",
        )
        .map((m: { id: string }) => m.id);
    } catch (e) {
      translateError(e, signal);
    }
  }
  async complete(
    messages: LLMMessage[],
    options: CompletionOptions = {},
  ): Promise<Completion> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs ?? 90000),
      ...(options.signal ? [options.signal] : []),
    ]);
    try {
      if (!this.config.model.trim())
        throw new ProviderError("config", "请先选择模型或填写模型 ID。");
      const payload: Record<string, unknown> = {
        model: this.config.model,
        messages,
        stream: !!options.stream,
        max_tokens: options.maxTokens ?? this.config.maxTokens,
      };
      if (this.config.temperature !== undefined)
        payload.temperature = this.config.temperature;
      const response = await this.request(
        apiUrl(this.config.baseUrl, "chat/completions"),
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(payload),
          signal,
        },
      );
      if (!response.ok) throw httpError(response.status);
      if (!options.stream) {
        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content;
        if (typeof text !== "string" || !text.trim())
          throw new ProviderError(
            "format",
            "模型未返回可显示的回答，请重试或增加最大输出长度。",
          );
        options.onToken?.(text);
        return { text, usage: parseUsage(data.usage) };
      }
      if (!response.body)
        throw new ProviderError("format", "服务未返回可读取的响应流。");
      if (response.headers.get("content-type")?.includes("application/json")) {
        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content;
        if (typeof text !== "string")
          throw new ProviderError("format", "服务返回格式不正确。");
        options.onToken?.(text);
        return { text, usage: parseUsage(data.usage) };
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "",
        text = "",
        usage: Completion["usage"];
      const process = (line: string) => {
        if (!line.startsWith("data:")) return;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") return;
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          throw new ProviderError(
            "format",
            "模型返回了损坏的流式数据，请重试。",
          );
        }
        if (data.error)
          throw new ProviderError(
            "provider",
            "模型服务中断了生成，请重试或检查服务状态。",
          );
        const token = data?.choices?.[0]?.delta?.content;
        if (typeof token === "string") {
          text += token;
          options.onToken?.(token);
        }
        if (data.usage) usage = parseUsage(data.usage);
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          let newline;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            process(buffer.slice(0, newline).replace(/\r$/, ""));
            buffer = buffer.slice(newline + 1);
          }
          if (done) {
            if (buffer.trim()) process(buffer);
            break;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (!text.trim())
        throw new ProviderError(
          "format",
          "模型没有返回正文，可能已耗尽推理预算。请增加最大输出长度或更换模型。",
        );
      return { text, usage };
    } catch (e) {
      translateError(e, options.signal);
    }
  }
}
function parseUsage(raw: unknown): Completion["usage"] {
  if (!raw || typeof raw !== "object") return;
  const u = raw as Record<string, unknown>;
  return {
    input: typeof u.prompt_tokens === "number" ? u.prompt_tokens : undefined,
    output:
      typeof u.completion_tokens === "number" ? u.completion_tokens : undefined,
  };
}
export const createProvider = (config: ModelConfig, key: string): LLMProvider =>
  new CompatibleProvider(config, key);
