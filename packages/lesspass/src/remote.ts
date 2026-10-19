import { getAlgorithm } from "./crypto/algo";
import { PasswordOptions, renderPassword } from "./render-password";

export type RemoteProfile = PasswordOptions & {
  site: string;
  login: string;
  counter: number;
  saltFields?: { key: string; value: string }[];
};

export type RemoteCryptoConfig = {
  digest: string;
  iterations: number;
};

export type ServerInfo = {
  protocol: string;
  name: string;
  version: string;
  default_algorithm: string;
  algorithms: { id: string; description: string; portable: boolean }[];
};

export type DeriveResponse = {
  algorithm: string;
  output: string;
};

export type Blinded = {
  inputHex: string;
  localKey: CryptoKey | Uint8Array;
};

const encoder = new TextEncoder();
const SETTINGS_PREFIX = encoder.encode("passforge-settings-v1");
const BLINDING_PREFIX = encoder.encode("passforge-remote-v1");
const FINISH_PREFIX = encoder.encode("passforge-finish-v1");

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function u32be(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function lp(value: string): Uint8Array {
  const bytes = encoder.encode(value);
  return concatBytes(u32be(bytes.length), bytes);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) {
    throw new Error("algorithm server error: invalid server output hex");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  if (bytes.length < 32) {
    throw new Error("algorithm server error: server output must be at least 32 bytes");
  }
  return bytes;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function settingsDigest(profile: RemoteProfile): Promise<Uint8Array> {
  const flags =
    (profile.lowercase ? 1 : 0) |
    (profile.uppercase ? 2 : 0) |
    (profile.digits ? 4 : 0) |
    (profile.symbols ? 8 : 0);
  const fields = [...(profile.saltFields ?? [])].sort(
    (left, right) =>
      compareCodeUnits(left.key, right.key) ||
      compareCodeUnits(left.value, right.value),
  );
  const parts = [
    SETTINGS_PREFIX,
    u32be(profile.counter),
    new Uint8Array([flags]),
    u32be(profile.length),
    u32be(fields.length),
  ];
  for (const field of fields) {
    parts.push(lp(field.key), lp(field.value));
  }
  return new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bufferSource(concatBytes(...parts))),
  );
}

export async function blind(
  profile: RemoteProfile,
  masterPassword: string,
  crypto: RemoteCryptoConfig = { digest: "sha256", iterations: 100_000 },
): Promise<Blinded> {
  const settings = await settingsDigest(profile);
  const salt = concatBytes(
    BLINDING_PREFIX,
    lp(profile.site),
    lp(profile.login),
    settings,
  );
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(masterPassword),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: bufferSource(salt),
      iterations: crypto.iterations,
      hash: getAlgorithm(crypto.digest),
    },
    baseKey,
    512,
  );
  const derived = new Uint8Array(bits);
  return {
    inputHex: toHex(derived.slice(0, 32)),
    localKey: derived.slice(32, 64),
  };
}

export async function finishEntropy(
  blinded: Blinded,
  outputBytes: Uint8Array,
): Promise<string> {
  if (outputBytes.length < 32) {
    throw new Error("algorithm server error: server output must be at least 32 bytes");
  }
  const key =
    blinded.localKey instanceof CryptoKey
      ? blinded.localKey
      : await globalThis.crypto.subtle.importKey(
          "raw",
          bufferSource(blinded.localKey),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    bufferSource(concatBytes(FINISH_PREFIX, outputBytes)),
  );
  return toHex(new Uint8Array(signature));
}

export async function finishPassword(
  blinded: Blinded,
  outputBytes: Uint8Array,
  options: PasswordOptions,
): Promise<string> {
  return renderPassword(await finishEntropy(blinded, outputBytes), options);
}

export function normalizeServerUrl(url: string): string {
  const normalized = url.trim().replace(/\/+$/, "");
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    throw new Error("algorithm server URL must start with http:// or https://");
  }
  return normalized;
}

function redactInput(message: string, inputHex: string): string {
  if (!inputHex) return message;
  return message.replace(new RegExp(inputHex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[redacted]");
}

async function responseError(response: Response, inputHex = ""): Promise<Error> {
  let detail = "request failed";
  try {
    const body: unknown = await response.json();
    if (
      body !== null &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string" &&
      body.error.length > 0
    ) {
      detail = body.error;
    }
  } catch {
    // Use a generic message for malformed error bodies.
  }
  return new Error(`HTTP ${response.status}: ${redactInput(detail, inputHex)}`);
}

export async function fetchServerInfo(url: string): Promise<ServerInfo> {
  const normalized = normalizeServerUrl(url);
  let response: Response;
  try {
    response = await fetch(`${normalized}/v1/info`);
  } catch (error) {
    throw new Error(`algorithm server error: ${String(error)}`);
  }
  if (!response.ok) throw await responseError(response);
  let info: ServerInfo;
  try {
    info = (await response.json()) as ServerInfo;
  } catch {
    throw new Error("algorithm server error: invalid info response");
  }
  if (info.protocol !== "passforge-remote-v1") {
    throw new Error(`algorithm server error: unsupported protocol: ${info.protocol}`);
  }
  return info;
}

export async function deriveRemote(
  url: string,
  algorithm: string | null,
  inputHex: string,
): Promise<DeriveResponse> {
  const normalized = normalizeServerUrl(url);
  let response: Response;
  try {
    response = await fetch(`${normalized}/v1/derive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ algorithm, input: inputHex }),
    });
  } catch (error) {
    throw new Error(
      `algorithm server error: ${redactInput(String(error), inputHex)}`,
    );
  }
  if (!response.ok) throw await responseError(response, inputHex);
  try {
    return (await response.json()) as DeriveResponse;
  } catch {
    throw new Error("algorithm server error: invalid derive response");
  }
}

export async function generatePasswordRemote(
  profile: RemoteProfile,
  masterPassword: string,
  server: { url: string; algorithm: string | null },
): Promise<string> {
  const blinded = await blind(profile, masterPassword);
  const response = await deriveRemote(server.url, server.algorithm, blinded.inputHex);
  return finishPassword(blinded, fromHex(response.output), profile);
}
