// Passkey request flow in the service worker. Pure helpers take injected deps
// so they're unit-testable; the wiring lives in background.ts.

export type WebauthnResult =
  | { kind: "confirm-create"; origin: string; rpId: string; userName: string }
  | { kind: "confirm-get"; origin: string; rpId: string; candidates: { credentialId: string; userName: string; displayName: string }[] }
  | { kind: "fallback" }
  | { kind: "error"; name: string; message: string };

export type PasskeyDeps = {
  connected(): Promise<boolean>;
  /** Create a credential server-side; returns the wire response. */
  createPasskey(body: unknown): Promise<unknown>;
  /** List candidate credentials for (origin, rpId, allowCredentials). */
  passkeyCandidates(body: unknown): Promise<unknown[]>;
  getPasskey(body: unknown): Promise<unknown>;
};

type ReqSender = { origin?: string; frameId?: number };

/** Only the top frame may trigger passkeys in v1 — anything else falls back
 * so the page's native implementation handles it. */
export function senderIsTopFrame(sender: ReqSender | undefined): boolean {
  return sender?.frameId === 0 && typeof sender.origin === "string";
}

export function rpIdOf(url: string | undefined, rpId: string | undefined): string {
  if (rpId) return rpId;
  try {
    return new URL(url ?? "").hostname;
  } catch {
    return "";
  }
}

/** Plan a create request: backend checks + rpId policy are the SW's job; the
 * confirmation window is opened by the caller when the result is a confirm. */
export async function planWebauthn(
  deps: PasskeyDeps,
  sender: ReqSender | undefined,
  kind: string,
  options: Record<string, unknown>,
): Promise<WebauthnResult> {
  if (!senderIsTopFrame(sender)) return { kind: "fallback" };
  if (!(await deps.connected())) return { kind: "fallback" };
  const origin = sender!.origin!;
  if (kind === "create") {
    const pub = options;
    const rp = rpIdOf(origin, (pub.rp as { id?: string } | undefined)?.id);
    const user = pub.user as { name?: string; displayName?: string } | undefined;
    return {
      kind: "confirm-create",
      origin,
      rpId: rp,
      userName: user?.displayName ?? user?.name ?? "unknown",
    };
  }
  if (kind === "get") {
    const pub = options;
    const rp = rpIdOf(origin, pub.rpId as string | undefined);
    const candidates = (await deps.passkeyCandidates({
      origin,
      rpId: rp,
      allowCredentials: (pub.allowCredentials as { id: string }[] | undefined) ?? [],
    })) as { credentialId: string; userName: string; displayName: string }[];
    if (candidates.length === 0) return { kind: "fallback" };
    return { kind: "confirm-get", origin, rpId: rp, candidates };
  }
  return { kind: "fallback" };
}
