import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { notesCustomerOrigin } from "../../lib/store/payments/callback";
import { storeOrderAccessCookieOptions } from "../../lib/store/accessToken";

describe("payment return", () => {
  test("apex callback lands on www so the checkout cookie is visible", () => {
    assert.equal(
      notesCustomerOrigin("https://namanias.com/api/v1/bank/payment"),
      "https://www.namanias.com",
    );
    assert.equal(
      notesCustomerOrigin("https://www.namanias.com/api/v1/bank/payment"),
      "https://www.namanias.com",
    );
  });

  test("preview hosts are left alone", () => {
    assert.equal(
      notesCustomerOrigin("https://naman-ias-git-preview.vercel.app/api/v1/bank/payment"),
      "https://naman-ias-git-preview.vercel.app",
    );
  });

  test("academy cookie survives a cross-site ICICI return", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const opts = storeOrderAccessCookieOptions("www.namanias.com");
      assert.equal(opts.sameSite, "none");
      assert.equal(opts.secure, true);
      assert.equal(opts.domain, ".namanias.com");
      assert.equal(opts.httpOnly, true);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test("local cookie stays Lax and host-only", () => {
    const prev = process.env.NODE_ENV;
    const vercel = process.env.VERCEL;
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    try {
      const opts = storeOrderAccessCookieOptions("localhost");
      assert.equal(opts.sameSite, "lax");
      assert.equal("domain" in opts, false);
    } finally {
      process.env.NODE_ENV = prev;
      if (vercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = vercel;
    }
  });
});
