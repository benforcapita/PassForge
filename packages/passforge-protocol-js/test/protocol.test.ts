// Golden vectors come from `cargo run -p passforge-protocol --example vectors`;
// every value here must match the Rust implementation byte for byte.
import { afterEach, describe, expect, it, vi } from "vitest";
import { bytesToHex } from "@noble/hashes/utils.js";
import vectors from "./vectors.json" with { type: "json" };
import {
  blind,
  createFingerprint,
  derive,
  finishEntropy,
  finishPassword,
  hexToBytes,
  info,
  normalizeServerUrl,
  renderPassword,
  settingsDigest,
} from "../src/index.js";

describe("protocol vectors", () => {
  for (const v of vectors.protocol) {
    it(`${v.profile.site} / ${v.profile.login} / ${v.crypto.digest} x${v.crypto.iterations}`, () => {
      expect(bytesToHex(settingsDigest(v.profile))).toBe(v.settingsDigest);
      const blinded = blind(v.profile, v.masterPassword, v.crypto);
      expect(blinded.inputHex).toBe(v.inputHex);
      const output = hexToBytes(v.serverOutput);
      expect(finishEntropy(blinded, output)).toBe(v.entropy);
      expect(finishPassword(blinded, output, v.profile)).toBe(v.password);
    });
  }

  it("rejects short server output", () => {
    const v = vectors.protocol[0];
    const blinded = blind(v.profile, v.masterPassword, v.crypto);
    expect(() => finishEntropy(blinded, new Uint8Array(31))).toThrow(/at least 32 bytes/);
  });
});

describe("render vectors", () => {
  for (const v of vectors.render) {
    it(`${v.entropy.slice(0, 8)} ${JSON.stringify(v.options)}`, () => {
      expect(renderPassword(v.entropy, v.options)).toBe(v.password);
    });
  }

  it("rejects lengths that cannot fit the rules", () => {
    expect(() =>
      renderPassword("ff", { lowercase: true, uppercase: true, digits: true, symbols: true, length: 3 }),
    ).toThrow(/cannot fit 4/);
  });
});

describe("fingerprint vectors", () => {
  for (const v of vectors.fingerprint) {
    it(JSON.stringify(v.masterPassword), () => {
      expect(createFingerprint(v.masterPassword)).toEqual(v.fingerprint);
    });
  }
});

describe("normalizeServerUrl", () => {
  it.each([
    ["https://algorithms.example.com/", "https://algorithms.example.com"],
    ["  https://a.example:8443/base//", "https://a.example:8443/base"],
    ["http://127.0.0.1:8790", "http://127.0.0.1:8790"],
    ["http://localhost:8787/", "http://localhost:8787"],
    ["http://[::1]:8787", "http://[::1]:8787"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeServerUrl(input)).toBe(expected);
  });

  it.each(["http://algorithms.example.com", "http://192.168.1.10:8787"])("rejects cleartext %s", (url) => {
    expect(() => normalizeServerUrl(url)).toThrow(/https/);
  });

  it.each(["ftp://x.example", "not a url", ""])("rejects invalid %s", (url) => {
    expect(() => normalizeServerUrl(url)).toThrow(/valid http/);
  });
});

describe("server helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it("info accepts a passforge-remote-v1 server", async () => {
    respond(200, { protocol: "passforge-remote-v1", name: "ref", version: "12", default_algorithm: "argon2id-v1", algorithms: [] });
    await expect(info("https://a.example")).resolves.toMatchObject({ name: "ref" });
  });

  it("info rejects another protocol", async () => {
    respond(200, { protocol: "something-else" });
    await expect(info("https://a.example")).rejects.toThrow(/not a passforge-remote-v1/);
  });

  it("derive posts the input and validates the output", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ algorithm: "argon2id-v1", output: "ab".repeat(32) })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(derive("https://a.example/", null, "cd".repeat(32))).resolves.toEqual({
      algorithm: "argon2id-v1",
      output: "ab".repeat(32),
    });
    expect(fetchMock).toHaveBeenCalledWith("https://a.example/v1/derive", expect.objectContaining({ method: "POST", body: JSON.stringify({ algorithm: null, input: "cd".repeat(32) }) }));
  });

  it("derive rejects short output", async () => {
    respond(200, { algorithm: "x", output: "ab".repeat(31) });
    await expect(derive("https://a.example", null, "cd".repeat(32))).rejects.toThrow(/invalid output/);
  });

  it("surfaces server errors", async () => {
    respond(503, { error: "overloaded" });
    await expect(derive("https://a.example", null, "cd".repeat(32))).rejects.toThrow("overloaded");
  });
});
