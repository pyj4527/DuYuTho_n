import { describe, expect, it } from "bun:test";
import { isAllowedPushEndpoint } from "./push-endpoint-policy";

describe("push endpoint policy", () => {
  it("allows known Web Push provider endpoints", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
  });

  it("rejects arbitrary HTTPS endpoints", () => {
    expect(isAllowedPushEndpoint("https://example.com/webpush/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://push.apple.com.evil.example/abc")).toBe(false);
  });

  it("rejects non-HTTPS endpoints even when the host is otherwise allowed", () => {
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
  });
});

