/**
 * SMS Mission Control RBAC — the "admin" role must have FULL OPERATIONAL control
 * (create/edit/delete templates, edit variables/content) via the new `manage_sms`
 * permission, WITHOUT touching any send-safety control.
 *
 * Proves:
 *  1. admin (+ super_admin) hold `manage_sms`; every other role does NOT — so no
 *     non-admin role's privileges changed.
 *  2. `manage_sms` is purely operational: it does NOT imply send-safety rights
 *     (kill switch / execution) or role management.
 *  3. This RBAC change does NOT alter the send-flag / kill-switch DEFAULT state —
 *     with no env set, SMS stays OFF (nothing sends).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ROLES,
  PERMISSION_KEYS,
  PERMISSIONS,
  getRoleSeed,
  hasPermission,
  allPermissions,
} from "../../lib/permissions";
import { DEFAULT_SETTINGS } from "../../lib/sms/store";
import { smsEnvEnabled } from "../../lib/sms/config";

/** Roles that legitimately manage Mission Control operationally. */
const OPERATIONAL_ROLES = ["admin", "super_admin"];
/** Every other seeded role must NOT gain manage_sms (no privilege change). */
const NON_OPERATIONAL_ROLES = [
  "content_admin",
  "content_editor",
  "current_affairs_editor",
  "support_ops",
  "finance",
  "viewer",
];

describe("SMS RBAC — manage_sms permission exists and is operational", () => {
  it("registers the manage_sms permission key in the Operations group", () => {
    assert.ok(PERMISSION_KEYS.includes("manage_sms"), "manage_sms must be a registered permission");
    const meta = PERMISSIONS.find((p) => p.key === "manage_sms");
    assert.ok(meta, "manage_sms must have PermissionMeta");
    assert.equal(meta!.group, "Operations");
    assert.notEqual(meta!.financial, true, "manage_sms is not a financial permission");
  });

  it("Super Admin (all permissions) holds manage_sms", () => {
    assert.equal(hasPermission(allPermissions(), "manage_sms"), true);
  });
});

describe("SMS RBAC — admin has FULL operational control", () => {
  it("admin can perform every operational Mission Control action (templates/variables/logs)", () => {
    const admin = getRoleSeed("admin");
    assert.ok(admin);
    // read Mission Control + logs
    assert.equal(hasPermission(admin!.permissions, "send_sms"), true, "admin can read Mission Control + logs");
    // create/edit/delete templates + edit variables/content
    assert.equal(hasPermission(admin!.permissions, "manage_sms"), true, "admin can manage templates + variables");
  });

  it("admin is NOT a Super Admin but still manages SMS operationally", () => {
    const admin = getRoleSeed("admin");
    assert.ok(admin);
    // admin explicitly cannot manage roles (proves it's the non-super admin role)
    assert.equal(hasPermission(admin!.permissions, "manage_roles"), false);
    // yet it now holds the operational SMS permission
    assert.equal(hasPermission(admin!.permissions, "manage_sms"), true);
  });
});

describe("SMS RBAC — no other role's privileges changed", () => {
  it("only admin + super_admin hold manage_sms", () => {
    for (const role of DEFAULT_ROLES) {
      const expected = OPERATIONAL_ROLES.includes(role.id);
      assert.equal(
        hasPermission(role.permissions, "manage_sms"),
        expected,
        `${role.id} manage_sms should be ${expected}`,
      );
    }
  });

  it("roles with send_sms but not admin/super do NOT get manage_sms (content_admin, support_ops)", () => {
    for (const id of ["content_admin", "support_ops"]) {
      const role = getRoleSeed(id);
      assert.ok(role, `missing role ${id}`);
      assert.equal(hasPermission(role!.permissions, "send_sms"), true, `${id} keeps send_sms`);
      assert.equal(hasPermission(role!.permissions, "manage_sms"), false, `${id} must NOT gain manage_sms`);
    }
  });

  it("non-operational roles hold neither send_sms-management nor escalated rights", () => {
    for (const id of NON_OPERATIONAL_ROLES) {
      const role = getRoleSeed(id);
      assert.ok(role, `missing role ${id}`);
      assert.equal(hasPermission(role!.permissions, "manage_sms"), false, `${id} must NOT have manage_sms`);
    }
  });
});

describe("SMS RBAC — manage_sms is operational, NOT send-safety", () => {
  it("manage_sms does not imply kill switch / execution / role management", () => {
    // A hypothetical role holding ONLY manage_sms gains no send-safety power.
    const perms = { manage_sms: true } as const;
    assert.equal(hasPermission(perms, "journey_manage_killswitch"), false);
    assert.equal(hasPermission(perms, "journey_manage_execution"), false);
    assert.equal(hasPermission(perms, "manage_roles"), false);
    assert.equal(hasPermission(perms, "send_sms"), false);
  });
});

describe("SMS RBAC — this change does NOT enable any send path", () => {
  it("SMS send flag / kill-switch DEFAULT state remains OFF (nothing sends)", () => {
    // Hard env gate defaults OFF when SMS_ENABLED is unset.
    assert.equal(smsEnvEnabled(), false, "SMS_ENABLED must be OFF by default");
    // Soft flag (settings.enabled) mirrors the env gate by default — OFF.
    assert.equal(DEFAULT_SETTINGS().enabled, false, "settings.enabled (soft kill switch) must default OFF");
  });
});
