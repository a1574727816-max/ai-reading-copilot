import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { deflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
function crc(buf) {
  let c = -1;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ -1) >>> 0;
}
async function filesIn(root) {
  const files = [];
  for (const e of await readdir(root, { withFileTypes: true })) {
    const path = join(root, e.name);
    if (e.isDirectory()) files.push(...(await filesIn(path)));
    else if (e.isFile()) files.push(path);
  }
  return files.sort();
}
async function zip(files, target, mapName) {
  const local = [],
    central = [];
  let offset = 0;
  for (const path of files) {
    const data = await readFile(path),
      compressed = deflateRawSync(data),
      name = Buffer.from(mapName(path).replaceAll("\\", "/"));
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x800, 6);
    h.writeUInt16LE(8, 8);
    h.writeUInt16LE(0x21, 12);
    h.writeUInt32LE(crc(data), 14);
    h.writeUInt32LE(compressed.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(name.length, 26);
    local.push(h, name, compressed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc(data), 16);
    c.writeUInt32LE(compressed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += h.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  await writeFile(target, Buffer.concat([...local, directory, end]));
  return createHash("sha256")
    .update(await readFile(target))
    .digest("hex");
}
await mkdir("release", { recursive: true });
await import("./verify-release.mjs");
const extensionFiles = await filesIn("dist");
// Explicit allowlist: the user's credential file is never part of either archive.
const sourceFiles = [
  ".gitignore",
  ".gitattributes",
  "README.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vitest.config.ts",
  "playwright.config.ts",
  "sidepanel.html",
  "options.html",
  "项目任务书.md",
  ...(await filesIn("src")),
  ...(await filesIn("public")),
  ...(await filesIn("scripts")),
  ...(await filesIn("tests")),
  ...(await filesIn("docs")),
];
const outputs = [];
for (const [kind, files, map] of [
  ["extension", extensionFiles, (p) => relative("dist", p)],
  ["source", sourceFiles, (p) => p],
]) {
  const target = `release/ai-reading-copilot-${version}-${kind}.zip`;
  const sha256 = await zip(files, target, map);
  outputs.push({ file: target, bytes: (await stat(target)).size, sha256 });
}
await writeFile(
  "release/checksums.txt",
  outputs.map((o) => `${o.sha256}  ${o.file.split("/").at(-1)}`).join("\n") +
    "\n",
);
console.log(JSON.stringify(outputs, null, 2));
