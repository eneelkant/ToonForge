import { describe, expect, it } from "vitest";
import { assertSafeExternalUrl, assertSafeRelativePath, redactSecrets } from "../../src/core/security.js";

describe("security hardening", () => {
  it("blocks SSRF-ish hosts and path traversal", () => {
    expect(() => assertSafeExternalUrl("http://169.254.169.254/latest")).toThrow(/Blocked/);
    expect(() => assertSafeRelativePath("../etc/passwd")).toThrow(/traversal/);
    expect(redactSecrets({ token: "abc", ok: 1 }).token).toBe("[REDACTED]");
  });
  it("allows https urls", () => {
    expect(assertSafeExternalUrl("https://example.com/a").hostname).toBe("example.com");
  });
});
