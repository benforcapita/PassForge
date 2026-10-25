// Content script (isolated world): finds login/signup fields, draws the
// PassForge icon, and hosts the extension-origin dropdown iframe. It never
// sees entry data — candidates are fetched by the frame itself through the
// service worker; the content script only ever receives the final
// {username, password} pair, addressed to exactly this tab+frame.

import { detectForms, fillForm, type DetectedForm } from "./forms";

const ICON_HOST_ATTR = "data-pf-icon-host";
const DROPDOWN_ID = "pf-autofill-frame";

let currentDropdown: HTMLIFrameElement | null = null;
let currentForm: DetectedForm | null = null;
let lastFocused: Element | null = null;

function main() {
  document.addEventListener("focusin", (e) => {
    lastFocused = e.target as Element;
  });
  scan();
  let timer: ReturnType<typeof setTimeout> | undefined;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("resize", positionIcons, { passive: true });
  document.addEventListener("scroll", positionIcons, { capture: true, passive: true });
}

let knownFields = new WeakSet<HTMLInputElement>();

function scan() {
  for (const form of detectForms(document)) {
    const fields = [...form.passwords, ...(form.username ? [form.username] : [])];
    for (const field of fields) {
      if (knownFields.has(field)) continue;
      knownFields.add(field);
      attachIcon(field, form);
    }
  }
}

// ---------------------------------------------------------------------------
// Field icon — a shadow-rooted button positioned over the field's right edge.
// ---------------------------------------------------------------------------
function attachIcon(field: HTMLInputElement, form: DetectedForm) {
  const host = document.createElement("div");
  host.setAttribute(ICON_HOST_ATTR, "");
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    button { all: unset; display: flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; cursor: pointer; border-radius: 4px; }
    button:hover { background: rgba(6,182,212,.18); }
    img { width: 14px; height: 14px; display: block; }`;
  const button = document.createElement("button");
  button.type = "button";
  button.title = "Fill with PassForge";
  const img = document.createElement("img");
  img.src = chrome.runtime.getURL("icons/icon-16.png");
  img.alt = "";
  button.append(img);
  button.addEventListener("mousedown", (e) => e.preventDefault()); // keep field focus
  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openDropdown(field, form);
  });
  root.append(style, button);
  iconTargets.set(host, field);
  document.documentElement.appendChild(host);
  positionIcon(host, field);
}

const iconTargets = new Map<HTMLElement, HTMLInputElement>();

function positionIcon(host: HTMLElement, field: HTMLInputElement) {
  const r = field.getBoundingClientRect();
  if (r.width === 0) {
    host.style.display = "none";
    return;
  }
  host.style.display = "";
  host.style.position = "absolute";
  host.style.zIndex = "2147483646";
  host.style.top = `${r.top + window.scrollY + (r.height - 20) / 2}px`;
  host.style.left = `${r.right + window.scrollX - 26}px`;
}

function positionIcons() {
  for (const [host, field] of iconTargets) {
    if (!field.isConnected) {
      host.remove();
      iconTargets.delete(host);
      continue;
    }
    positionIcon(host, field);
  }
}

// ---------------------------------------------------------------------------
// Dropdown — extension-origin iframe; the page cannot read its DOM or data.
// ---------------------------------------------------------------------------
let currentNonce: string | null = null;

function openDropdown(field: HTMLInputElement, form: DetectedForm) {
  closeDropdown();
  currentForm = form;
  // A nonce ties this dropdown to the registration the SW records for our
  // frame: pf:fill replies must echo it, and we send it nowhere else.
  const nonce = crypto.randomUUID();
  currentNonce = nonce;
  void chrome.runtime.sendMessage({ type: "pf:dropdown-opened", nonce }).catch(() => {});

  const frame = document.createElement("iframe");
  frame.id = DROPDOWN_ID;
  const params = new URLSearchParams({
    url: location.href,
    kind: form.kind,
    username: form.username?.value ?? "",
    pf: nonce,
  });
  frame.src = `${chrome.runtime.getURL("frame.html")}#${params.toString()}`;
  Object.assign(frame.style, {
    position: "absolute",
    zIndex: "2147483647",
    border: "1px solid #30363D",
    borderRadius: "8px",
    width: "320px",
    height: "280px",
    background: "#0D1117",
    colorScheme: "dark",
    boxShadow: "0 8px 30px rgba(0,0,0,.55)",
  });
  const r = field.getBoundingClientRect();
  frame.style.top = `${r.bottom + window.scrollY + 4}px`;
  frame.style.left = `${Math.max(4, r.left + window.scrollX - 160)}px`;
  document.documentElement.appendChild(frame);
  currentDropdown = frame;
}

function closeDropdown() {
  if (currentNonce) {
    void chrome.runtime
      .sendMessage({ type: "pf:dropdown-closed", nonce: currentNonce })
      .catch(() => {});
    currentNonce = null;
  }
  currentDropdown?.remove();
  currentDropdown = null;
  currentForm = null;
}

// Page messages: only the dropdown's own window may talk, and only to close.
window.addEventListener("message", (e) => {
  if (e.source !== currentDropdown?.contentWindow) return;
  if (e.data?.type === "pf:close") closeDropdown();
});

document.addEventListener("pointerdown", (e) => {
  if (!currentDropdown) return;
  const path = e.composedPath();
  if (!path.includes(currentDropdown)) closeDropdown();
});

// ---------------------------------------------------------------------------
// Messages from the service worker: fill the fields, open the dropdown.
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "pf:fill-values" && currentForm) {
    fillForm(currentForm, String(msg.username ?? ""), String(msg.password ?? ""));
    closeDropdown();
  } else if (msg?.type === "pf:fill-values") {
    // No open dropdown — a shortcut/command fill targets the focused form.
    const form = detectForms(document)[0];
    if (form) fillForm(form, String(msg.username ?? ""), String(msg.password ?? ""));
  } else if (msg?.type === "pf:open-dropdown") {
    if (!document.hasFocus()) return;
    const forms = detectForms(document);
    const target = forms.find(
      (f) =>
        f.passwords.includes(lastFocused as HTMLInputElement) ||
        f.username === lastFocused,
    ) ?? forms[0];
    if (target) openDropdown(target.username ?? target.passwords[0], target);
  }
});

if (
  document.contentType === "text/html" &&
  (location.protocol === "http:" || location.protocol === "https:")
) {
  main();
}

export {};
