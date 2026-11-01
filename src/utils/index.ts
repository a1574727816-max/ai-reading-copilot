export const uid = () => crypto.randomUUID();
export function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
export const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
export function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  // Hash-based SPA routes identify different documents; ordinary heading anchors do not.
  if (!/^#(?:\/|!\/)/.test(u.hash)) u.hash = "";
  return u.href;
}
export function pageIdentity(raw: string): string {
  return hash(canonicalUrl(raw));
}
export function isBlocked(url: string, domains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some(
      (d) => host === d.toLowerCase() || host.endsWith("." + d.toLowerCase()),
    );
  } catch {
    return true;
  }
}
export function readableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      ["http:", "https:"].includes(u.protocol) &&
      ![
        "chromewebstore.google.com",
        "chrome.google.com",
        "microsoftedge.microsoft.com",
      ].includes(u.hostname)
    );
  } catch {
    return false;
  }
}
export function safeLink(url: string): string | undefined {
  try {
    const u = new URL(url);
    return ["http:", "https:", "mailto:"].includes(u.protocol)
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}
export async function send<T>(message: unknown): Promise<T> {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok)
    throw new Error(result?.error || "扩展通信失败，请刷新网页后重试。");
  return result.data as T;
}
