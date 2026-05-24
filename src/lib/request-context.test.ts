import { afterEach, describe, expect, it } from "bun:test";
import { isAnonymousHouseholdAllowed } from "./request-context";

const originalNodeEnv = process.env.NODE_ENV;
const originalAllowAnonymous = process.env.ALLOW_ANONYMOUS_HOUSEHOLD;

describe("request context auth policy", () => {
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.ALLOW_ANONYMOUS_HOUSEHOLD = originalAllowAnonymous;
  });

  it("blocks anonymous household fallback in production even when the flag is set", () => {
    expect(isAnonymousHouseholdAllowed({
      ALLOW_ANONYMOUS_HOUSEHOLD: "true",
      NODE_ENV: "production",
    })).toBe(false);
  });

  it("requires an explicit local flag for anonymous household fallback outside production", () => {
    expect(isAnonymousHouseholdAllowed({
      ALLOW_ANONYMOUS_HOUSEHOLD: "true",
      NODE_ENV: "development",
    })).toBe(true);
    expect(isAnonymousHouseholdAllowed({
      NODE_ENV: "development",
    })).toBe(false);
  });
});

