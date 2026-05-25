import { afterEach, describe, expect, it } from "bun:test";
import { app } from "./app";

const originalClerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY;

describe("app security headers", () => {
  afterEach(() => {
    process.env.CLERK_PUBLISHABLE_KEY = originalClerkPublishableKey;
  });

  it("allows the Clerk browser runtime in Content-Security-Policy", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = "pk_test_YWN0dWFsLWhhbXN0ZXItNDIuY2xlcmsuYWNjb3VudHMuZGV2JA";

    const response = await app.handle(new Request("https://zero.qucord.com/api/health"));
    const csp = response.headers.get("content-security-policy") ?? "";

    expect(csp).toContain("script-src");
    expect(csp).toContain("https://actual-hamster-42.clerk.accounts.dev");
    expect(csp).toContain("https://challenges.cloudflare.com");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("frame-src 'self' https://challenges.cloudflare.com");
  });
});
