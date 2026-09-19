import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  STORE_ACCESS_TOKEN_BYTES,
  encodeOrderAccessCookie,
  hashStoreAccessToken,
  mintStoreAccessToken,
  parseOrderAccessCookie,
  redactAccessSecrets,
  timingSafeEqualHex,
  verifyRawTokenAgainstHash,
} from "../../lib/store/accessToken.ts";

describe("store access token security", () => {
  test("mints ≥128 bits of entropy", () => {
    assert.ok(STORE_ACCESS_TOKEN_BYTES * 8 >= 128);
    const a = mintStoreAccessToken();
    const b = mintStoreAccessToken();
    assert.notEqual(a, b);
    // base64url of 24 bytes is 32 chars without padding
    assert.ok(a.length >= 32);
  });

  test("stores only a one-way hash — raw never equals hash", () => {
    const raw = mintStoreAccessToken();
    const hash = hashStoreAccessToken(raw);
    assert.notEqual(raw, hash);
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(verifyRawTokenAgainstHash(raw, hash), true);
    assert.equal(verifyRawTokenAgainstHash(raw + "x", hash), false);
    assert.equal(verifyRawTokenAgainstHash("", hash), false);
  });

  test("timing-safe compare rejects length mismatches", () => {
    assert.equal(timingSafeEqualHex("aa", "bb"), false);
    assert.equal(timingSafeEqualHex("abcd", "ab"), false);
    assert.equal(timingSafeEqualHex("abcd", "abcd"), true);
  });

  test("cookie encode/parse binds order number", () => {
    const raw = mintStoreAccessToken();
    const cookie = encodeOrderAccessCookie("nias-n-2026-000001", raw);
    const parsed = parseOrderAccessCookie(cookie, "NIAS-N-2026-000001");
    assert.ok(parsed);
    assert.equal(parsed!.orderNo, "NIAS-N-2026-000001");
    assert.equal(parsed!.token, raw);
    assert.equal(parseOrderAccessCookie(cookie, "NIAS-N-2026-999999"), null);
  });

  test("redacts tokens from analytics-shaped payloads", () => {
    const raw = mintStoreAccessToken();
    const redacted = redactAccessSecrets({
      path: `/notes/order/NIAS-N-1?t=${raw}`,
      access_token: raw,
      nested: { t: raw },
    });
    assert.equal((redacted as { access_token: string }).access_token, "[redacted]");
    assert.equal((redacted as { nested: { t: string } }).nested.t, "[redacted]");
    assert.ok(!(redacted as { path: string }).path.includes(raw));
  });
});
