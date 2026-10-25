// Autofill message handling for the service worker, factored pure so the
// security guards are unit-testable without a browser: every chrome/fetch
// call is injected.
//
// Trust boundary: only our own frame.html may ask for a fill, the target
// frame's URL is re-derived via chrome.webNavigation (never from page data),
// and the backend re-checks the entry against that URL server-side via
// /api/autofill before any password is produced.

import type { EntryInput, EntrySummary } from "./backend-client";

export type Sender = {
  url?: string;
  tab?: { id?: number };
  frameId?: number;
};

export type FillResult =
  | { kind: "fill"; tabId: number; frameId: number; username: string; password: string }
  | { kind: "migrate-fill"; tabId: number; frameId: number; username: string; current: string; next: string }
  | { kind: "reject"; reason: string };

export type Registration = { tabId: number; frameId: number; url: string };

export type FillDeps = {
  migrationPreview(entryId: string): Promise<{ current: string; next: string }>;
  migrate(entryId: string): Promise<unknown>;
  /** Look up the nonce registered by `pf:dropdown-opened`. The registering
   * sender is the content script, so its frameId/url are Chrome-verified —
   * never page-supplied data. */
  registration(nonce: string): Registration | undefined;
  autofill(url: string): Promise<EntrySummary[]>;
  generateEntry(entryId: string): Promise<string>;
  createEntry(input: EntryInput): Promise<{ id: string }>;
};

