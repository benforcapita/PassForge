import vectors from "../../../packages/passforge-protocol-js/test/vectors.json";
import { copyWithWipe } from "./clipboard";
import { generatePassword } from "./generate";
import { deleteProfile, loadProfiles, saveProfile } from "./profiles";
import { addServer, loadServers, removeServer, useServer } from "./servers";
import { memoryStore } from "./storage";

const INFO = {
  protocol: "passforge-remote-v1",
  name: "ref",
  version: "12.0.0",
  default_algorithm: "argon2id-v1",
  algorithms: [{ id: "argon2id-v1", description: "Argon2id", portable: true }],
};

describe("servers", () => {
  it("probes, normalizes and activates the first server", async () => {
    const store = memoryStore();
    const probe = jest.fn(async () => INFO);
    const state = await addServer(store, " https://alg.example.com/ ", probe);
    expect(probe).toHaveBeenCalledWith("https://alg.example.com");
    expect(state.active).toEqual({ url: "https://alg.example.com", algorithm: "argon2id-v1" });
    expect(await loadServers(store)).toEqual(state);
  });

  it("rejects cleartext non-loopback servers before probing", async () => {
    const probe = jest.fn(async () => INFO);
    await expect(addServer(memoryStore(), "http://alg.example.com", probe)).rejects.toThrow(/https/);
    expect(probe).not.toHaveBeenCalled();
  });

  it("switches algorithm and clears the active server on removal", async () => {
    const store = memoryStore();
    await addServer(store, "http://127.0.0.1:8790", async () => INFO);
    expect((await useServer(store, { url: "http://127.0.0.1:8790", algorithm: "pbkdf2-sha512-v1" })).active?.algorithm).toBe("pbkdf2-sha512-v1");
    expect(await removeServer(store, "http://127.0.0.1:8790")).toEqual({ servers: [], active: null });
  });
});

describe("profiles", () => {
  const base = { site: "github.com", login: "dev", counter: 1, lowercase: true, uppercase: true, digits: true, symbols: true, length: 16 };

  it("upserts by site + login and deletes", async () => {
    const store = memoryStore();
    await saveProfile(store, base);
    const list = await saveProfile(store, { ...base, site: "GitHub.com", counter: 2 });
    expect(list).toHaveLength(1);
    expect(list[0].counter).toBe(2);
    expect(await deleteProfile(store, list[0].id)).toEqual([]);
    expect(await loadProfiles(store)).toEqual([]);
  });

  it("stores parameters only", async () => {
    const store = memoryStore();
    await saveProfile(store, base);
    expect(Object.keys((await loadProfiles(store))[0]).sort()).toEqual(
      ["counter", "digits", "id", "length", "login", "lowercase", "site", "symbols", "uppercase"],
    );
  });
});

describe("generatePassword", () => {
  // The 100 000-iteration vector matches the app's DEFAULT_CRYPTO.
  const v = vectors.protocol.find((c) => c.crypto.iterations === 100_000 && c.crypto.digest === "sha256")!;

  it("blinds, derives through the server and finishes to the Rust vector", async () => {
    const derive = jest.fn(async (_url: string, _alg: string | null, input: string) => {
      expect(input).toBe(v.inputHex);
      return { algorithm: "argon2id-v1", output: v.serverOutput };
    });
    const result = await generatePassword(v.profile, v.masterPassword, { url: "https://alg.example", algorithm: null }, { derive });
    expect(result).toEqual({ password: v.password, algorithm: "argon2id-v1" });
    expect(derive).toHaveBeenCalledWith("https://alg.example", null, v.inputHex);
  });

  it("refuses to generate without a server", async () => {
    const derive = jest.fn();
    await expect(generatePassword(v.profile, "m", null, { derive })).rejects.toThrow(/algorithm server/);
    expect(derive).not.toHaveBeenCalled();
  });
});

describe("copyWithWipe", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function clipboard(initial = "") {
    let value = initial;
    return {
      set: jest.fn(async (v: string) => void (value = v)),
      get: jest.fn(async () => value),
      schedule: (fn: () => void, ms: number) => setTimeout(fn, ms),
      peek: () => value,
    };
  }

  it("clears after the delay when the clipboard still holds the password", async () => {
    const cb = clipboard();
    await copyWithWipe("s3cret", cb, 30);
    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(cb.peek()).toBe("");
  });

  it("leaves other clipboard content alone", async () => {
    const cb = clipboard();
    await copyWithWipe("s3cret", cb, 30);
    await cb.set("something else");
    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(cb.peek()).toBe("something else");
  });
});
