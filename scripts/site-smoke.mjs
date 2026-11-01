import { chromium } from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const urls = [
  "https://support.unitree.com/home/zh/developer/about_Go2",
  "https://wiki.lckfb.com/zh-hans/lushan-pi-k230/",
  "https://api-docs.deepseek.com/zh-cn/",
  "https://lucky666.cn/docs/intro",
];
const temp = await mkdtemp(join(tmpdir(), "reader-sites-"));
let context;
const results = [];
try {
  const extension = join(temp, "extension");
  await cp(resolve("dist"), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, "manifest.json"), "utf8"),
  );
  manifest.host_permissions = urls.map((u) => new URL(u).origin + "/*");
  await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(join(temp, "profile"), {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--no-sandbox",
    ],
    ignoreHTTPSErrors: true,
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  for (const url of urls) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page
        .waitForFunction(
          () =>
            document.querySelectorAll("main p,article p,pre,.vp-doc p").length >
            0,
          {},
          { timeout: 18000 },
        )
        .catch(() => {});
      const result = await worker.evaluate(async (url) => {
        const tab = (await chrome.tabs.query({})).find((t) =>
          t.url?.startsWith(url),
        );
        if (!tab?.id) throw new Error("test tab not found");
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
        const result = await chrome.tabs.sendMessage(tab.id, {
          type: "EXTRACT",
        });
        if (!result?.ok) return { ok: false, error: result?.error };
        const d = result.data;
        const sample =
          d.sections.find((s) => s.content.length > 30) || d.sections[0];
        let located = false;
        if (sample) {
          const highlight = await chrome.tabs.sendMessage(tab.id, {
            type: "HIGHLIGHT",
            url: d.url,
            locator: sample.locator,
          });
          located = !!highlight.ok;
        }
        return {
          ok: true,
          title: d.title,
          sections: d.sections.length,
          characters: d.characterCount,
          coverage: d.coverage,
          types: [...new Set(d.sections.map((s) => s.type))],
          sampleCitationLocated: located,
          warnings: d.warnings,
        };
      }, url);
      results.push({ url, ...result });
      console.log(JSON.stringify(results.at(-1)));
    } catch (e) {
      results.push({ url, ok: false, error: e.name });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      await page.close();
    }
  }
  await mkdir("docs", { recursive: true });
  await writeFile(
    "docs/site-smoke.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        browser: context.browser()?.version(),
        results,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
if (results.some((r) => !r.ok)) process.exitCode = 1;
