/**
 * LOCAL QA ONLY — mint an admin session token for `localhost` so the Phase 2
 * worklist UI can be exercised against a running `next dev`.
 *
 * Uses the DEV FALLBACK secret from `lib/config.ts` (`ADMIN_JWT_SECRET` is not
 * set in this environment), so it cannot mint anything a deployed instance
 * would accept. Read-only verification only — nothing here writes.
 *
 *   node scripts/qa/mint-local-admin-token.mjs
 */
import { SignJWT } from "jose";

const secret = new TextEncoder().encode(
  process.env.ADMIN_JWT_SECRET || "demo-admin-secret-change-me",
);

const token = await new SignJWT({
  admin_id: "local-qa",
  username: "local-qa",
  role: "super_admin",
  role_name: "Super Admin",
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("2h")
  .sign(secret);

process.stdout.write(token);
