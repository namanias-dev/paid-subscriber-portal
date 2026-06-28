# Staff & Roles (Admin Logins)

**Menu:** `People` → `Staff & Roles`  ·  **Web address:** `/admin/staff`
**Who can open it:** staff whose role has **Manage staff accounts**. Creating/editing **roles** additionally needs **Manage roles & permissions** (Super Admin).

Heading: `Staff & Roles`, subtitle `Create admin logins, assign roles and control exactly what each person can access`. Two tabs: `Staff` and `Roles & permissions`.

## Staff tab

Filters: `Search name / username / email`, `All roles`, `All status`. Buttons: `Bulk enroll`, `+ Add Staff`. Table: `Name`, `Username`, `Role`, `Status`, `Access`, `Last login`, `Actions` (`Grant access`, `Manage`).

### Create a staff login
1. Click **`+ Add Staff`** (`Add staff member`).
2. Fill `Full name`, optional `Email`, optional `Portal test login phone`. `Username` is auto-generated (`Regenerate` to change). Pick a `Role`. Choose `Auto-generate password` or `Set manually` (min 8 chars). Keep `Require password change on first login` ticked.
3. Click **`Create staff login`**.
4. The `Share these credentials now` window shows the `Username` and `Temporary password` **once** — `Copy` and share them securely, then `Done`.

### Manage an existing staff member
Click **`Manage`** (`Manage {name}`). You can change `Role` and `Status` (`Active` / `Disabled`), set up a `Student-portal test login` (with `Regenerate code`), `Save changes`, `Reset password` (`Generate a new temporary password for this user?`), or `Remove`. ⚠️ Disabling a staff member blocks their login immediately; removing deletes the account.

## Roles & permissions tab

Each role card shows what it `Can do` / `Cannot do` and a `View permission matrix`. With **Manage roles** you can `+ New role`, `Edit`, or `Delete` a custom role (the `Super Admin` role cannot be edited). The editor lets you tick permissions by group and shows a `Live preview`.

> Without the Manage-roles permission you'll see: `You can view roles but need the "Manage roles & permissions" permission to create or edit them.`

See the **Roles & Permissions** guide for the full who-can-do-what table.

## Granting staff comp access (for testing)
The `Grant access` action (and `Bulk enroll`) gives staff complimentary course/webinar access for QA/testing. This is separate from real student enrollments and is excluded from revenue and seat counts.
