// Opt-in integration test: one real document question, using only session credentials.
import { chromium } from "@playwright/test";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const raw = await readFile(
  process.env.READER_CREDENTIALS_FILE || "大模型地址和apikey.txt",
  "utf8",
);
const baseUrl = raw.match(/https?:\/\/[^\s"'<>]+/)?.[0],
  key = raw.match(/\bsk-[A-Za-z0-9_-]+/)?.[0];
if (!baseUrl || !key) throw new Error("请提供本地测试配置。");
const previous = JSON.parse(await readFile("docs/live-test.json", "utf8"));
const model = process.env.READER_TEST_MODEL || previous.model;
const temp = await mkdtemp(join(tmpdir(), "reader-live-browser-"));
let context;
try {
  const extension = join(temp, "extension");
  await cp(resolve("dist"), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, "manifest.json"), "utf8"),
  );
  manifest.host_permissions = [
    new URL(baseUrl).origin + "/*",
    "https://api-docs.deepseek.com/*",
  ];
  await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(join(temp, "profile"), {
    channel: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--no-sandbox",
    ],
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(
    async ({ baseUrl, key, model }) => {
      await chrome.storage.local.setAccessLevel({
        accessLevel: "TRUSTED_CONTEXTS",
      });
      await chrome.storage.local.set({
        modelConfig: {
          provider: "compatible",
          baseUrl,
          model,
          maxTokens: 600,
          keyMode: "session",
        },
        preferences: { consent: true, retainHistory: false },
      });
      await chrome.storage.session.set({ apiKey: key });
    },
    { baseUrl, key, model },
  );
  const page = await context.newPage();
  await page.goto("https://api-docs.deepseek.com/zh-cn/", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForSelector("article pre", { timeout: 20000 });
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 850 });
  await page.bringToFront();
  await panel.goto(
    `chrome-extension://${new URL(worker.url()).host}/sidepanel.html`,
  );
  await panel.waitForSelector(".status-dot.ready");
  await panel
    .getByLabel("向当前文档提问")
    .fill("根据当前文档，API Key 应怎样携带在请求里？请给出原文引用。");
  await panel.getByLabel("发送问题").click();
  await panel.waitForFunction(
    () =>
      document.querySelector(".message.assistant .message-footer") &&
      !document.querySelector('[aria-label="停止生成"]'),
    {},
    { timeout: 100000 },
  );
  const answer = await panel.locator(".message.assistant").innerText();
  const citations = await panel.locator(".sources details").count();
  if (await panel.getByRole("alert").count())
    throw new Error("extension_request_failed");
  if (!citations) throw new Error("no_verified_citation");
  await panel.locator(".inline-source").first().click();
  await page.waitForSelector("[data-reader-highlight]", { state: "attached" });
  const report = {
    testedAt: new Date().toISOString(),
    model,
    browser: context.browser()?.version(),
    document: "https://api-docs.deepseek.com/zh-cn/",
    answerCharacters: answer.length,
    verifiedCitations: citations,
    citationLocationPassed: true,
    localKeyLeakInAnswer: answer.includes(key),
    passed: !answer.includes(key),
  };
  await writeFile(
    "docs/live-browser-test.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error("浏览器真实模型联调失败：" + (e.code || e.name || "error"));
  process.exitCode = 1;
} finally {
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
