import { describe, expect, it } from "vitest";
import {
  frameSite,
  handleCandidates,
  handleCreateAndFill,
  handleFill,
  isFrameSender,
  rpcAllowed,
  type FillDeps,
  type Registration,
} from "./sw-fill";
import type { EntrySummary } from "./backend-client";

const EXT = "chrome-extension://abc/";
const NONCE = "test-nonce-1";

const entry = (id: string, site = "github.com", login = "dev@passforge.io"): EntrySummary => ({
  id,
  site,
  login,
  counter: 1,
  folderId: "f1",
});

const REG: Registration = { tabId: 7, frameId: 2, url: "https://github.com/login" };

function deps(overrides: Partial<FillDeps> = {}): FillDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    registration: () => REG,
    autofill: async () => {
      calls.push("autofill");
      return [entry("e1"), entry("e2", "app.github.com")];
    },
    generateEntry: async (id) => {
      calls.push(`generate:${id}`);
      return "s3cret-pw";
    },
    migrationPreview: async () => ({ current: "old-pw", next: "new-pw" }),
    migrate: async () => ({}),
    createEntry: async () => {
      calls.push("create");
      return { id: "new" };
    },
    ...overrides,
  };
}

const sender = (url = `${EXT}frame.html#x`) => ({
  url,
  tab: { id: 7 },
  frameId: 3,
});

describe("isFrameSender", () => {
  it("accepts only the extension's own frame.html", () => {
    expect(isFrameSender(sender(), EXT)).toBe(true);
    expect(isFrameSender(sender("https://evil.com/"), EXT)).toBe(false);
    expect(isFrameSender(sender(`${EXT}frame.html.evil`), EXT)).toBe(false);
    expect(isFrameSender(undefined, EXT)).toBe(false);
  });
});

describe("handleFill", () => {
  it("rejects a sender that is not frame.html", async () => {
    const d = deps();
    const res = await handleFill(d, { url: "https://evil.com", tab: { id: 7 }, frameId: 3 }, EXT, "e1", NONCE);
    expect(res.kind).toBe("reject");
    expect(d.calls).not.toContain("generate:e1");
  });

  it("rejects an unregistered or wrong-tab nonce", async () => {
    const d = deps({ registration: () => undefined });
    const res = await handleFill(d, sender(), EXT, "e1", NONCE);
    expect(res).toEqual({ kind: "reject", reason: "no matching dropdown registration" });
    const d2 = deps({ registration: () => ({ ...REG, tabId: 99 }) });
    const res2 = await handleFill(d2, sender(), EXT, "e1", NONCE);
    expect(res2.kind).toBe("reject");
    expect(d.calls).not.toContain("generate:e1");
    expect(d2.calls).not.toContain("generate:e1");
  });

  it("rejects an entry that does not match the frame URL", async () => {
    const d = deps();
    const res = await handleFill(d, sender(), EXT, "nope", NONCE);
    expect(res).toEqual({ kind: "reject", reason: "entry does not match the frame url" });
    expect(d.calls).not.toContain("generate:nope");
  });

  it("fills a matching entry into the registered frame", async () => {
    const d = deps();
    const res = await handleFill(d, sender(), EXT, "e2", NONCE);
    expect(res).toEqual({
      kind: "fill",
      tabId: 7,
      frameId: 2,
      username: "dev@passforge.io",
      password: "s3cret-pw",
    });
    expect(d.calls).toContain("generate:e2");
  });
});

describe("handleCreateAndFill", () => {
  it("creates an entry for the registered frame host and fills it", async () => {
    const d = deps();
    d.autofill = async () => {
      d.calls.push("autofill");
      return [entry("new", "github.com", "me@x.io")];
    };
    const res = await handleCreateAndFill(d, sender(), EXT, "me@x.io", NONCE);
    expect(res.kind).toBe("fill");
    expect((res as { password: string }).password).toBe("s3cret-pw");
    expect(d.calls).toEqual(["create", "autofill", "generate:new"]);
  });

  it("rejects non-frame senders", async () => {
    const res = await handleCreateAndFill(deps(), { url: "https://evil.com" }, EXT, "x", NONCE);
    expect(res.kind).toBe("reject");
  });
});

describe("frameSite", () => {
  it("strips www. and lowercases the host", () => {
    expect(frameSite("https://www.GitHub.com/login")).toBe("github.com");
    expect(frameSite("http://localhost:3000/x")).toBe("localhost");
    expect(frameSite("not a url")).toBe("");
  });
});

describe("rpcAllowed", () => {
  const pageSender = { url: "https://github.com/login", tab: { id: 7 }, frameId: 0 };
  const popup = { url: `${EXT}index.html` };

  it("rejects content-script senders for every method", () => {
    for (const m of ["generateEntry", "autofill", "getSettings", "generate", "health"]) {
      expect(rpcAllowed(pageSender, EXT, m), m).toBe(false);
    }
  });

  it("lets frame.html call only the no-secret whitelist", () => {
    for (const m of ["generateEntry", "getSettings", "autofill", "saveSettings", "generate", "createEntry"]) {
      expect(rpcAllowed(sender(), EXT, m), m).toBe(false);
    }
    for (const m of ["health", "savedIntent", "connected"]) {
      expect(rpcAllowed(sender(), EXT, m), m).toBe(true);
    }
  });

  it("lets the popup call everything", () => {
    for (const m of ["generateEntry", "autofill", "getSettings", "generate", "connect"]) {
      expect(rpcAllowed(popup, EXT, m), m).toBe(true);
    }
  });
});

describe("handleCandidates", () => {
  it("rejects a non-frame sender and an unknown nonce", async () => {
    const d = deps();
    const bad = await handleCandidates(d, { url: "https://evil.com" }, EXT, NONCE);
    expect(bad).toEqual({ ok: false, error: "sender is not the autofill frame" });
    const d2 = deps({ registration: () => undefined });
    const noNonce = await handleCandidates(d2, sender(), EXT, NONCE);
    expect(noNonce.ok).toBe(false);
    expect(d.calls).not.toContain("autofill");
    expect(d2.calls).not.toContain("autofill");
  });

  it("rejects a nonce registered for a different tab", async () => {
    const d = deps({ registration: () => ({ ...REG, tabId: 99 }) });
    const res = await handleCandidates(d, sender(), EXT, NONCE);
    expect(res.ok).toBe(false);
  });

  it("returns backend results for a valid frame+nonce", async () => {
    const d = deps();
    const res = await handleCandidates(d, sender(), EXT, NONCE);
    expect(res).toEqual({ ok: true, entries: [entry("e1"), entry("e2", "app.github.com")] });
    expect(d.calls).toContain("autofill");
  });
});
