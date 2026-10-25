// PassForge extension service worker (MV3). Owns pairing, credentials
// (chrome.storage.session), backend RPC for the popup/frame, the autofill
// fill pipeline, the toolbar badge, and the context-menu/keyboard triggers.

import * as backend from "./backend-client";
import {
  handleCandidates, handleCreateAndFill, handleFill, handleMigrateComplete,
  handleMigrateFill, rpcAllowed,
} from "./sw-fill";
import { planWebauthn, type PasskeyDeps } from "./sw-passkey";

const RPC_METHODS: Record<string, (...args: never[]) => Promise<unknown>> = {
  savedIntent: backend.savedIntent,
  discover: backend.discover,
  connect: backend.connect,
  disconnect: backend.disconnect,
  connected: backend.connected,
  health: backend.health,
  generate: backend.generate,
  fingerprint: backend.fingerprint,
  getSettings: backend.getSettings,
  saveSettings: backend.saveSettings,
  serverInfo: backend.serverInfo,
  autofill: backend.autofill,
  createEntry: backend.createEntry,
  migrationPreview: backend.migrationPreview,
  migrate: backend.migrate,
  generateEntry: backend.generateEntry,
} as never;

// Dropdown registrations: nonce -> {tabId, frameId, url} recorded when a
// content script opens a dropdown (sender-verified). The frame proves it is
// that dropdown by echoing the nonce — pages can't read the frame's DOM.
const registrations = new Map<string, { tabId: number; frameId: number; url: string; at: number }>();

const fillDeps = {
  registration: (nonce: string) => {
    const reg = registrations.get(nonce);
    if (!reg) return undefined;
    // Registrations expire after 10 minutes; a stale dropdown can't fill.
    if (Date.now() - reg.at > 10 * 60 * 1000) {
      registrations.delete(nonce);
      return undefined;
    }
    return { tabId: reg.tabId, frameId: reg.frameId, url: reg.url };
  },
  autofill: backend.autofill,
  generateEntry: backend.generateEntry,
  createEntry: backend.createEntry,
  migrationPreview: backend.migrationPreview,
  migrate: backend.migrate,
};

// ---------------------------------------------------------------------------
// Badge: empty when connected+unlocked, "off" when disconnected, "!" locked.
// ---------------------------------------------------------------------------
async function refreshBadge() {
  try {
    const intent = await backend.savedIntent();
    if (intent !== "connected") {
      await chrome.action.setBadgeBackgroundColor({ color: "#8B949E" });
      await chrome.action.setBadgeText({ text: "off" });
      return;
    }
    const health = await backend.health();
    if (!health) {
      await chrome.action.setBadgeBackgroundColor({ color: "#8B949E" });
      await chrome.action.setBadgeText({ text: "off" });
      return;
    }
    if (health.locked) {
      await chrome.action.setBadgeBackgroundColor({ color: "#F59E0B" });
      await chrome.action.setBadgeText({ text: "!" });
      return;
    }
    await chrome.action.setBadgeText({ text: "" });
  } catch {
    /* badge is best-effort */
  }
}

const passkeyDeps: PasskeyDeps = {
  connected: backend.connected,
  createPasskey: backend.passkeyCreate,
  passkeyCandidates: backend.passkeyCandidates,
  getPasskey: backend.passkeyGet,
};

const passkeyRequests = new Map<
  string,
  {
    kind: string; origin: string; options: unknown;
    resolve: (res: Record<string, unknown>) => void;
    winId?: number;
    candidates?: { credentialId: string; userName: string; displayName: string }[];
  }
>();

function hostOfUrl(u: string): string {
  try { return new URL(u).hostname; } catch { return u; }
}

function passkeyRequestPayload(reqId: string) {
  const req = passkeyRequests.get(reqId);
  if (!req) return null;
  const pub = (req.options ?? {}) as Record<string, unknown>;
  const rp = (pub.rp as { id?: string; name?: string } | undefined) ?? {};
  const rpId = (rp.id as string) ?? (pub.rpId as string) ?? hostOfUrl(req.origin);
  const user = (pub.user as { name?: string; displayName?: string } | undefined) ?? {};
  return {
    reqId, kind: req.kind, origin: req.origin, rpId,
    userName: (user.name as string) ?? "",
    displayName: (user.displayName as string) ?? "",
    candidates: req.candidates ?? [],
  };
}

