// Runs in the page's MAIN world (document_start). Wraps
// navigator.credentials.create/get, relays to the isolated content script via
// window.postMessage (validated by random request id), and resolves with a
// PublicKeyCredential-like object. Any failure → the page's native
// implementation gets the ORIGINAL options object.

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  signal?: AbortSignal;
};

const pending = new Map<string, Pending>();

function b64u(buf: ArrayBufferLike): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64(s: string): ArrayBuffer {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i += 1) bytes[i] = b.charCodeAt(i);
  return bytes.buffer;
}

// Serialize the publicKey options: ArrayBuffers/Views → b64url strings.
function serialize(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (value instanceof ArrayBuffer) return b64u(value);
  if (ArrayBuffer.isView(value)) {
    return b64u((value as ArrayBufferView).buffer.slice(
      (value as ArrayBufferView).byteOffset,
      (value as ArrayBufferView).byteOffset + (value as ArrayBufferView).byteLength,
    ));
  }
  if (Array.isArray(value)) return value.map(serialize);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = serialize(v);
  }
  return out;
}

function makeCredential(result: Record<string, unknown>, requested: PublicKeyCredentialCreationOptions | PublicKeyCredentialRequestOptions): PublicKeyCredential {
  const cred = result as Record<string, unknown>;
  const attestation = cred.attestationObject != null;
  const response: Record<string, unknown> = attestation
    ? {
        clientDataJSON: fromB64(cred.clientDataJSON as string),
        attestationObject: fromB64(cred.attestationObject as string),
        getTransports: () => cred.transports ?? ["internal", "hybrid"],
        getPublicKey: () => fromB64(cred.publicKey as string),
        getPublicKeyAlgorithm: () => -7,
        getAuthenticatorData: () => fromB64(cred.authenticatorData as string),
      }
    : {
        clientDataJSON: fromB64(cred.clientDataJSON as string),
        authenticatorData: fromB64(cred.authenticatorData as string),
        signature: fromB64(cred.signature as string),
        userHandle:
          cred.userHandle == null ? null : fromB64(cred.userHandle as string),
      };
  const proto = attestation
    ? (window as unknown as { AuthenticatorAttestationResponse: { prototype: object } })
        .AuthenticatorAttestationResponse.prototype
    : (window as unknown as { AuthenticatorAssertionResponse: { prototype: object } })
        .AuthenticatorAssertionResponse.prototype;
  const resp = {};
  Object.setPrototypeOf(resp, proto);
  Object.defineProperties(resp, Object.getOwnPropertyDescriptors(response));

  const credProps = (requested as { extensions?: { credProps?: boolean } }).extensions?.credProps;
  const obj = {
    id: cred.credentialId,
    rawId: fromB64(cred.credentialId as string),
    type: "public-key",
    authenticatorAttachment: "platform",
    response: resp,
    getClientExtensionResults: () =>
      credProps ? { credProps: { rk: true } } : {},
    toJSON: () => ({
      id: cred.credentialId,
      rawId: cred.credentialId,
      type: "public-key",
      authenticatorAttachment: "platform",
      response: Object.fromEntries(
        Object.entries(response)
          .filter(([k, v]) => v instanceof ArrayBuffer)
          .map(([k, v]) => [k, b64u(v as ArrayBuffer)]),
      ),
      clientExtensionResults: {},
    }),
  };
  Object.setPrototypeOf(obj, PublicKeyCredential.prototype);
  return obj as unknown as PublicKeyCredential;
}

window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  const d = e.data as {
    __pf?: string;
    id?: string;
    credential?: unknown;
    fallback?: boolean;
    error?: string;
    message?: string;
  };
  if (d?.__pf !== "webauthn-res" || typeof d.id !== "string") return;
  const p = pending.get(d.id);
  if (!p) return;
  pending.delete(d.id);
  if (d.fallback) {
    p.resolve({ __pfFallback: true });
    return;
  }
  if (d.error) {
    p.reject(new DOMException(d.message ?? "The operation was cancelled", d.error));
    return;
  }
  p.resolve(d.credential);
});

function wrap(kind: "create" | "get", original: (o: unknown) => Promise<unknown>) {
  return function (this: unknown, options: CredentialCreationOptions | CredentialRequestOptions | undefined) {
    const pub = options?.publicKey;
    const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
    if (!pub || (options as { mediation?: string }).mediation === "conditional") {
      return original.call(this, options);
    }
    const id = crypto.randomUUID();
    const serialized = serialize(pub);
    const promise = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject, signal });
      if (signal) {
        signal.addEventListener("abort", () => {
          if (pending.delete(id)) {
            window.postMessage({ __pf: "webauthn-cancel", id }, "*");
            reject(new DOMException("The operation was aborted", "AbortError"));
          }
        });
      }
    }).then((result) => {
      if ((result as { __pfFallback?: boolean })?.__pfFallback) {
        return original.call(this, options);
      }
      return makeCredential(result as Record<string, unknown>, pub);
    });
    window.postMessage({ __pf: "webauthn-req", id, kind, options: serialized }, "*");
    return promise;
  };
}

const credentials = navigator.credentials;
if (credentials?.create && credentials.get) {
  const origCreate = credentials.create.bind(credentials) as (o: unknown) => Promise<unknown>;
  const origGet = credentials.get.bind(credentials) as (o: unknown) => Promise<unknown>;
  credentials.create = wrap("create", origCreate) as typeof credentials.create;
  credentials.get = wrap("get", origGet) as typeof credentials.get;
}

export {};
