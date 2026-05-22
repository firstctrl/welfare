# RBAC & User Management Design

**Date:** 2026-05-22
**Status:** Approved

---

## Overview

Introduce four distinct roles — Welfare Officer, Welfare Manager, Welfare Director, Admin — each with a defined access matrix across system modules. Enforcement is split between the API (NestJS guard) and the frontend (hook-driven nav filtering and UI suppression). A static permission matrix in `packages/shared` serves as the single source of truth for both layers.

Scope also includes:
- User Management UI (list, create, assign role, reset password, activate/deactivate)
- AD/Local login toggle on the login page
- LDAP group restriction (`welfare_group`)

---

## Role & Permission Matrix

| Module | Officer | Manager | Director | Admin |
|---|---|---|---|---|
| Contributions | full | full | readonly | full |
| Staff | full | full | readonly | full |
| Loans | full | full | readonly | full |
| Reports | full | full | readonly | full |
| Settings | full | full | none | full |
| Audit Log | none | full | readonly | full |
| Email Log | none | full | readonly | full |
| User Management | none | full | none | full |

**Principles:**
- One role per user at all times
- Any role change is written to the audit trail (actor, target, before, after, timestamp)
- Read-only: view and export only — no create, edit, delete, or system actions
- Role assignment and password reset: `Admin` and `WelfareManager` only

---

## Section 1: Shared Package

### `UserRole` enum — expanded

```ts
// packages/shared/src/enums/user-role.enum.ts
export enum UserRole {
  WelfareOfficer  = 'WELFARE_OFFICER',
  WelfareManager  = 'WELFARE_MANAGER',
  WelfareDirector = 'WELFARE_DIRECTOR',
  Admin           = 'ADMIN',
}
```

Exported from `packages/shared/src/index.ts`. The `UserRole` enum moves from `apps/api/src/users/enums/user-role.enum.ts` to `packages/shared/src/enums/user-role.enum.ts`. All existing API imports (`auth/guards/roles.guard.ts`, `auth/decorators/roles.decorator.ts`, `users/schemas/user.schema.ts`, `users/users.service.ts`, `auth/strategies/jwt.strategy.ts`) are updated to import from `@welfare/shared`.

### `AppModule` enum — new

```ts
// packages/shared/src/enums/app-module.enum.ts
export enum AppModule {
  Contributions  = 'contributions',
  Staff          = 'staff',
  Loans          = 'loans',
  Reports        = 'reports',
  Settings       = 'settings',
  AuditLog       = 'audit_log',
  EmailLog       = 'email_log',
  UserManagement = 'user_management',
}
```

### `PERMISSIONS` constant — new

```ts
// packages/shared/src/constants/permissions.constants.ts
export type AccessLevel = 'full' | 'readonly' | 'none';
export type PermissionMatrix = Record<UserRole, Record<AppModule, AccessLevel>>;

export const PERMISSIONS: PermissionMatrix = {
  [UserRole.WelfareOfficer]: {
    [AppModule.Contributions]:  'full',
    [AppModule.Staff]:          'full',
    [AppModule.Loans]:          'full',
    [AppModule.Reports]:        'full',
    [AppModule.Settings]:       'full',
    [AppModule.AuditLog]:       'none',
    [AppModule.EmailLog]:       'none',
    [AppModule.UserManagement]: 'none',
  },
  [UserRole.WelfareManager]: {
    [AppModule.Contributions]:  'full',
    [AppModule.Staff]:          'full',
    [AppModule.Loans]:          'full',
    [AppModule.Reports]:        'full',
    [AppModule.Settings]:       'full',
    [AppModule.AuditLog]:       'full',
    [AppModule.EmailLog]:       'full',
    [AppModule.UserManagement]: 'full',
  },
  [UserRole.WelfareDirector]: {
    [AppModule.Contributions]:  'readonly',
    [AppModule.Staff]:          'readonly',
    [AppModule.Loans]:          'readonly',
    [AppModule.Reports]:        'readonly',
    [AppModule.Settings]:       'none',
    [AppModule.AuditLog]:       'readonly',
    [AppModule.EmailLog]:       'readonly',
    [AppModule.UserManagement]: 'none',
  },
  [UserRole.Admin]: {
    [AppModule.Contributions]:  'full',
    [AppModule.Staff]:          'full',
    [AppModule.Loans]:          'full',
    [AppModule.Reports]:        'full',
    [AppModule.Settings]:       'full',
    [AppModule.AuditLog]:       'full',
    [AppModule.EmailLog]:       'full',
    [AppModule.UserManagement]: 'full',
  },
};
```

Both `AppModule` and `PERMISSIONS` are exported from `packages/shared/src/index.ts`.

---

## Section 2: API Layer

### `User` schema changes

- `role` field enum updated to include all four `UserRole` values
- `default` remains `UserRole.WelfareOfficer`
- `seedAdminIfEmpty` seeds with `UserRole.Admin`

### `@RequirePermission` decorator — new

```ts
// apps/api/src/auth/decorators/require-permission.decorator.ts
export const PERMISSION_KEY = 'permission';
export const RequirePermission = (module: AppModule, level: AccessLevel) =>
  SetMetadata(PERMISSION_KEY, { module, level });
```

### `PermissionsGuard` — new

```ts
// apps/api/src/auth/guards/permissions.guard.ts
```

Registered globally in `AppModule` alongside `JwtAuthGuard`. Logic:

1. Read `{ module, level }` from metadata. If absent, pass through.
2. Read `user.role` from request (set by `JwtStrategy.validate`).
3. Look up `PERMISSIONS[role][module]`.
4. If required `'full'` → allow only `'full'`. If required `'readonly'` → allow `'full'` or `'readonly'`. Otherwise 403.

