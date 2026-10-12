import { describe, expect, it } from "vitest";
import { cleanUrl } from "./url";

describe("cleanUrl", () => {
  it("extracts the hostname", () => {
    expect(cleanUrl("https://github.com/settings/keys")).toBe("github.com");
    expect(cleanUrl("http://localhost:1420/app")).toBe("localhost:1420");
  });
  it("returns empty for non-http or missing urls", () => {
    expect(cleanUrl("chrome://extensions")).toBe("");
    expect(cleanUrl(undefined)).toBe("");
  });
});
