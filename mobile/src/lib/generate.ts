import {
  blind,
  derive as remoteDerive,
  finishPassword,
  hexToBytes,
  type Profile,
} from "passforge-protocol";
import type { ActiveServer } from "./servers";

// Same default as the desktop backend's `defaultCrypto` in server mode, so a
// phone and a desktop pointed at the same server produce the same password.
export const DEFAULT_CRYPTO = { iterations: 100_000, digest: "sha256" };

export type GenerateDeps = { derive: typeof remoteDerive };

/**
 * blind (on device) -> derive (algorithm server) -> finish (on device).
 * No server means no password: there is no serverless fallback on mobile.
 */
export async function generatePassword(
  profile: Profile,
  masterPassword: string,
  server: ActiveServer | null,
  deps: GenerateDeps = { derive: remoteDerive },
): Promise<{ password: string; algorithm: string }> {
  if (!server) throw new Error("Add an algorithm server to generate passwords.");
  if (!profile.site.trim()) throw new Error("Enter a site.");
  if (!masterPassword) throw new Error("Enter your master password.");
  const blinded = blind(profile, masterPassword, DEFAULT_CRYPTO);
  try {
    const response = await deps.derive(server.url, server.algorithm, blinded.inputHex);
    return {
      password: finishPassword(blinded, hexToBytes(response.output), profile),
      algorithm: response.algorithm,
    };
  } finally {
    blinded.localKey.fill(0);
  }
}
