import { afterEach, describe, expect, it, vi } from "vitest";

import {
  THEME_STORAGE_KEY,
  applyThemePreference,
  initTheme,
  readThemePreference,
  resolveTheme,
  setThemePreference,
} from "../src/ui/theme.js";

class FakeRoot {
  attrs = new Map<string, string>();
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
}

function stubEnvironment(options: {
  stored?: string | null;
  prefersDark?: boolean;
  throws?: boolean;
}) {
  const store = new Map<string, string>();
  if (options.stored) store.set(THEME_STORAGE_KEY, options.stored);
  const failing = () => {
    throw new Error("blocked");
  };
  vi.stubGlobal("localStorage", {
    getItem: options.throws ? failing : (key: string) => store.get(key) ?? null,
    setItem: options.throws
      ? failing
      : (key: string, value: string) => void store.set(key, value),
    removeItem: options.throws ? failing : (key: string) => void store.delete(key),
  });
  vi.stubGlobal("matchMedia", () => ({ matches: Boolean(options.prefersDark) }));
  const root = new FakeRoot();
  vi.stubGlobal("document", { documentElement: root });
  return { store, root };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("theme preference", () => {
  it("defaults to system and follows the OS", () => {
    const { root } = stubEnvironment({ prefersDark: true });
    expect(initTheme()).toBe("system");
    expect(root.attrs.has("data-theme")).toBe(false);
    expect(resolveTheme("system")).toBe("dark");
  });

  it("applies and persists a manual choice", () => {
    const { store, root } = stubEnvironment({});
    setThemePreference("dark");
    expect(store.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(root.attrs.get("data-theme")).toBe("dark");

    setThemePreference("system");
    expect(store.has(THEME_STORAGE_KEY)).toBe(false);
    expect(root.attrs.has("data-theme")).toBe(false);
  });

  it("restores a stored choice on init", () => {
    const { root } = stubEnvironment({ stored: "light", prefersDark: true });
    expect(initTheme()).toBe("light");
    expect(root.attrs.get("data-theme")).toBe("light");
  });

  it("ignores unknown stored values", () => {
    stubEnvironment({ stored: "sepia" });
    expect(readThemePreference()).toBe("system");
  });

  it("survives storage that throws", () => {
    const { root } = stubEnvironment({ throws: true });
    expect(readThemePreference()).toBe("system");
    expect(() => setThemePreference("dark")).not.toThrow();
    expect(root.attrs.get("data-theme")).toBe("dark");
  });

  it("is a no-op without a document", () => {
    expect(() => applyThemePreference("dark", undefined)).not.toThrow();
  });
});
