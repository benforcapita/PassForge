// Client half of passforge-remote-v1 (docs/remote-protocol.md), ported from
// crates/passforge-protocol. There is deliberately no serverless path: a
// password always needs `serverOutput` from an algorithm server.
import { hmac } from "@noble/hashes/hmac.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { renderPassword, type PasswordOptions } from "./render.js";

export type SaltField = { key: string; value: string };

export type Profile = PasswordOptions & {
  site: string;
  login: string;
  counter: number;
  saltFields?: SaltField[];
};

export type Crypto = { iterations: number; digest: string };

export type Blinded = { input: Uint8Array; inputHex: string; localKey: Uint8Array };

const encoder = (s: string) => utf8ToBytes(s);

function u32be(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n >>> 0, false);
  return out;
}

function lp(bytes: Uint8Array): Uint8Array {
  return concatBytes(u32be(bytes.length), bytes);
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

export function settingsDigest(profile: Profile): Uint8Array {
  const flags =
    (profile.lowercase ? 1 : 0) |
    (profile.uppercase ? 2 : 0) |
    (profile.digits ? 4 : 0) |
    (profile.symbols ? 8 : 0);
  // Rust sorts by (key, value) as byte strings.
  const fields = (profile.saltFields ?? [])
    .map((f) => ({ key: encoder(f.key), value: encoder(f.value) }))
    .sort((a, b) => compareBytes(a.key, b.key) || compareBytes(a.value, b.value));
  return sha256(
    concatBytes(
      encoder("passforge-settings-v1"),
      u32be(profile.counter),
      new Uint8Array([flags]),
      u32be(profile.length),
      u32be(fields.length),
      ...fields.flatMap((f) => [lp(f.key), lp(f.value)]),
    ),
  );
}

function hashFor(digest: string) {
  switch (digest.toLowerCase()) {
    case "sha1":
    case "sha-1":
      return sha1;
    case "sha512":
    case "sha-512":
      return sha512;
    default:
      return sha256;
  }
}

export function blind(
  profile: Profile,
  masterPassword: string,
  crypto: Crypto = { iterations: 100_000, digest: "sha256" },
): Blinded {
  const salt = concatBytes(
    encoder("passforge-remote-v1"),
    lp(encoder(profile.site)),
    lp(encoder(profile.login)),
    settingsDigest(profile),
  );
  const okm = pbkdf2(hashFor(crypto.digest), encoder(masterPassword), salt, {
    c: crypto.iterations,
    dkLen: 64,
  });
  const input = okm.slice(0, 32);
  const localKey = okm.slice(32);
  okm.fill(0);
  return { input, inputHex: bytesToHex(input), localKey };
}

export function finishEntropy(blinded: Blinded, serverOutput: Uint8Array): string {
  if (serverOutput.length < 32) throw new Error("server output must contain at least 32 bytes");
  return bytesToHex(
    hmac(sha256, blinded.localKey, concatBytes(encoder("passforge-finish-v1"), serverOutput)),
  );
}

export function finishPassword(
  blinded: Blinded,
  serverOutput: Uint8Array,
  options: PasswordOptions,
): string {
  return renderPassword(finishEntropy(blinded, serverOutput), options);
}
