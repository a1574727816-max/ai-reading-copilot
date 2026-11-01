import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
const secretText = await readFile("大模型地址和apikey.txt", "utf8").catch(
  () => "",
);
const keys = secretText.match(/\bsk-[A-Za-z0-9_-]+/g) || [];
async function scan(root) {
  for (const e of await readdir(root, { withFileTypes: true })) {
    const path = join(root, e.name);
    if (e.isDirectory()) await scan(path);
    else {
      if (/apikey|api-key|\.env/i.test(e.name))
        throw new Error("发布目录出现敏感配置文件名");
      const data = await readFile(path);
      if (keys.some((k) => data.includes(Buffer.from(k))))
        throw new Error("发布目录包含本地测试密钥");
    }
  }
}
await scan("dist");
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
if (manifest.host_permissions?.length)
  throw new Error("生产 manifest 意外包含强制网站权限");
if (manifest.content_security_policy.extension_pages.includes("unsafe-eval"))
  throw new Error("不安全的扩展 CSP");
for (const path of [
  "dist/content.js",
  "dist/background.js",
  "dist/sidepanel.html",
  "dist/options.html",
])
  await readFile(path);
console.log(
  "发布检查通过：构建入口完整、无强制全站权限、无本地测试密钥、无敏感配置文件。",
);