async function finishPasskey(reqId: string, res: Record<string, unknown>) {
  const req = passkeyRequests.get(reqId);
  if (!req) return;
  passkeyRequests.delete(reqId);
  if (req.winId != null) {
    try { await chrome.windows.remove(req.winId); } catch { /* already closed */ }
  }
  req.resolve(res);
}

async function openPasskeyConfirm(
  sender: chrome.runtime.MessageSender | undefined,
  msg: { id: string; kind: string; options: unknown },
): Promise<Record<string, unknown>> {
  const plan = await planWebauthn(passkeyDeps, sender as never, msg.kind, msg.options as Record<string, unknown>);
  if (plan.kind === "fallback") return { fallback: true };
  if (plan.kind === "error") return { error: plan.name, message: plan.message };
  const response = new Promise<Record<string, unknown>>((resolve) => {
    passkeyRequests.set(msg.id, {
      kind: msg.kind,
      origin: sender?.origin ?? "",
      options: msg.options,
      resolve,
      candidates: plan.kind === "confirm-get" ? plan.candidates : undefined,
    });
  });
  const url = chrome.runtime.getURL(`passkey.html?req=${encodeURIComponent(msg.id)}`);
  const win = await chrome.windows.create({ url, type: "popup", width: 420, height: 520 });
  const req = passkeyRequests.get(msg.id);
  if (req && win?.id != null) req.winId = win.id;
  const reqId = msg.id;
  const onRemoved = (winId: number) => {
    const r = passkeyRequests.get(reqId);
    if (r && r.winId === winId) {
      chrome.windows.onRemoved.removeListener(onRemoved);
      void finishPasskey(reqId, { error: "NotAllowedError", message: "cancelled" });
    }
  };
  chrome.windows.onRemoved.addListener(onRemoved);
  return response;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "pf:rpc" && typeof msg.method === "string") {
    const fn = RPC_METHODS[msg.method];
    // Content scripts (any non-extension sender) may not RPC at all; the
    // autofill frame only gets the read-only whitelist.
    if (!fn || !rpcAllowed(sender, chrome.runtime.getURL(""), msg.method)) {
      sendResponse({ ok: false, error: "not allowed" });
      return false;
    }
    const args = Array.isArray(msg.args) ? msg.args : [];
    void (fn(...(args as never[])) as Promise<unknown>)
      .then(async (result) => {
        if (msg.method === "connect" || msg.method === "disconnect") void refreshBadge();
        sendResponse({ ok: true, result });
      })
      .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true; // async response
  }

  if (msg?.type === "pf:dropdown-opened" && typeof msg.nonce === "string") {
    // Sender must be a content script — not one of our own extension pages:
    // sender.url is the page's http(s) URL, verified by Chrome. This is the
    // verified-URL anchor the whole fill pipeline re-checks against.
    const url = sender.url;
    const isPageSender = url?.startsWith("http://") || url?.startsWith("https://");
    if (sender.tab?.id != null && sender.frameId != null && url && isPageSender) {
      registrations.set(msg.nonce, {
        tabId: sender.tab.id,
        frameId: sender.frameId,
        url,
        at: Date.now(),
      });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg?.type === "pf:dropdown-closed" && typeof msg.nonce === "string") {
    registrations.delete(msg.nonce);
    sendResponse({ ok: true });
    return false;
  }

  if (msg?.type === "pf:candidates" && typeof msg.nonce === "string") {
    void handleCandidates(fillDeps, sender, chrome.runtime.getURL(""), msg.nonce)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  }

  if (msg?.type === "pf:webauthn" && typeof msg.id === "string") {
    void openPasskeyConfirm(sender, msg as never).then(sendResponse);
    return true;
  }

  if (msg?.type === "pf:webauthn-cancel" && typeof msg.id === "string") {
    void finishPasskey(msg.id, { error: "AbortError", message: "aborted" });
    sendResponse({ ok: true });
    return false;
  }

  // passkey.html -> SW: request details (only our own confirm page may ask).
  if (msg?.type === "pf:passkey-details" && typeof msg.reqId === "string") {
    const isPage = sender.url?.startsWith(chrome.runtime.getURL("passkey.html"));
    const payload = isPage ? passkeyRequestPayload(msg.reqId) : null;
    sendResponse(payload ? { ok: true, ...payload } : { ok: false });
    return false;
  }

  // passkey.html -> SW: the user's choice.
  if (msg?.type === "pf:passkey-choice" && typeof msg.reqId === "string") {
    const isPage = sender.url?.startsWith(chrome.runtime.getURL("passkey.html"));
    if (!isPage) {
      sendResponse({ ok: false, error: "not allowed" });
      return false;
    }
    const choice = msg.choice as string;
    const reqId = msg.reqId as string;
    const req = passkeyRequests.get(reqId);
    if (!req) {
      sendResponse({ ok: false, error: "no pending request" });
      return false;
    }
    sendResponse({ ok: true });
    if (choice === "fallback") {
      void finishPasskey(reqId, { fallback: true });
    } else if (choice === "cancel") {
      void finishPasskey(reqId, { error: "NotAllowedError", message: "cancelled" });
    } else {
      // confirm: call the backend create/get with the ORIGINAL options,
      // origin forced to the sender-verified one.
      void (async () => {
        try {
          const origin = req.origin;
          const pub = (req.options ?? {}) as Record<string, unknown>;
          const wire = req.kind === "create"
            ? await passkeyDeps.createPasskey({ ...pub, origin })
            : await passkeyDeps.getPasskey({
                ...pub,
                origin,
                rpId: (pub.rpId as string) ?? hostOfUrl(origin),
                credentialId: msg.credentialId ?? (pub.allowCredentials as { id: string }[] | undefined)?.[0]?.id,
              });
          await finishPasskey(reqId, { credential: wire });
        } catch (e) {
          await finishPasskey(reqId, {
            error: "NotAllowedError",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      })();
    }
    return false;
  }

  if (msg?.type === "pf:migrate-fill" && typeof msg.entryId === "string" && typeof msg.nonce === "string") {
    void handleMigrateFill(fillDeps, sender, chrome.runtime.getURL(""), msg.entryId, msg.nonce)
      .then((result) => {
        if (result.kind === "migrate-fill") {
          return chrome.tabs.sendMessage(
            result.tabId,
            {
              type: "pf:migrate-values",
              username: result.username,
              current: result.current,
              next: result.next,
            },
            { frameId: result.frameId },
          );
        }
        return result;
      })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  }

  if (msg?.type === "pf:migrate-complete" && typeof msg.entryId === "string" && typeof msg.nonce === "string") {
    void handleMigrateComplete(fillDeps, sender, chrome.runtime.getURL(""), msg.entryId, msg.nonce)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  }

  if (msg?.type === "pf:fill" && typeof msg.entryId === "string" && typeof msg.nonce === "string") {
    void handleFill(fillDeps, sender, chrome.runtime.getURL(""), msg.entryId, msg.nonce)
      .then(async (result) => {
        if (result.kind === "fill") {
          await chrome.tabs.sendMessage(
            result.tabId,
            { type: "pf:fill-values", username: result.username, password: result.password },
            { frameId: result.frameId },
          );
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: result.kind === "reject" ? result.reason : "rejected" });
        }
      })
      .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  }

  if (msg?.type === "pf:create-and-fill" && typeof msg.login === "string" && typeof msg.nonce === "string") {
    void handleCreateAndFill(fillDeps, sender, chrome.runtime.getURL(""), msg.login, msg.nonce)
      .then(async (result) => {
        if (result.kind === "fill") {
          await chrome.tabs.sendMessage(
            result.tabId,
            { type: "pf:fill-values", username: result.username, password: result.password },
            { frameId: result.frameId },
          );
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: result.kind === "reject" ? result.reason : "rejected" });
        }
      })
      .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Context menu + keyboard shortcut: ask the focused frame to open the
// dropdown for the focused field. The dropdown is always the choke point —
// nothing fills without the user picking an entry.
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "pf-fill",
    title: "Fill with PassForge",
    contexts: ["editable"],
  });
  void refreshBadge();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "pf-fill" || tab?.id == null) return;
  const options = typeof info.frameId === "number" ? { frameId: info.frameId } : undefined;
  void chrome.tabs.sendMessage(tab.id, { type: "pf:open-dropdown" }, options).catch(() => {});
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "fill-login") return;
  void chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const id = tabs[0]?.id;
    if (id != null) void chrome.tabs.sendMessage(id, { type: "pf:open-dropdown" }).catch(() => {});
  });
});

// Health refresh on startup and periodically so the lock badge tracks the app.
void refreshBadge();
chrome.alarms?.create("pf:health", { periodInMinutes: 1 });
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === "pf:health") void refreshBadge();
});
