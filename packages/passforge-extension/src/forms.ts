// Login/signup form detection for the content script. Pure DOM — no chrome
// APIs — so it is unit-tested under jsdom. The page only ever sees the icon
// and the dropdown chrome; entry data stays inside the extension.

export type FormKind = "login" | "signup" | "change";

export type DetectedForm = {
  kind: FormKind;
  username: HTMLInputElement | null;
  passwords: HTMLInputElement[];
  /** For `change` forms: the current-password field. */
  currentPassword?: HTMLInputElement;
};

export function isVisible(el: HTMLElement): boolean {
  if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
  if (el.getAttribute("type") === "hidden") return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  // In a real browser a field with no layout box is not user-visible.
  if (el.ownerDocument.defaultView !== null && el.getClientRects().length > 0) return true;
  return el.offsetWidth !== 0 || el.offsetHeight !== 0 || el.getClientRects().length > 0 || style.display !== "none";
}

function isTextLike(input: HTMLInputElement): boolean {
  const type = (input.getAttribute("type") ?? "text").toLowerCase();
  return ["text", "email", "tel", "username"].includes(type) && !input.readOnly && !input.disabled;
}

/** Candidate containers for username lookup: the field's form, or document. */
function scopeOf(field: HTMLInputElement): ParentNode {
  return field.form ?? field.ownerDocument;
}

/** Nearest preceding visible text-like input before `field` inside `scope`,
 * preferring autocomplete="username"/"email". */
export function findUsernameField(field: HTMLInputElement): HTMLInputElement | null {
  const scope = scopeOf(field);
  const texts = Array.from(scope.querySelectorAll("input")).filter(
    (el): el is HTMLInputElement => el instanceof HTMLInputElement && isTextLike(el) && isVisible(el),
  );
  const before = texts.filter((el) => el.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING);
  if (before.length === 0) return null;
  const ac = (el: HTMLInputElement) => (el.getAttribute("autocomplete") ?? "").toLowerCase();
  return before.find((el) => ac(el) === "username" || ac(el) === "email") ?? before[before.length - 1];
}

/** Every password form on the page: login (one field) vs signup/change
 * (new-password autocomplete or 2-3 password fields). */
export function detectForms(root: ParentNode = document): DetectedForm[] {
  const passwords = Array.from(root.querySelectorAll("input[type=password]")).filter(
    (el): el is HTMLInputElement => el instanceof HTMLInputElement && isVisible(el),
  );
  if (passwords.length === 0) return [];

  const grouped = new Map<ParentNode, HTMLInputElement[]>();
  for (const pw of passwords) {
    const scope = pw.form ?? root;
    grouped.set(scope, [...(grouped.get(scope) ?? []), pw]);
  }

  const forms: DetectedForm[] = [];
  for (const fields of grouped.values()) {
    const ac = (f: HTMLInputElement) => (f.getAttribute("autocomplete") ?? "").toLowerCase();
    // change-password needs an OLD field plus NEW field(s): a lone
    // current-password input is just a login form.
    const explicitCurrent = fields.find((f) => ac(f) === "current-password");
    const hasNew = fields.some((f) => ac(f) === "new-password");
    const currentPassword =
      fields.length >= 2
        ? (explicitCurrent && hasNew ? explicitCurrent : undefined) ??
          (fields.length >= 3 ? fields[0] : undefined)
        : undefined;
    const kind: FormKind = currentPassword
      ? "change"
      : fields.length >= 2 || fields.some((f) => ac(f) === "new-password")
        ? "signup"
        : "login";
    forms.push({
      kind,
      username: findUsernameField(fields[0]),
      passwords: fields,
      currentPassword,
    });
  }
  return forms;
}

/** Fill inputs like a user would: the native setter (so React-controlled
 * inputs accept it) followed by bubbling input/change events. */
export function fillInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter ? setter.call(input, value) : (input.value = value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Fill the detected form with credentials. Signup fills every password
 * field (new + confirm); login fills password + username when known. */
export function fillForm(form: DetectedForm, username: string, password: string) {
  if (form.kind === "login" && form.username && username) {
    fillInput(form.username, username);
  }
  for (const pw of form.passwords) {
    fillInput(pw, password);
  }
}