/** Only the extension's own autofill frame may request a fill. */
export function isFrameSender(sender: Sender | undefined, extensionOrigin: string): boolean {
  if (typeof sender?.url !== "string") return false;
  const path = sender.url.split(/[?#]/)[0];
  return path === `${extensionOrigin}frame.html`;
}

/** True for the popup and other extension pages — but not frame.html and not
 * content scripts (sender.url is the page URL, outside our origin). */
export function isExtensionPageSender(sender: Sender | undefined, extensionOrigin: string): boolean {
  if (typeof sender?.url !== "string" || !sender.url.startsWith(extensionOrigin)) return false;
  return !isFrameSender(sender, extensionOrigin);
}

/** RPC methods frame.html may call — read-only, revealing no vault data. */
const FRAME_RPC_WHITELIST = new Set(["health", "savedIntent", "connected"]);

/** Gate for `pf:rpc`: extension pages get everything; the autofill frame
 * gets only the no-secret whitelist; content scripts (any non-extension
 * sender) get nothing — otherwise a hostile page could call generateEntry
 * for every entry id, bypassing the frame+nonce+rematch pipeline. */
export function rpcAllowed(
  sender: Sender | undefined,
  extensionOrigin: string,
  method: string,
): boolean {
  if (isExtensionPageSender(sender, extensionOrigin)) return true;
  if (isFrameSender(sender, extensionOrigin)) return FRAME_RPC_WHITELIST.has(method);
  return false;
}

/** pf:candidates {nonce} — the frame asks for entries matching the URL its
 * opener registered; the frame never supplies the URL itself. */
export async function handleCandidates(
  deps: FillDeps,
  sender: Sender | undefined,
  extensionOrigin: string,
  nonce: string,
): Promise<{ ok: true; entries: EntrySummary[] } | { ok: false; error: string }> {
  if (!isFrameSender(sender, extensionOrigin)) {
    return { ok: false, error: "sender is not the autofill frame" };
  }
  const tabId = sender?.tab?.id;
  const reg = deps.registration(nonce);
  if (!reg || reg.tabId !== tabId || typeof tabId !== "number") {
    return { ok: false, error: "no matching dropdown registration" };
  }
  return { ok: true, entries: await deps.autofill(reg.url) };
}

/** Origin-less hostname of the frame URL, minus a leading www. */
export function frameSite(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

const DEFAULT_OPTIONS = { lowercase: true, uppercase: true, digits: true, symbols: true, length: 16 };

async function fillEntry(
  deps: FillDeps,
  tabId: number,
  frameId: number,
  entry: EntrySummary,
): Promise<FillResult> {
  const password = await deps.generateEntry(entry.id);
  return { kind: "fill", tabId, frameId, username: entry.login, password };
}

/** pf:fill {entryId, nonce} — verified sender + registered frame +
 * backend-side rematch, then fill into exactly that frame. */
export async function handleFill(
  deps: FillDeps,
  sender: Sender | undefined,
  extensionOrigin: string,
  entryId: string,
  nonce: string,
): Promise<FillResult> {
  if (!isFrameSender(sender, extensionOrigin)) {
    return { kind: "reject", reason: "sender is not the autofill frame" };
  }
  const tabId = sender?.tab?.id;
  if (typeof tabId !== "number") {
    return { kind: "reject", reason: "no tab on sender" };
  }
  const reg = deps.registration(nonce);
  if (!reg || reg.tabId !== tabId) {
    return { kind: "reject", reason: "no matching dropdown registration" };
  }
  const candidates = await deps.autofill(reg.url);
  const entry = candidates.find((c) => c.id === entryId);
  if (!entry) return { kind: "reject", reason: "entry does not match the frame url" };
  return fillEntry(deps, tabId, reg.frameId, entry);
}

/** pf:create-and-fill {login, nonce} — signup flow: create an entry for the
 * registered frame host with default options, then fill it. */
export async function handleCreateAndFill(
  deps: FillDeps,
  sender: Sender | undefined,
  extensionOrigin: string,
  login: string,
  nonce: string,
): Promise<FillResult> {
  if (!isFrameSender(sender, extensionOrigin)) {
    return { kind: "reject", reason: "sender is not the autofill frame" };
  }
  const tabId = sender?.tab?.id;
  if (typeof tabId !== "number") {
    return { kind: "reject", reason: "no tab on sender" };
  }
  const reg = deps.registration(nonce);
  if (!reg || reg.tabId !== tabId) {
    return { kind: "reject", reason: "no matching dropdown registration" };
  }
  const site = frameSite(reg.url);
  if (!site) return { kind: "reject", reason: "no usable host on frame url" };
  const created = await deps.createEntry({
    site,
    login,
    counter: 1,
    options: DEFAULT_OPTIONS,
    saltFields: [],
    crypto: null,
    folderId: "",
    groupIds: [],
    tags: [],
  });
  // The backend is the arbiter again: only fill if the new entry actually
  // matches the frame's URL.
  const candidates = await deps.autofill(reg.url);
  const entry = candidates.find((c) => c.id === created.id);
  if (!entry) return { kind: "reject", reason: "created entry does not match the frame url" };
  return fillEntry(deps, tabId, reg.frameId, entry);
}

/** pf:migrate-fill {entryId, nonce} — same guards as handleFill; returns the
 * sealed entry's {current,next} pair for the registered frame. */
export async function handleMigrateFill(
  deps: FillDeps,
  sender: Sender | undefined,
  extensionOrigin: string,
  entryId: string,
  nonce: string,
): Promise<FillResult> {
  if (!isFrameSender(sender, extensionOrigin)) {
    return { kind: "reject", reason: "sender is not the autofill frame" };
  }
  const tabId = sender?.tab?.id;
  if (typeof tabId !== "number") return { kind: "reject", reason: "no tab on sender" };
  const reg = deps.registration(nonce);
  if (!reg || reg.tabId !== tabId) {
    return { kind: "reject", reason: "no matching dropdown registration" };
  }
  const candidates = await deps.autofill(reg.url);
  const entry = candidates.find((c) => c.id === entryId);
  if (!entry) return { kind: "reject", reason: "entry does not match the frame url" };
  const { current, next } = await deps.migrationPreview(entryId);
  return {
    kind: "migrate-fill", tabId, frameId: reg.frameId,
    username: entry.login, current, next,
  };
}

/** pf:migrate-complete {entryId, nonce} — user confirmed the site accepted
 * the change; clears the seal server-side. */
export async function handleMigrateComplete(
  deps: FillDeps,
  sender: Sender | undefined,
  extensionOrigin: string,
  entryId: string,
  nonce: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isFrameSender(sender, extensionOrigin)) {
    return { ok: false, error: "sender is not the autofill frame" };
  }
  const tabId = sender?.tab?.id;
  if (typeof tabId !== "number") return { ok: false, error: "no tab on sender" };
  const reg = deps.registration(nonce);
  if (!reg || reg.tabId !== tabId) return { ok: false, error: "no matching dropdown registration" };
  await deps.migrate(entryId);
  return { ok: true };
}