`RolesGuard` is retained for endpoints that require an exact role check independent of the module matrix (e.g. role assignment restricted to `Admin` + `WelfareManager`).

### Existing controller annotations

Every existing controller receives `@RequirePermission` on its handlers:

| Controller | GET handlers | POST/PATCH/DELETE handlers |
|---|---|---|
| ContributionsController | `(Contributions, 'readonly')` | `(Contributions, 'full')` |
| StaffController | `(Staff, 'readonly')` | `(Staff, 'full')` |
| LoansController | `(Loans, 'readonly')` | `(Loans, 'full')` |
| ReportsController | `(Reports, 'readonly')` | `(Reports, 'full')` |
| SystemConfigController | `(Settings, 'readonly')` | `(Settings, 'full')` |
| AuditController | `(AuditLog, 'readonly')` | N/A |
| EmailLogController | `(EmailLog, 'readonly')` | N/A |

### New `/users` endpoints

| Method | Path | Guard | Notes |
|---|---|---|---|
| `GET` | `/users` | `RequirePermission(UserManagement, 'readonly')` | |
| `GET` | `/users/:id` | `RequirePermission(UserManagement, 'readonly')` | |
| `POST` | `/users` | `RequirePermission(UserManagement, 'full')` | Local accounts only |
| `PATCH` | `/users/:id` | `RequirePermission(UserManagement, 'full')` | displayName, email, isActive |
| `PATCH` | `/users/:id/role` | `Roles(Admin, WelfareManager)` | Audit logged |
| `POST` | `/users/:id/reset-password` | `Roles(Admin, WelfareManager)` | Local accounts only; returns 400 if `user.source === 'ldap'` |

`PATCH /users/:id/role` and `POST /users/:id/reset-password` are protected by `@Roles(Admin, WelfareManager)` — not the permission matrix — so they can't be unlocked by any permission escalation.

Role changes write an audit entry: `AuditAction.Update`, `AuditEntity.User`, `before: { role: oldRole }`, `after: { role: newRole }`.

### LDAP group enforcement

`LdapStrategy` is updated:

- `searchAttributes` gains `'memberOf'`
- `validate()` checks that the returned `memberOf` array contains the configured group. Group DN is read from `ldap.requiredGroup` env var (e.g. `CN=welfare_group,OU=Groups,DC=example,DC=com`). If the env var is unset, group check is skipped (safe default for dev environments).
- If group check fails, throws `UnauthorizedException('Not a member of the required group')`.

---

## Section 3: Frontend

### `usePermission` hook — new

```ts
// apps/web/src/hooks/use-permission.ts
function usePermission(module: AppModule): AccessLevel
```

Reads `user.role` from `useAuthStore`. Returns `PERMISSIONS[role][module]`, or `'none'` if user is null.

### Sidebar filtering

`NavItem` interface gains `module?: AppModule`. Sidebar renders only items where `usePermission(item.module) !== 'none'`. Dashboard item omits `module` (always visible).

New nav item added:

```ts
{ href: '/users', label: 'Users', icon: UserCog, module: AppModule.UserManagement, matchPrefix: true }
```

### Write-action suppression pattern

Pages with write actions conditionally render based on permission:

```tsx
const permission = usePermission(AppModule.Staff);
// ...
{permission === 'full' && <Button>Add Staff</Button>}
```

Applied to: all create buttons, edit/delete row actions, loan approval actions, email send triggers, settings save buttons, import actions.

### Login page — AD/Local toggle

`LoginPage` gains a controlled `mode: 'ad' | 'local'` state, defaulting to `'ad'`. Toggle renders as two pill buttons above the form. Mode determines which API route is called:

- `ad` → `POST /api/auth/login/ldap`
- `local` → `POST /api/auth/login`

Both modes use identical username/password fields. No persistence of the toggle state.

### User Management page

**Route:** `app/(dashboard)/users/page.tsx` + `users-list-client.tsx`

**Table columns:** Display Name, Username, Email, Role (badge), Status (Active/Inactive chip), Last Login, Actions

**Role badge colours:**
- Officer → grey (`neutral`)
- Manager → blue (`primary`)
- Director → purple
- Admin → red (`danger`)

**Row actions (conditional):**
- Edit role → modal with role dropdown; visible if `Roles(Admin, WelfareManager)` check passes on frontend (derived from `user.role` in auth store)
- Reset password → modal; visible to Manager + Admin
- Activate / Deactivate → visible if `permission === 'full'`

**Create User modal** (full permission only):
Fields: Username, Display Name, Email (optional), Password, Confirm Password, Role.
Role dropdown: Officer always available; Manager/Director/Admin options only rendered if `user.role === Admin`.

---

## Section 4: Audit Trail

All user management writes are audit-logged:

| Action | Entity | Before | After |
|---|---|---|---|
| Create user | `User` | — | `{ username, role, source }` |
| Update user | `User` | `{ displayName?, email?, isActive? }` | changed fields |
| Role change | `User` | `{ role: oldRole }` | `{ role: newRole }` |
| Password reset | `User` | — | `{ passwordReset: true }` |
| Deactivate | `User` | `{ isActive: true }` | `{ isActive: false }` |

Uses existing `AuditService.log()`. Requires adding `User = 'User'` to the `AuditEntity` enum in `packages/shared`.

---

## Environment Variables

| Var | Purpose | Default |
|---|---|---|
| `LDAP_REQUIRED_GROUP` | Full DN of welfare_group in AD | unset (skip check in dev) |

Existing LDAP vars (`LDAP_URL`, `LDAP_BIND_DN`, etc.) unchanged.
