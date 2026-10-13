import { afterEach, describe, expect, it, vi } from "vitest";
import {
  blind,
  deriveRemote,
  fetchServerInfo,
  finishEntropy,
  settingsDigest,
  type RemoteProfile,
} from "./remote";

const profile: RemoteProfile = {
  site: "example.org",
  login: "alice@example.org",
  counter: 1,
  length: 16,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  saltFields: [{ key: "b", value: "2" }, { key: "a", value: "1" }],
};
const master = "correct horse battery staple";

afterEach(() => vi.unstubAllGlobals());

describe("remote derivation", () => {
  it("matches the Rust settings, blinded-input, and finish vectors", async () => {
    const digest = await settingsDigest(profile);
    const blinded = await blind(profile, master, { digest: "sha256", iterations: 100_000 });
    expect(Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")).toBe(
      "21aef735d75b51c62e732e6d38088fcf70ac8bb73adb59d5da04916a0283c417",
    );
    expect(blinded.inputHex).toBe(
      "a5d9cd6de9e6e665e2dbe35804538aa6382bfcf938c49eb05eb0146c500cac38",
    );
    expect(await finishEntropy(blinded, new Uint8Array(32).fill(0x42))).toBe(
      "cf777b92594f4a7196a95f5cf67a75ea3bd3cc986b575034dfe6dae7e348673e",
    );
  });

  it("sorts salt fields and rejects short server output", async () => {
    expect(await settingsDigest(profile)).toEqual(
      await settingsDigest({ ...profile, saltFields: [...profile.saltFields!].reverse() }),
    );
    await expect(finishEntropy(await blind(profile, master), new Uint8Array(31)))
      .rejects.toThrow("at least 32");
  });

  it("fetches compatible info and derives with the selected algorithm", async () => {
    const info = {
      protocol: "passforge-remote-v1",
      name: "test",
      version: "1",
      default_algorithm: "argon2id-v1",
      algorithms: [],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(info), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ algorithm: "argon2id-v1", output: "42" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchServerInfo("  http://localhost:8787/// ")).toEqual(info);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8787/v1/info");
    await expect(deriveRemote("http://localhost:8787/", null, "ab".repeat(32)))
      .resolves.toEqual({ algorithm: "argon2id-v1", output: "42" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      algorithm: null,
      input: "ab".repeat(32),
    });
  });

  it("rejects protocol mismatches and redacts input from server errors", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ protocol: "wrong" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: `bad ${"ab".repeat(32)}` }), { status: 400 })));
    await expect(fetchServerInfo("https://example.org"))
      .rejects.toThrow("unsupported protocol");
    const input = "ab".repeat(32);
    const error = await deriveRemote("https://example.org", "argon2id-v1", input)
      .catch((reason: Error) => reason);
    expect(error.message).toBe("HTTP 400: bad [redacted]");
    expect(error.message).not.toContain(input);
  });
});
