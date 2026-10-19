import { describe, expect, it } from "vitest";
import { INSECURE_SERVER_URL, INVALID_SERVER_URL, cleanUrl, serverUrlError } from "./url";

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

describe("serverUrlError", () => {
  it("accepts https:// anywhere and http:// on loopback", () => {
    for (const url of [
      "https://algorithm.example",
      "https://192.168.1.5:8790",
      "http://127.0.0.1:8790",
      "http://localhost:8790",
      "http://[::1]:8790",
    ]) {
      expect(serverUrlError(url)).toBeNull();
    }
  });
  it("rejects http:// for non-loopback hosts", () => {
    for (const url of [
      "http://algorithm.example",
      "http://192.168.1.5:8790",
      "http://localhost.example.com",
      "http://localhost@evil.example",
    ]) {
      expect(serverUrlError(url)).toBe(INSECURE_SERVER_URL);
    }
  });
  it("rejects invalid or non-http urls", () => {
    for (const url of ["", "not-a-url", "ftp://algorithm.example"]) {
      expect(serverUrlError(url)).toBe(INVALID_SERVER_URL);
    }
  });
});
