// PassForge extension service worker (MV3). Owns pairing, credentials
// (chrome.storage.session), backend RPC for the popup/frame, the autofill
// fill pipeline, the toolbar badge, and the context-menu/keyboard triggers.

import * as backend from "./backend-client";
import { handleCandidates, handleCreateAndFill, handleFill, rpcAllowed } from "./sw-fill";

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
          sendResponse({ ok: false, error: result.reason });
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
          sendResponse({ ok: false, error: result.reason });
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
