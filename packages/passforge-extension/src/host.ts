// Native-messaging client for passforge-host. Optional: the popup stays a
// pure LessPass-style generator when the host isn't installed — ops that
// need the vault just fail soft.

export type VaultEntrySummary = {
  id: string;
  site: string;
  login: string;
  counter: number;
  folder_id: string;
  fingerprint?: unknown;
};

export type VaultEntry = VaultEntrySummary & {
  profile: {
    site: string;
    login: string;
    counter: number;
    options: {
      lowercase: boolean;
      uppercase: boolean;
      digits: boolean;
      symbols: boolean;
      length: number;
    };
    salt_fields: unknown[];
  };
};

type Response =
  | { status: "ok"; result: unknown }
  | { status: "err"; error: string };

const HOST = "com.passforge.desktop";

function send(payload: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(HOST, payload, (raw: Response) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (raw?.status === "ok") return resolve(raw.result);
      reject(new Error(raw?.error ?? "host error"));
    });
  });
}

export async function searchEntries(query: string): Promise<VaultEntrySummary[]> {
  return (await send({ op: "search", query })) as VaultEntrySummary[];
}

export async function getEntry(entryId: string): Promise<VaultEntry> {
  return (await send({ op: "get_entry", entry_id: entryId })) as VaultEntry;
}

export async function ping(): Promise<boolean> {
  try {
    await send({ op: "ping" });
    return true;
  } catch {
    return false;
  }
}
