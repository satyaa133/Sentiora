// Fails when an AI provider key, a server secret name, or a direct call to an
// AI provider could reach browser code. Keys live only in the backend: the web
// app and the extension talk to the Sentiora API, never to OpenRouter/OpenAI/Gemini.
//
// Scans frontend/, extension/ and shared/ sources and, when present, their built
// dist/ output, plus the Vite configs (which decide what env vars get bundled).
// Usage: node scripts/check-client-secrets.mjs   (run after `npm run build` in CI)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["frontend", "extension", "shared"];
const scanned = /\.(m?[jt]sx?|html|json|css)$/;
const skipDirs = new Set(["node_modules", ".vite", "coverage"]);

const patterns = [
  [/sk-or-v1-[A-Za-z0-9]{20,}/, "OpenRouter key"],
  [/\bsk-[A-Za-z0-9_-]{32,}/, "OpenAI-style key"],
  [/AIza[0-9A-Za-z_-]{35}/, "Google API key"],
  [/(OPENAI|GEMINI|OPENROUTER)_API_KEY|JWT_SECRET_KEY|POSTGRES_PASSWORD/, "server secret name"],
  [/openrouter\.ai|api\.openai\.com|generativelanguage\.googleapis\.com/, "direct AI provider URL"],
  [/VITE_[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD)\b/, "secret-looking VITE_ variable"],
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return skipDirs.has(entry.name) ? [] : walk(full);
    return scanned.test(entry.name) ? [full] : [];
  });
}

const problems = [];
let count = 0;
for (const pkg of packages) {
  const files = [...walk(path.join(root, pkg, "src")), ...walk(path.join(root, pkg, "dist"))];
  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const text = fs.readFileSync(file, "utf8");
    count += 1;
    for (const [pattern, label] of patterns) {
      if (pattern.test(text)) problems.push(`${label} in ${rel}`);
    }
  }
  for (const name of ["vite.config.ts", "vite.config.js", "vite.config.mjs"]) {
    const config = path.join(root, pkg, name);
    if (!fs.existsSync(config)) continue;
    const text = fs.readFileSync(config, "utf8");
    // Vite only bundles VITE_* variables; widening the prefix would expose the
    // backend keys that sit in the same root .env file.
    if (/envPrefix\s*:/.test(text) && !/envPrefix\s*:\s*["']VITE_["']/.test(text)) {
      problems.push(`${pkg}/${name} changes envPrefix beyond VITE_`);
    }
    if (/define\s*:[^}]*process\.env/s.test(text)) {
      problems.push(`${pkg}/${name} injects process.env into the bundle`);
    }
  }
}

if (problems.length) {
  console.error("Client secret check failed:\n  - " + problems.join("\n  - "));
  process.exit(1);
}
console.log(`Client secret check passed (${count} files in ${packages.join(", ")}).`);
