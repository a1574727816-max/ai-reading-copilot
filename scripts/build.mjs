import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { deflateSync } from "node:zlib";
const watch = process.argv.includes("--watch") ? {} : null;
if (watch) await rm("dist", { recursive: true, force: true });
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const notices = [
  "AI Reading Copilot — third-party packages bundled or used by production dependencies.",
];
for (const [path, meta] of Object.entries(lock.packages || {})) {
  if (!path.startsWith("node_modules/") || meta.dev) continue;
  const names = await readdir(path).catch(() => []);
  const license = names.find((n) => /^licen[sc]e(?:\.(md|txt))?$/i.test(n));
  if (license)
    notices.push(
      `\n--- ${path.replace("node_modules/", "")} ${meta.version} ---\n` +
        (await readFile(`${path}/${license}`, "utf8")),
    );
}
await mkdir("public", { recursive: true });
await writeFile("public/THIRD_PARTY_LICENSES.txt", notices.join("\n"));
// Generated locally: no remote fonts, scripts or build-time secrets.
function crc(buf) {
  let c = -1;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type),
    n = Buffer.alloc(4),
    c = Buffer.alloc(4);
  n.writeUInt32BE(data.length);
  c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([n, t, data, c]);
}
await mkdir("public/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const line =
        x > size * 0.25 &&
        x < size * 0.75 &&
        ((y > size * 0.28 && y < size * 0.36) ||
          (y > size * 0.46 && y < size * 0.54) ||
          (y > size * 0.64 && y < size * 0.72));
      raw.set(line ? [240, 249, 245, 255] : [24, 91, 72, 255], i);
    }
  const h = Buffer.alloc(13);
  h.writeUInt32BE(size);
  h.writeUInt32BE(size, 4);
  h[8] = 8;
  h[9] = 6;
  await writeFile(
    `public/icons/${size}.png`,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", h),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
await build({
  configFile: false,
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: !watch,
    target: "chrome116",
    watch,
    rollupOptions: {
      input: {
        sidepanel: "sidepanel.html",
        options: "options.html",
        background: "src/background/index.ts",
      },
      output: {
        manualChunks(id) {
          if (id.includes("/katex/")) return "math-renderer";
          if (id.includes("/highlight.js/") || id.includes("/lowlight/"))
            return "code-highlight";
        },
        entryFileNames: (chunk) =>
          chunk.name === "background"
            ? "background.js"
            : "assets/[name]-[hash].js",
      },
    },
  },
});
await build({
  configFile: false,
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "chrome116",
    watch,
    lib: {
      entry: "src/content/index.ts",
      name: "ReadingCopilot",
      formats: ["iife"],
      fileName: () => "content.js",
    },
  },
});
