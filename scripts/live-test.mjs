// Explicit opt-in command. Reads the user's untracked file and never prints credentials.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { build } from "vite";
const raw = await readFile(
  process.env.READER_CREDENTIALS_FILE || "大模型地址和apikey.txt",
  "utf8",
);
const baseUrl = raw.match(/https?:\/\/[^\s"'<>]+/)?.[0];
const key = raw.match(/\bsk-[A-Za-z0-9_-]+/)?.[0];
if (!baseUrl || !key) throw new Error("本地配置未包含可识别的接口地址与密钥。");
const built = await build({
  configFile: false,
  logLevel: "silent",
  publicDir: false,
  build: {
    write: false,
    target: "es2022",
    lib: {
      entry: "src/services/llm.ts",
      formats: ["es"],
      fileName: "provider",
    },
    minify: false,
  },
});
const output = (Array.isArray(built) ? built[0] : built).output.find(
  (o) => o.type === "chunk",
);
const { CompatibleProvider } = await import(
  "data:text/javascript;base64," + Buffer.from(output.code).toString("base64")
);
let config = {
  provider: "deepseek",
  baseUrl,
  model: "",
  maxTokens: 256,
  keyMode: "session",
};
try {
  const ids = await new CompatibleProvider(config, key).models();
  config.model =
    process.env.READER_TEST_MODEL ||
    ids.find((id) => /flash|chat|mini/i.test(id)) ||
    ids[0];
  if (!config.model)
    throw new Error("服务没有可用模型，请指定 READER_TEST_MODEL。");
  const provider = new CompatibleProvider(config, key);
  const plain = await provider.complete(
    [{ role: "user", content: "Reply only with OK." }],
    { maxTokens: 64 },
  );
  let streamed = "";
  const stream = await provider.complete(
    [{ role: "user", content: "用中文一句话解释机器人里程计。" }],
    { stream: true, maxTokens: 160, onToken: (t) => (streamed += t) },
  );
  const report = {
    testedAt: new Date().toISOString(),
    provider: "configured local endpoint",
    modelsDiscovered: ids,
    model: config.model,
    nonStreamingPassed: !!plain.text,
    streamingPassed: !!stream.text && stream.text === streamed,
    usage: plain.usage,
  };
  await mkdir("docs", { recursive: true });
  await writeFile(
    "docs/live-test.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error("真实模型验证失败：" + (e.code || e.name || "request_error"));
  process.exitCode = 1;
}
