/**
 * Notes Store staff authorization.
 * Pure permission matrix plus source checks that pages and APIs use it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  allPermissions,
  getRoleSeed,
  isSuperAdmin,
  resolvePermissions,
  type PermissionSet,
} from "../../lib/permissions";
import {
  canManageNotesOrders,
  canManageNotesStoreSettings,
  canReadNotesAnalytics,
  canReadNotesLeads,
  canReadNotesOrders,
  canUpdateNotesLeads,
} from "../../lib/store/notesAccess";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** Production admin/finance role rows do not include Notes keys. Overrides grant them. */
const FINANCE = getRoleSeed("finance")!.permissions;
const SUPPORT = getRoleSeed("support_ops")!.permissions;
const VIEWER = getRoleSeed("viewer")!.permissions;

const anil = resolvePermissions(FINANCE, { store_view_orders: true, store_manage_orders: false });
const abhishek = resolvePermissions(
  { manage_staff: true, manage_roles: false, view_revenue: true },
  { store_view_orders: true, store_manage_orders: true },
);
const suraj = resolvePermissions(
  { manage_staff: true, manage_roles: false, view_revenue: true },
  { store_view_orders: true, store_manage_orders: true },
);
const superAdmin = allPermissions();
const ordinary = resolvePermissions(SUPPORT, null);

function expectReadOnly(perms: PermissionSet) {
  assert.equal(canReadNotesOrders(perms), true);
  assert.equal(canReadNotesLeads(perms), true);
  assert.equal(canManageNotesOrders(perms), false);
  assert.equal(canUpdateNotesLeads(perms), false);
  assert.equal(canReadNotesAnalytics(perms), false);
  assert.equal(canManageNotesStoreSettings(perms), false);
  assert.equal(isSuperAdmin(perms), false);
}

function expectOperational(perms: PermissionSet) {
  assert.equal(canReadNotesOrders(perms), true);
  assert.equal(canReadNotesLeads(perms), true);
  assert.equal(canManageNotesOrders(perms), true);
  assert.equal(canUpdateNotesLeads(perms), false);
  assert.equal(canReadNotesAnalytics(perms), false);
  assert.equal(canManageNotesStoreSettings(perms), false);
  assert.equal(isSuperAdmin(perms), false);
}

describe("Notes staff access matrix", () => {
  it("anil_kumar can read orders and leads and cannot mutate or see analytics", () => {
    expectReadOnly(anil);
  });

  it("abhishek_prajapati can operate orders and cannot see analytics", () => {
    expectOperational(abhishek);
  });

  it("suraj_singh can operate orders and cannot see analytics", () => {
    expectOperational(suraj);
  });

  it("Super Admin keeps orders, leads, analytics, and settings", () => {
    assert.equal(isSuperAdmin(superAdmin), true);
    assert.equal(canReadNotesOrders(superAdmin), true);
    assert.equal(canManageNotesOrders(superAdmin), true);
    assert.equal(canReadNotesLeads(superAdmin), true);
    assert.equal(canUpdateNotesLeads(superAdmin), true);
    assert.equal(canReadNotesAnalytics(superAdmin), true);
    assert.equal(canManageNotesStoreSettings(superAdmin), true);
  });

  it("an explicit manage=false override beats a role that can manage orders", () => {
    const locked = resolvePermissions(
      { store_view_orders: true, store_manage_orders: true },
      { store_manage_orders: false },
    );
    assert.equal(canReadNotesOrders(locked), true);
    assert.equal(canManageNotesOrders(locked), false);
  });

  it("store_manage_orders does not grant analytics", () => {
    const manager: PermissionSet = { store_view_orders: true, store_manage_orders: true };
    assert.equal(canManageNotesOrders(manager), true);
    assert.equal(canReadNotesAnalytics(manager), false);
  });

  it("ordinary staff and viewer roles are not granted Notes access", () => {
    for (const perms of [ordinary, resolvePermissions(VIEWER, null), resolvePermissions(FINANCE, null)]) {
      assert.equal(canReadNotesOrders(perms), false);
      assert.equal(canManageNotesOrders(perms), false);
      assert.equal(canReadNotesLeads(perms), false);
      assert.equal(canReadNotesAnalytics(perms), false);
    }
  });

  it("built-in non-admin roles do not seed Notes permissions", () => {
    for (const id of ["finance", "support_ops", "viewer", "content_editor", "content_admin", "current_affairs_editor"]) {
      const role = getRoleSeed(id)!;
      assert.equal(role.permissions.store_view_orders, undefined);
      assert.equal(role.permissions.store_manage_orders, undefined);
    }
  });
});

