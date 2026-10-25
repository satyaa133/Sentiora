import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/ui/tokens.css"),
  "utf8",
);

type Tokens = Record<string, string>;

function parseBlock(selector: string): Tokens {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const tokens: Tokens = {};
  for (const match of css.slice(open + 1, close).matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    tokens[match[1]!] = match[2]!.trim();
  }
  return tokens;
}

const light = {
  ...parseBlock(':root,\n:root[data-theme="light"]'),
  ...parseBlock(":root {\n  --badge"),
};
const darkExplicit = parseBlock(':root[data-theme="dark"]');
const darkSystem = parseBlock(':root:not([data-theme="light"])');
const dark = { ...light, ...darkExplicit };

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// [foreground, background] pairs that carry text anywhere in the UI.
const TEXT_PAIRS: Array<[string, string]> = [
  ["--text", "--bg"],
  ["--text", "--surface"],
  ["--text", "--surface-raised"],
  ["--text-muted", "--bg"],
  ["--text-muted", "--surface"],
  ["--text-muted", "--surface-raised"],
  ["--link", "--bg"],
  ["--link", "--surface"],
  ["--accent-soft-text", "--accent-soft"],
  ["--on-accent", "--accent"],
  ["--on-accent", "--accent-hover"],
  ["--on-inverse", "--inverse"],
  ["--on-inverse-muted", "--inverse"],
  ["--badge-web-text", "--badge-web-bg"],
  ["--badge-pdf-text", "--badge-pdf-bg"],
  ["--badge-video-text", "--badge-video-bg"],
  ["--badge-note-text", "--badge-note-bg"],
];

describe("design tokens", () => {
  it("defines the same dark values for the OS preference and the manual override", () => {
    expect(darkSystem).toEqual(darkExplicit);
  });

  it("defines every token in both themes", () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      for (const theme of [light, dark]) {
        expect(theme[fg], fg).toMatch(/^#[0-9a-f]{6}$/);
        expect(theme[bg], bg).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("keeps text contrast at or above 4.5:1 in %s mode", (_name, theme) => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const ratio = contrast(theme[fg]!, theme[bg]!);
      expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps links off raised surfaces in light mode", () => {
    // DESIGN.md's --link (#C93520) only reaches 4.38:1 on --surface-raised (#EBEBE8),
    // so link text sits on --bg or --surface. Dark mode clears 4.5:1 everywhere.
    expect(contrast(light["--link"]!, light["--surface-raised"]!)).toBeLessThan(4.5);
    expect(contrast(dark["--link"]!, dark["--surface-raised"]!)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("never uses coral as text on light backgrounds", () => {
    expect(light["--link"]).not.toBe(light["--accent"]);
    expect(contrast(light["--accent"]!, light["--bg"]!)).toBeLessThan(4.5);
  });
});
