// Build and package the Chrome extension for Chrome Web Store upload.
//
//   VITE_API_BASE_URL=https://api.example.com node scripts/package-extension.mjs
//   node scripts/package-extension.mjs --allow-localhost   # local test ZIP only
//
// Produces release/sentiora-extension-<version>.zip from a fresh build of
// extension/dist after validating the manifest and scanning the bundle. It does
// not publish anything.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "extension", "dist");
const allowLocalhost = process.argv.includes("--allow-localhost");
const problems = [];

// 1. API endpoint baked into the bundle at build time.
const apiBase = process.env.VITE_API_BASE_URL ?? "";
if (!apiBase && !allowLocalhost) {
  fail("Set VITE_API_BASE_URL to the production API origin (or pass --allow-localhost for a local test build).");
}
if (apiBase) {
  let parsed;
  try {
    parsed = new URL(apiBase);
  } catch {
    fail(`VITE_API_BASE_URL is not a valid URL: ${apiBase}`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (!allowLocalhost && (local || parsed.protocol !== "https:")) {
    fail("Release builds need an https, non-localhost VITE_API_BASE_URL.");
  }
}

// 2. Fresh build.
console.log(`Building extension (API: ${apiBase || "http://localhost:8000 (default)"})...`);
execSync("npm run build:extension", {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, VITE_API_BASE_URL: apiBase || "" },
});

// 3. Manifest checks (Chrome Web Store rules).
const manifest = JSON.parse(fs.readFileSync(path.join(dist, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) problems.push("manifest_version must be 3");
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? "")) problems.push("version must be 1-4 dot-separated integers");
if (!manifest.name || manifest.name.length > 75) problems.push("name is required (max 75 chars)");
if (!manifest.description || manifest.description.length > 132) problems.push("description is required (max 132 chars)");
if ("key" in manifest) problems.push("remove the development 'key' field before upload");
for (const size of ["16", "48", "128"]) {
  const icon = manifest.icons?.[size];
  if (!icon || !fs.existsSync(path.join(dist, icon))) problems.push(`missing ${size}px icon`);
}
const referenced = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...(manifest.content_scripts ?? []).flatMap((c) => c.js ?? []),
].filter(Boolean);
for (const file of referenced) {
  if (!fs.existsSync(path.join(dist, file))) problems.push(`manifest references missing file: ${file}`);
}

// 4. Bundle scan: no secrets, source maps, tests, env files, or remote scripts.
const files = walk(dist);
const secretPatterns = [
  [/sk-or-v1-[A-Za-z0-9]{20,}/, "OpenRouter key"],
  [/\bsk-[A-Za-z0-9_-]{32,}/, "OpenAI-style key"],
  [/AIza[0-9A-Za-z_-]{35}/, "Google API key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/(OPENAI|GEMINI|OPENROUTER)_API_KEY|JWT_SECRET_KEY|POSTGRES_PASSWORD/, "server secret name"],
];
for (const file of files) {
  const rel = path.relative(dist, file).replace(/\\/g, "/");
  if (/\.map$/.test(rel)) problems.push(`source map in bundle: ${rel}`);
  if (/(\.test\.|\.spec\.|__tests__|fixtures?\/)/.test(rel)) problems.push(`test file in bundle: ${rel}`);
  if (/(^|\/)\.env/.test(rel)) problems.push(`env file in bundle: ${rel}`);
  if (/\.(js|mjs|html|json)$/.test(rel)) {
    const text = fs.readFileSync(file, "utf8");
    for (const [pattern, label] of secretPatterns) {
      if (pattern.test(text)) problems.push(`${label} pattern found in ${rel}`);
    }
    if (/<script[^>]+src=["']https?:/i.test(text)) problems.push(`remote script tag in ${rel}`);
  }
}

if (problems.length) {
  console.error("\nPackaging blocked:\n  - " + problems.join("\n  - "));
  process.exit(1);
}

// 5. Deterministic ZIP (sorted entries, fixed timestamps).
const releaseDir = path.join(root, "release");
fs.mkdirSync(releaseDir, { recursive: true });
const suffix = allowLocalhost && !apiBase ? "-localdev" : "";
const zipPath = path.join(releaseDir, `sentiora-extension-${manifest.version}${suffix}.zip`);
const entries = files
  .map((file) => ({ name: path.relative(dist, file).replace(/\\/g, "/"), data: fs.readFileSync(file) }))
  .sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(zipPath, buildZip(entries));
console.log(`\nWrote ${path.relative(root, zipPath)} (${entries.length} files, ${fs.statSync(zipPath).size} bytes)`);
console.log("Not uploaded. Submit it via the Chrome Web Store Developer Dashboard after review.");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function buildZip(items) {
  const DOS_TIME = 0; // 00:00:00
  const DOS_DATE = (2020 - 1980) << 9 | 1 << 5 | 1; // 2020-01-01
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of items) {
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
