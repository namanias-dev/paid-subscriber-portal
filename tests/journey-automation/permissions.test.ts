/**
 * (ii) Permission gating — proves SMS Mission Control access (send_sms) does NOT
 * grant Journey Automation publish / kill-switch, and that the new keys are
 * restrictive by default (only Super Admin holds them).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ROLES,
  PERMISSION_KEYS,
  getRoleSeed,
  hasPermission,
  allPermissions,
  type PermissionKey,
} from "../../lib/permissions";

const JOURNEY_KEYS: PermissionKey[] = [
  "journey_view",
  "journey_create_draft",
  "journey_edit_draft",
  "journey_publish",
  "journey_pause",
  "journey_manage_templates",
  "journey_manage_killswitch",
];

describe("journey permissions — keys exist and are restrictive", () => {
  it("registers all seven journey permission keys", () => {
    for (const k of JOURNEY_KEYS) {
      assert.ok(PERMISSION_KEYS.includes(k), `missing permission key: ${k}`);
    }
  });

  it("Super Admin (all permissions) holds publish + kill switch", () => {
    const perms = allPermissions();
    assert.equal(hasPermission(perms, "journey_publish"), true);
    assert.equal(hasPermission(perms, "journey_manage_killswitch"), true);
  });
});

describe("journey permissions — Mission Control access does NOT grant journey rights", () => {
  it("roles with send_sms do not implicitly get journey publish/kill-switch", () => {
    const rolesWithSms = DEFAULT_ROLES.filter((r) => r.permissions.send_sms === true);
    // sanity: content_admin & support_ops carry send_sms
    assert.ok(rolesWithSms.some((r) => r.id === "content_admin"));
    assert.ok(rolesWithSms.some((r) => r.id === "support_ops"));

    for (const role of rolesWithSms) {
      // Super Admin / Admin are all-permission roles and legitimately hold everything.
      if (role.id === "super_admin" || role.id === "admin") continue;
      assert.equal(hasPermission(role.permissions, "send_sms"), true, `${role.id} should have send_sms`);
      assert.equal(hasPermission(role.permissions, "journey_publish"), false, `${role.id} must NOT have journey_publish`);
      assert.equal(hasPermission(role.permissions, "journey_manage_killswitch"), false, `${role.id} must NOT have journey_manage_killswitch`);
      assert.equal(hasPermission(role.permissions, "journey_view"), false, `${role.id} must NOT have journey_view`);
    }
  });

  it("support_ops (frontline) has zero journey permissions", () => {
    const supportOps = getRoleSeed("support_ops");
    assert.ok(supportOps);
    for (const k of JOURNEY_KEYS) {
      assert.equal(hasPermission(supportOps!.permissions, k), false, `support_ops must NOT have ${k}`);
    }
  });

  it("finance / viewer / content_editor cannot view or publish journeys", () => {
    for (const id of ["finance", "viewer", "content_editor", "current_affairs_editor"]) {
      const role = getRoleSeed(id);
      assert.ok(role, `missing role ${id}`);
      assert.equal(hasPermission(role!.permissions, "journey_view"), false);
      assert.equal(hasPermission(role!.permissions, "journey_publish"), false);
      assert.equal(hasPermission(role!.permissions, "journey_manage_killswitch"), false);
    }
  });
});
