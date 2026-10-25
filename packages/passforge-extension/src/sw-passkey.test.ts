import { describe, expect, it, vi } from "vitest";
import { planWebauthn, rpIdOf, senderIsTopFrame, type PasskeyDeps } from "./sw-passkey";

const deps = (overrides: Partial<PasskeyDeps> = {}): PasskeyDeps => ({
  connected: async () => true,
  createPasskey: vi.fn(async () => ({})),
  passkeyCandidates: vi.fn(async () => [{ credentialId: "c1", userName: "u", displayName: "d" }]),
  getPasskey: vi.fn(async () => ({})),
  ...overrides,
});

const TOP = { origin: "https://example.com", frameId: 0 };

describe("senderIsTopFrame", () => {
  it("accepts only frameId 0 with an origin", () => {
    expect(senderIsTopFrame(TOP)).toBe(true);
    expect(senderIsTopFrame({ origin: "https://x", frameId: 5 })).toBe(false);
    expect(senderIsTopFrame({ frameId: 0 })).toBe(false);
    expect(senderIsTopFrame(undefined)).toBe(false);
  });
});

describe("planWebauthn", () => {
  it("falls back for a non-top-frame sender", async () => {
    const res = await planWebauthn(deps(), { origin: "https://x", frameId: 3 }, "create", {});
    expect(res.kind).toBe("fallback");
  });
  it("falls back when the backend is disconnected", async () => {
    const res = await planWebauthn(deps({ connected: async () => false }), TOP, "create", {});
    expect(res.kind).toBe("fallback");
  });
  it("confirms create with rp + user details", async () => {
    const res = await planWebauthn(deps(), TOP, "create", {
      rp: { id: "example.com" },
      user: { name: "dev@x.io", displayName: "Dev" },
    });
    expect(res).toMatchObject({ kind: "confirm-create", rpId: "example.com", userName: "Dev" });
  });
  it("falls back on get with no candidates", async () => {
    const res = await planWebauthn(
      deps({ passkeyCandidates: async () => [] }),
      TOP, "get", { rpId: "example.com" },
    );
    expect(res.kind).toBe("fallback");
  });
  it("confirms get with candidates", async () => {
    const res = await planWebauthn(deps(), TOP, "get", { rpId: "example.com" });
    expect(res.kind).toBe("confirm-get");
  });
  it("uses sender.origin, never message-supplied origins", async () => {
    const res = await planWebauthn(deps(), TOP, "create", { rp: { name: "x" } });
    expect(res).toMatchObject({ kind: "confirm-create", origin: "https://example.com" });
  });
});

describe("rpIdOf", () => {
  it("prefers the declared rpId, falls back to the origin host", () => {
    expect(rpIdOf("https://app.x.io", "x.io")).toBe("x.io");
    expect(rpIdOf("https://app.x.io", undefined)).toBe("app.x.io");
    expect(rpIdOf("bad", undefined)).toBe("");
  });
});
