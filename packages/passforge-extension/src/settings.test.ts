import { afterEach, describe, expect, it, vi } from "vitest";
import { loadGenerationSetting, saveGenerationSetting } from "./settings";

describe("generation settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the default and persists a server setting", async () => {
    const data: Record<string, unknown> = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: data[key] })),
          set: vi.fn(async (value: Record<string, unknown>) => Object.assign(data, value)),
        },
      },
    });
    expect(await loadGenerationSetting()).toEqual({ mode: "serverless" });
    const setting = { mode: "server" as const, url: "http://localhost:8787", algorithm: null };
    await saveGenerationSetting(setting);
    expect(await loadGenerationSetting()).toEqual(setting);
  });
});
