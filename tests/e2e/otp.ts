import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The sign-up verification code the e2e API stored for `email` (no real email
 * is sent in the e2e stack). Reads the e2e Redis through the backend helper.
 */
export function readOtp(email: string): string {
  return execFileSync(
    "node",
    [path.join(root, "scripts", "run-python.mjs"), "-m", "tests.e2e_otp", email],
    { cwd: root, encoding: "utf-8" },
  ).trim();
}
