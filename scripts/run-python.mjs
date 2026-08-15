import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.join(root, "backend");
const isWindows = process.platform === "win32";
const candidates = isWindows
  ? [path.join(backend, ".venv", "Scripts", "python.exe")]
  : [
      path.join(backend, ".venv", "bin", "python3"),
      path.join(backend, ".venv", "bin", "python"),
    ];
const python = candidates.find((candidate) => fs.existsSync(candidate)) ?? (isWindows ? "python" : "python3");
const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write("usage: node scripts/run-python.mjs <python-args>\n");
  process.exit(1);
}

const child = spawn(python, args, {
  cwd: backend,
  stdio: "inherit",
  env: process.env,
  shell: false,
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 1);
});