describe("Notes routes enforce the matrix on the server", () => {
  it("orders and leads pages allow read access and still 404 otherwise", () => {
    for (const path of ["app/admin/notes/page.tsx", "app/admin/notes/leads/page.tsx", "app/admin/notes/orders/layout.tsx"]) {
      const src = read(path);
      assert.match(src, /requireStoreOrderRead\(\)/);
      assert.match(src, /notFound\(\)/);
    }
  });

  it("analytics, overview, and interest stay Super Admin only", () => {
    for (const path of [
      "app/admin/notes/analytics/page.tsx",
      "app/admin/notes/overview/page.tsx",
      "app/admin/notes/interest/page.tsx",
      "app/api/admin/notes/overview/route.ts",
      "app/api/admin/notes/interest/route.ts",
    ]) {
      const src = read(path);
      assert.match(src, /requireSuperAdmin\(\)/);
      assert.doesNotMatch(src, /requirePermission\("store_manage_orders"\)/);
      assert.doesNotMatch(src, /requireStoreOrderRead\(\)/);
    }
  });

  it("order reads accept view access and mutations stay on store_manage_orders", () => {
    const orders = read("app/api/admin/notes/orders/route.ts");
    assert.match(orders, /requireStoreOrderRead\(\)/);
    assert.match(orders, /requirePermission\("store_manage_orders"\)/);
    assert.match(orders, /can_manage/);
    assert.match(orders, /can_view_analytics/);

    const invoice = read("app/api/admin/notes/orders/[id]/invoice/route.ts");
    assert.match(invoice, /export async function GET[\s\S]*requireStoreOrderRead\(\)/);
    assert.match(invoice, /export async function POST[\s\S]*requirePermission\("store_manage_orders"\)/);

    for (const path of [
      "app/api/admin/notes/orders/[id]/advance/route.ts",
      "app/api/admin/notes/orders/[id]/pack/route.ts",
      "app/api/admin/notes/orders/[id]/ship/route.ts",
      "app/api/admin/notes/orders/[id]/dispatch/route.ts",
      "app/api/admin/notes/orders/[id]/pickup/route.ts",
      "app/api/admin/notes/orders/[id]/carrier/route.ts",
      "app/api/admin/notes/orders/[id]/rates/route.ts",
      "app/api/admin/notes/orders/[id]/label/route.ts",
      "app/api/admin/notes/orders/[id]/track/route.ts",
      "app/api/admin/notes/orders/[id]/note/route.ts",
      "app/api/admin/notes/orders/[id]/issues/route.ts",
      "app/api/admin/notes/orders/[id]/reconcile/route.ts",
      "app/api/admin/notes/orders/address/route.ts",
      "app/api/admin/notes/orders/[id]/support-decision/route.ts",
    ]) {
      assert.match(read(path), /requirePermission\("store_manage_orders"\)/, path);
      assert.doesNotMatch(read(path), /requireStoreOrderRead\(\)/, path);
    }
  });

  it("checkout lead updates and store settings are Super Admin only", () => {
    const leads = read("app/api/admin/notes/leads/route.ts");
    assert.match(leads, /export async function GET[\s\S]*requireStoreOrderRead\(\)/);
    assert.match(leads, /export async function PATCH[\s\S]*requireSuperAdmin\(\)/);
    const refund = read("app/api/admin/notes/orders/[id]/refund/route.ts");
    assert.match(refund, /requireSuperAdmin\(\)/);
    assert.doesNotMatch(refund, /store_manage_orders/);
    for (const path of [
      "app/api/admin/notes/store-state/route.ts",
      "app/api/admin/notes/fulfillment-settings/route.ts",
      "app/api/admin/notes/invoice-settings/route.ts",
      "app/api/admin/notes/invoices/historical/route.ts",
      "app/api/admin/notes/invoices/correct-display/route.ts",
    ]) {
      const src = read(path);
      assert.match(src, /requireSuperAdmin\(\)/, path);
      assert.doesNotMatch(src, /store_manage_orders/, path);
    }
  });

  it("navigation shows orders and leads by read or manage, and hides analytics from staff", () => {
    const nav = read("components/admin/adminNav.ts");
    assert.match(nav, /href: "\/admin\/notes", label: "Notes orders"[\s\S]*anyPerm: \["store_view_orders", "store_manage_orders"\]/);
    assert.match(nav, /href: "\/admin\/notes\/leads"[\s\S]*anyPerm: \["store_view_orders", "store_manage_orders"\]/);
    assert.match(nav, /href: "\/admin\/notes\/analytics"[\s\S]*superOnly: true/);
    const shell = read("components/admin/AdminShell.tsx");
    assert.match(shell, /superOnly && !superUser/);
    const queue = read("components/notes/admin/OrderQueue.tsx");
    assert.match(queue, /showAnalytics &&/);
    assert.match(queue, /canManage=\{canManage\}/);
  });
});
