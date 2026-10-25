// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { detectForms, fillForm, fillInput, findUsernameField } from "./forms";

function doc(html: string) {
  document.body.innerHTML = html;
  return document;
}

describe("detectForms", () => {
  it("detects a plain login form", () => {
    const d = doc(`
      <form><input type="text" name="u"><input type="password" name="p"></form>`);
    const forms = detectForms(d);
    expect(forms).toHaveLength(1);
    expect(forms[0].kind).toBe("login");
    expect(forms[0].passwords).toHaveLength(1);
    expect(forms[0].username?.name).toBe("u");
  });

  it("prefers an email/autocomplete username field", () => {
    const d = doc(`
      <form>
        <input type="text" name="other">
        <input type="email" name="mail" autocomplete="email">
        <input type="password" name="p">
      </form>`);
    const [form] = detectForms(d);
    expect(form.username?.name).toBe("mail");
  });

  it("classifies signup via new-password or multiple password fields", () => {
    const d = doc(`
      <form>
        <input type="text" name="user">
        <input type="password" autocomplete="new-password" name="p1">
        <input type="password" autocomplete="new-password" name="p2">
      </form>`);
    const [form] = detectForms(d);
    expect(form.kind).toBe("signup");
    expect(form.passwords).toHaveLength(2);
  });

  it("ignores hidden password fields", () => {
    const d = doc(`
      <form>
        <input type="password" style="display:none" name="h">
        <input type="text" name="u"><input type="password" name="p">
      </form>`);
    const [form] = detectForms(d);
    expect(form.passwords.map((p) => p.name)).toEqual(["p"]);
  });

  it("detects a password field with no <form> ancestor", () => {
    const d = doc(`<input type="text" id="u"><input type="password" id="p">`);
    const [form] = detectForms(d);
    expect(form.kind).toBe("login");
    expect(form.username?.id).toBe("u");
  });

  it("returns nothing on pages without password fields", () => {
    expect(detectForms(doc(`<input type="text">`))).toHaveLength(0);
  });
});

describe("findUsernameField", () => {
  it("picks the nearest preceding text input", () => {
    const d = doc(`
      <input type="text" name="a"><input type="text" name="b"><input type="password" name="p">`);
    const pw = d.querySelector<HTMLInputElement>("input[type=password]")!;
    expect(findUsernameField(pw)?.name).toBe("b");
  });
});

describe("fillInput", () => {
  it("dispatches bubbling input and change events", () => {
    const d = doc(`<input type="password" id="p">`);
    const input = d.getElementById("p") as HTMLInputElement;
    const seen: string[] = [];
    input.addEventListener("input", (e) => seen.push(`input:${e.bubbles}`));
    input.addEventListener("change", (e) => seen.push(`change:${e.bubbles}`));
    fillInput(input, "s3cret");
    expect(input.value).toBe("s3cret");
    expect(seen).toEqual(["input:true", "change:true"]);
  });

  it("uses the prototype setter so React-controlled inputs update", () => {
    const d = doc(`<input type="password" id="p">`);
    const input = d.getElementById("p") as HTMLInputElement;
    // React attaches an own `value` descriptor whose setter ignores values
    // it didn't produce; filling must go through the prototype setter.
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
    const calls: string[] = [];
    Object.defineProperty(HTMLInputElement.prototype, "value", {
      configurable: true,
      get: proto.get,
      set(this: HTMLInputElement, v: string) {
        calls.push(v);
        proto.set!.call(this, v);
      },
    });
    try {
      // An own property that would shadow a naive `input.value = x`.
      Object.defineProperty(input, "value", { value: "frozen", configurable: true });
      fillInput(input, "filled");
      expect(calls).toEqual(["filled"]);
      expect(proto.get!.call(input)).toBe("filled");
    } finally {
      Object.defineProperty(HTMLInputElement.prototype, "value", proto);
    }
  });
});

describe("fillForm", () => {
  it("fills login username + password, signup fills all password fields", () => {
    const d = doc(`
      <form>
        <input type="text" name="u" autocomplete="username">
        <input type="password" name="p">
      </form>`);
    const [form] = detectForms(d);
    fillForm(form, "alice", "pw");
    expect((d.querySelector("[name=u]") as HTMLInputElement).value).toBe("alice");
    expect((d.querySelector("[name=p]") as HTMLInputElement).value).toBe("pw");

    const d2 = doc(`
      <form>
        <input type="password" autocomplete="new-password" name="a">
        <input type="password" autocomplete="new-password" name="b">
      </form>`);
    const [signup] = detectForms(d2);
    fillForm(signup, "x", "pw2");
    expect((d2.querySelector("[name=a]") as HTMLInputElement).value).toBe("pw2");
    expect((d2.querySelector("[name=b]") as HTMLInputElement).value).toBe("pw2");
  });
});
