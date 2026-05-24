import { describe, expect, it } from "bun:test";
import { resolveRateLimitClientIp } from "./rate-limit";

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("https://api.example.test/api/v1/lens/analyze-image", { headers });
}

describe("rate limit client identity", () => {
  it("prefers Cloudflare client IP over spoofable X-Forwarded-For", () => {
    expect(resolveRateLimitClientIp(requestWithHeaders({
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "198.51.100.44",
    }), { NODE_ENV: "production" })).toBe("203.0.113.9");
  });

  it("does not trust X-Forwarded-For by default in production", () => {
    expect(resolveRateLimitClientIp(requestWithHeaders({
      "x-forwarded-for": "198.51.100.44",
    }), { NODE_ENV: "production" })).toBe("local");
  });

  it("allows X-Forwarded-For only when production proxy trust is explicitly enabled", () => {
    expect(resolveRateLimitClientIp(requestWithHeaders({
      "x-forwarded-for": "198.51.100.44",
    }), {
      NODE_ENV: "production",
      RATE_LIMIT_TRUST_X_FORWARDED_FOR: "true",
    })).toBe("198.51.100.44");
  });
});
