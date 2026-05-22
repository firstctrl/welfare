# RBAC & User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce four roles (WelfareOfficer, WelfareManager, WelfareDirector, Admin) with a static permission matrix enforced on the API and frontend, plus a full User Management UI and LDAP group restriction.

**Architecture:** A `PERMISSIONS` constant in `packages/shared` maps each role to per-module access levels (`full | readonly | none`). The API enforces this via a new `PermissionsGuard` + `@RequirePermission` decorator registered globally; the frontend reads the same constant via a `usePermission` hook to filter the sidebar and hide write actions.

**Tech Stack:** NestJS 10 (Jest for tests), Next.js 15 App Router (no web tests yet), Mongoose, Zustand auth store, `@welfare/shared` shared package.

---

## File Map

### packages/shared
| Action | Path |
|---|---|
| Create | `packages/shared/src/enums/user-role.enum.ts` |
| Create | `packages/shared/src/enums/app-module.enum.ts` |
| Create | `packages/shared/src/constants/permissions.constants.ts` |
| Modify | `packages/shared/src/enums/audit-entity.enum.ts` |
| Modify | `packages/shared/src/index.ts` |

### apps/api
| Action | Path |
|---|---|
| Delete | `apps/api/src/users/enums/user-role.enum.ts` |
| Modify | `apps/api/src/users/schemas/user.schema.ts` |
| Modify | `apps/api/src/users/users.service.ts` |
| Create | `apps/api/src/users/users.service.spec.ts` |
| Modify | `apps/api/src/users/users.controller.ts` |
| Create | `apps/api/src/users/dto/update-role.dto.ts` |
| Create | `apps/api/src/users/dto/reset-password.dto.ts` |
| Modify | `apps/api/src/auth/decorators/roles.decorator.ts` |
| Modify | `apps/api/src/auth/guards/roles.guard.ts` |
| Create | `apps/api/src/auth/decorators/require-permission.decorator.ts` |
| Create | `apps/api/src/auth/guards/permissions.guard.ts` |
| Create | `apps/api/src/auth/guards/permissions.guard.spec.ts` |
| Modify | `apps/api/src/auth/strategies/ldap.strategy.ts` |
| Create | `apps/api/src/auth/strategies/ldap.strategy.spec.ts` |
| Modify | `apps/api/src/config/configuration.ts` |
| Modify | `apps/api/src/app.module.ts` |
| Modify | `apps/api/src/contributions/contributions.controller.ts` |
| Modify | `apps/api/src/staff/staff.controller.ts` |
| Modify | `apps/api/src/loans/loans.controller.ts` |
| Modify | `apps/api/src/reports/reports.controller.ts` |
| Modify | `apps/api/src/system-config/system-config.controller.ts` |
| Modify | `apps/api/src/audit/audit.controller.ts` |
| Modify | `apps/api/src/email/email.controller.ts` |

### apps/web
| Action | Path |
|---|---|
| Create | `apps/web/src/hooks/use-permission.ts` |
| Modify | `apps/web/src/components/nav/sidebar.tsx` |
| Modify | `apps/web/src/app/(auth)/login/page.tsx` |
| Modify | `apps/web/src/lib/auth.ts` |
| Create | `apps/web/src/lib/users.ts` |
| Create | `apps/web/src/app/(dashboard)/users/page.tsx` |
| Create | `apps/web/src/app/(dashboard)/users/users-list-client.tsx` |
| Modify | `apps/web/src/app/(dashboard)/staff/staff-list-client.tsx` |
| Modify | `apps/web/src/app/(dashboard)/contributions/contributions-list-client.tsx` |
| Modify | `apps/web/src/app/(dashboard)/loans/loans-list-client.tsx` |
| Modify | `apps/web/src/app/(dashboard)/reports/reports-client.tsx` |
| Modify | `apps/web/src/app/(dashboard)/settings/settings-client.tsx` |

---

## Task 1: Shared package — enums, permissions matrix, AuditEntity.User

**Files:**
- Create: `packages/shared/src/enums/user-role.enum.ts`
- Create: `packages/shared/src/enums/app-module.enum.ts`
- Create: `packages/shared/src/constants/permissions.constants.ts`
- Modify: `packages/shared/src/enums/audit-entity.enum.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `packages/shared/src/enums/user-role.enum.ts`**

```ts
export enum UserRole {
  WelfareOfficer  = 'WELFARE_OFFICER',
  WelfareManager  = 'WELFARE_MANAGER',
  WelfareDirector = 'WELFARE_DIRECTOR',
  Admin           = 'ADMIN',
}
```

- [ ] **Step 2: Create `packages/shared/src/enums/app-module.enum.ts`**

```ts
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

- [ ] **Step 3: Create `packages/shared/src/constants/permissions.constants.ts`**

```ts
import { UserRole } from '../enums/user-role.enum';
import { AppModule } from '../enums/app-module.enum';

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

- [ ] **Step 4: Add `User` to `packages/shared/src/enums/audit-entity.enum.ts`**

Add one line to the existing enum:

```ts
  User = 'User',
```

Final file:
```ts
export enum AuditEntity {
  Staff = 'Staff',
  Contribution = 'Contribution',
  Loan = 'Loan',
  LoanRepayment = 'LoanRepayment',
  ImportBatch = 'ImportBatch',
  Config = 'Config',
  EmailLog = 'EmailLog',
  User = 'User',
}
```

- [ ] **Step 5: Update `packages/shared/src/index.ts` — add new exports**

Add these lines after the existing enum exports:

```ts
export { UserRole } from './enums/user-role.enum';
export { AppModule } from './enums/app-module.enum';
export type { AccessLevel, PermissionMatrix } from './constants/permissions.constants';
export { PERMISSIONS } from './constants/permissions.constants';
```

- [ ] **Step 6: Build shared package to verify no type errors**

Run from repo root:
```bash
cd packages/shared && npx tsc --noEmit
```
Expected: no output (clean).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/enums/user-role.enum.ts \
        packages/shared/src/enums/app-module.enum.ts \
        packages/shared/src/constants/permissions.constants.ts \
        packages/shared/src/enums/audit-entity.enum.ts \
        packages/shared/src/index.ts
git commit -m "feat(shared): add UserRole, AppModule enums and PERMISSIONS matrix"
```

---

## Task 2: API — migrate UserRole import to shared, update User schema + seed

**Files:**
- Delete: `apps/api/src/users/enums/user-role.enum.ts`
- Modify: `apps/api/src/users/schemas/user.schema.ts`
- Modify: `apps/api/src/users/users.service.ts`
- Modify: `apps/api/src/auth/decorators/roles.decorator.ts`
- Modify: `apps/api/src/auth/guards/roles.guard.ts`
- Modify: `apps/api/src/auth/strategies/jwt.strategy.ts`

- [ ] **Step 1: Delete the old enum file**

```bash
rm apps/api/src/users/enums/user-role.enum.ts
```

Also remove the `enums/` directory if now empty:
```bash
rmdir apps/api/src/users/enums 2>/dev/null || true
```

- [ ] **Step 2: Update `apps/api/src/users/schemas/user.schema.ts`**

Replace `import { UserRole } from '../enums/user-role.enum';` with `import { UserRole } from '@welfare/shared';`.

Full updated file:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { UserRole } from '@welfare/shared';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, index: true })
  username!: string;

  @Prop({ required: true })
  displayName!: string;

  @Prop({ sparse: true, unique: true })
  email?: string;

  @Prop({ required: true, enum: Object.values(UserRole), default: UserRole.WelfareOfficer })
  role!: UserRole;

  @Prop({ required: true, enum: ['ldap', 'local'] })
  source!: 'ldap' | 'local';

  @Prop({ select: false })
  passwordHash?: string;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop()
  lastLogin?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
```

- [ ] **Step 3: Update `apps/api/src/users/users.service.ts`**

Replace `import { UserRole } from './enums/user-role.enum';` with `import { UserRole } from '@welfare/shared';`.

Also fix `seedAdminIfEmpty` — change `role: UserRole.WelfareOfficer` to `role: UserRole.Admin` in the `createLocal` call inside that method:

```ts
async seedAdminIfEmpty(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_PASSWORD) {
    this.logger.warn('SEED_ADMIN_PASSWORD not set — skipping admin seed in production');
    return;
  }
  const count = await this.userModel.countDocuments().exec();
  if (count === 0) {
    const password = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';
    const passwordHash = await bcrypt.hash(password, 12);
    const user = new this.userModel({
      username: 'admin',
      displayName: 'System Administrator',
      role: UserRole.Admin,
      source: 'local',
      passwordHash,
      isActive: true,
    });
    await user.save();
    this.logger.log('Default admin account seeded. Change password before production use.');
  }
}
```

Note: call `this.userModel` directly instead of `this.createLocal` so the role can be `Admin` (createLocal hardcodes `WelfareOfficer`).

- [ ] **Step 4: Update `apps/api/src/auth/decorators/roles.decorator.ts`**

```ts
import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@welfare/shared';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```

- [ ] **Step 5: Update `apps/api/src/auth/guards/roles.guard.ts`**

```ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '@welfare/shared';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;
    const { user } = context.switchToHttp().getRequest<{ user: { role: string } }>();
    return requiredRoles.some((role) => user?.role === role);
  }
}
```

- [ ] **Step 6: Run API tests to verify nothing is broken**

```bash
cd apps/api && npx jest --no-coverage
```

Expected: all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/users/schemas/user.schema.ts \
        apps/api/src/users/users.service.ts \
        apps/api/src/auth/decorators/roles.decorator.ts \
        apps/api/src/auth/guards/roles.guard.ts
git commit -m "feat(api): migrate UserRole import to @welfare/shared, seed Admin role"
```

---

## Task 3: API — PermissionsGuard + @RequirePermission decorator

**Files:**
- Create: `apps/api/src/auth/decorators/require-permission.decorator.ts`
- Create: `apps/api/src/auth/guards/permissions.guard.ts`
- Create: `apps/api/src/auth/guards/permissions.guard.spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write failing test for PermissionsGuard**

Create `apps/api/src/auth/guards/permissions.guard.spec.ts`:

```ts
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { UserRole, AppModule } from '@welfare/shared';

function makeContext(role: UserRole, module: AppModule, level: 'full' | 'readonly'): ExecutionContext {
  const mockReflector = { getAllAndOverride: jest.fn().mockReturnValue({ module, level }) } as unknown as Reflector;
  const guard = new PermissionsGuard(mockReflector);
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let reflector: jest.Mocked<Reflector>;
  let guard: PermissionsGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as jest.Mocked<Reflector>;
    guard = new PermissionsGuard(reflector);
  });

  it('passes when no metadata set', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.WelfareOfficer } }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows WelfareOfficer full access to Contributions', () => {
    reflector.getAllAndOverride.mockReturnValue({ module: AppModule.Contributions, level: 'full' });
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.WelfareOfficer } }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('blocks WelfareOfficer from AuditLog readonly', () => {
    reflector.getAllAndOverride.mockReturnValue({ module: AppModule.AuditLog, level: 'readonly' });
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.WelfareOfficer } }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('allows WelfareDirector readonly on Contributions but blocks full', () => {
    reflector.getAllAndOverride.mockReturnValue({ module: AppModule.Contributions, level: 'readonly' });
    const ctxRead = {
      switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.WelfareDirector } }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctxRead)).toBe(true);

    reflector.getAllAndOverride.mockReturnValue({ module: AppModule.Contributions, level: 'full' });
    const ctxFull = {
      switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.WelfareDirector } }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctxFull)).toBe(false);
  });

  it('blocks request when user is missing', () => {
    reflector.getAllAndOverride.mockReturnValue({ module: AppModule.Staff, level: 'readonly' });
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: null }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest permissions.guard.spec --no-coverage
```

Expected: FAIL — `Cannot find module './permissions.guard'`.

- [ ] **Step 3: Create `apps/api/src/auth/decorators/require-permission.decorator.ts`**

```ts
import { SetMetadata } from '@nestjs/common';
import { AppModule, AccessLevel } from '@welfare/shared';

export const PERMISSION_KEY = 'permission';
export const RequirePermission = (module: AppModule, level: AccessLevel) =>
  SetMetadata(PERMISSION_KEY, { module, level });
```

- [ ] **Step 4: Create `apps/api/src/auth/guards/permissions.guard.ts`**

```ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PERMISSIONS, AppModule, AccessLevel, UserRole } from '@welfare/shared';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = this.reflector.getAllAndOverride<{ module: AppModule; level: AccessLevel }>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) return true;

    const { user } = context.switchToHttp().getRequest<{ user: { role: UserRole } | null }>();
    if (!user?.role) return false;

    const granted = PERMISSIONS[user.role]?.[meta.module];
    if (meta.level === 'readonly') return granted === 'full' || granted === 'readonly';
    return granted === 'full';
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/api && npx jest permissions.guard.spec --no-coverage
```

Expected: all 5 tests pass.

- [ ] **Step 6: Register PermissionsGuard globally in `apps/api/src/app.module.ts`**

Find the providers array where `APP_GUARD` is registered. Add `PermissionsGuard` after `RolesGuard`:

```ts
import { PermissionsGuard } from './auth/guards/permissions.guard';

// In providers array, after the RolesGuard entry:
{ provide: APP_GUARD, useClass: PermissionsGuard },
```

- [ ] **Step 7: Run all API tests**

```bash
cd apps/api && npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/auth/decorators/require-permission.decorator.ts \
        apps/api/src/auth/guards/permissions.guard.ts \
        apps/api/src/auth/guards/permissions.guard.spec.ts \
        apps/api/src/app.module.ts
git commit -m "feat(api): add PermissionsGuard and RequirePermission decorator"
```

---

## Task 4: API — UsersService: updateRole + resetPassword methods

**Files:**
- Modify: `apps/api/src/users/users.service.ts`
- Create: `apps/api/src/users/users.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/users/users.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';
import { UserRole } from '@welfare/shared';
import * as bcrypt from 'bcrypt';

const mockUser = (overrides = {}) => ({
  _id: { toString: () => 'user-id-1' },
  username: 'jdoe',
  displayName: 'John Doe',
  role: UserRole.WelfareOfficer,
  source: 'local',
  isActive: true,
  passwordHash: 'hashed',
  save: jest.fn().mockResolvedValue(undefined),
  toObject: jest.fn(function () { return { ...this }; }),
  ...overrides,
});

const mockUserModel = {
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findOne: jest.fn(),
  countDocuments: jest.fn(),
  create: jest.fn(),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  describe('updateRole', () => {
    it('updates role and returns updated user', async () => {
      const updated = mockUser({ role: UserRole.WelfareManager });
      mockUserModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(updated) });
      const result = await service.updateRole('user-id-1', UserRole.WelfareManager);
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'user-id-1',
        { $set: { role: UserRole.WelfareManager } },
        { new: true },
      );
      expect(result.role).toBe(UserRole.WelfareManager);
    });

    it('throws NotFoundException when user not found', async () => {
      mockUserModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.updateRole('bad-id', UserRole.Admin)).rejects.toThrow(NotFoundException);
    });
  });

  describe('resetPassword', () => {
    it('hashes and saves new password for local user', async () => {
      const user = mockUser({ source: 'local' });
      mockUserModel.findById.mockReturnValue({ select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(user) }) });
      await service.resetPassword('user-id-1', 'NewPass@123');
      expect(user.save).toHaveBeenCalled();
      expect(typeof user.passwordHash).toBe('string');
      const valid = await bcrypt.compare('NewPass@123', user.passwordHash as string);
      expect(valid).toBe(true);
    });

    it('throws BadRequestException for LDAP user', async () => {
      const ldapUser = mockUser({ source: 'ldap' });
      mockUserModel.findById.mockReturnValue({ select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(ldapUser) }) });
      await expect(service.resetPassword('user-id-1', 'NewPass@123')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when user not found', async () => {
      mockUserModel.findById.mockReturnValue({ select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) });
      await expect(service.resetPassword('bad-id', 'NewPass@123')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx jest users.service.spec --no-coverage
```

Expected: FAIL — `updateRole is not a function` (or similar).

- [ ] **Step 3: Add `updateRole` and `resetPassword` to `apps/api/src/users/users.service.ts`**

Add these two methods to the `UsersService` class (after the existing `updateUser` method):

```ts
async updateRole(id: string, role: UserRole): Promise<UserDocument> {
  const user = await this.userModel
    .findByIdAndUpdate(id, { $set: { role } }, { new: true })
    .exec();
  if (!user) throw new NotFoundException('User not found');
  return user;
}

async resetPassword(id: string, newPassword: string): Promise<void> {
  const user = await this.userModel.findById(id).select('+passwordHash').exec();
  if (!user) throw new NotFoundException('User not found');
  if (user.source === 'ldap') {
    throw new BadRequestException('Cannot reset password for an Active Directory account');
  }
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();
}
```

Also add `BadRequestException` to the imports from `@nestjs/common` if not already present.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx jest users.service.spec --no-coverage
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/users/users.service.ts \
        apps/api/src/users/users.service.spec.ts
git commit -m "feat(api): add updateRole and resetPassword to UsersService"
```

---

## Task 5: API — UsersController new endpoints

**Files:**
- Modify: `apps/api/src/users/users.controller.ts`
- Create: `apps/api/src/users/dto/update-role.dto.ts`
- Create: `apps/api/src/users/dto/reset-password.dto.ts`

- [ ] **Step 1: Create `apps/api/src/users/dto/update-role.dto.ts`**

```ts
import { IsEnum } from 'class-validator';
import { UserRole } from '@welfare/shared';

export class UpdateRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}
```

- [ ] **Step 2: Create `apps/api/src/users/dto/reset-password.dto.ts`**

```ts
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(8)
  password!: string;
}
```

- [ ] **Step 3: Rewrite `apps/api/src/users/users.controller.ts`**

```ts
import { Controller, Get, Post, Patch, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { AppModule, UserRole, AuditAction, AuditEntity } from '@welfare/shared';
import { UserDocument } from './schemas/user.schema';
import { Request } from 'express';
import { Req } from '@nestjs/common';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission(AppModule.UserManagement, 'readonly')
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @RequirePermission(AppModule.UserManagement, 'readonly')
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @RequirePermission(AppModule.UserManagement, 'full')
  create(@Body() body: { username: string; displayName: string; email?: string; password: string }) {
    return this.usersService.createLocal(body);
  }

  @Patch(':id')
  @RequirePermission(AppModule.UserManagement, 'full')
  update(
    @Param('id') id: string,
    @Body() body: { displayName?: string; email?: string; isActive?: boolean },
  ) {
    return this.usersService.updateUser(id, body);
  }

  @Patch(':id/role')
  @Roles(UserRole.Admin, UserRole.WelfareManager)
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() actor: UserDocument,
    @Req() req: Request,
  ) {
    const target = await this.usersService.findById(id);
    const oldRole = target?.role;
    const updated = await this.usersService.updateRole(id, dto.role);
    await this.auditService.log(
      actor._id.toString(),
      actor.displayName,
      AuditAction.Update,
      AuditEntity.User,
      id,
      { role: oldRole },
      { role: dto.role },
      req.ip,
    );
    return updated;
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.Admin, UserRole.WelfareManager)
  async resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() actor: UserDocument,
    @Req() req: Request,
  ) {
    await this.usersService.resetPassword(id, dto.password);
    await this.auditService.log(
      actor._id.toString(),
      actor.displayName,
      AuditAction.Update,
      AuditEntity.User,
      id,
      undefined,
      { passwordReset: true },
      req.ip,
    );
  }
}
```

- [ ] **Step 4: Register `AuditService` in `UsersModule`**

Open `apps/api/src/users/users.module.ts`. Import `AuditModule` and add it to `imports`. Also ensure `AuditService` is accessible.

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, UserSchema } from './schemas/user.schema';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    AuditModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 5: Verify `AuditModule` exports `AuditService`**

Open `apps/api/src/audit/audit.module.ts`. Confirm `AuditService` is in the `exports` array. If not, add it.

- [ ] **Step 6: Run API tests**

```bash
cd apps/api && npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/users/users.controller.ts \
        apps/api/src/users/users.module.ts \
        apps/api/src/users/dto/update-role.dto.ts \
        apps/api/src/users/dto/reset-password.dto.ts
git commit -m "feat(api): add role assignment, password reset, and user CRUD endpoints"
```

---

## Task 6: API — LDAP group enforcement

**Files:**
- Modify: `apps/api/src/auth/strategies/ldap.strategy.ts`
- Modify: `apps/api/src/config/configuration.ts`
- Create: `apps/api/src/auth/strategies/ldap.strategy.spec.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/src/auth/strategies/ldap.strategy.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { LdapStrategy } from './ldap.strategy';

function makeStrategy(requiredGroup: string | undefined) {
  const config = {
    get: (key: string) => {
      if (key === 'ldap.requiredGroup') return requiredGroup;
      return '';
    },
  } as unknown as ConfigService;
  // Bypass super() constructor by calling validate directly
  return new (class extends LdapStrategy {
    constructor() {
      super(config);
    }
  })();
}

describe('LdapStrategy.validate', () => {
  it('passes when requiredGroup is not configured', async () => {
    const strategy = makeStrategy(undefined);
    const result = await strategy.validate({
      sAMAccountName: 'jdoe',
      displayName: 'John Doe',
      mail: 'jdoe@example.com',
      memberOf: [],
    });
    expect(result.username).toBe('jdoe');
  });

  it('passes when user is a member of the required group', async () => {
    const strategy = makeStrategy('CN=welfare_group,OU=Groups,DC=example,DC=com');
    const result = await strategy.validate({
      sAMAccountName: 'jdoe',
      displayName: 'John Doe',
      memberOf: ['CN=welfare_group,OU=Groups,DC=example,DC=com', 'CN=other,DC=example,DC=com'],
    });
    expect(result.username).toBe('jdoe');
  });

  it('throws UnauthorizedException when user is not a member', async () => {
    const strategy = makeStrategy('CN=welfare_group,OU=Groups,DC=example,DC=com');
    await expect(
      strategy.validate({
        sAMAccountName: 'jdoe',
        displayName: 'John Doe',
        memberOf: ['CN=other_group,DC=example,DC=com'],
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when memberOf is absent and group is required', async () => {
    const strategy = makeStrategy('CN=welfare_group,OU=Groups,DC=example,DC=com');
    await expect(
      strategy.validate({ sAMAccountName: 'jdoe', displayName: 'John Doe' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest ldap.strategy.spec --no-coverage
```

Expected: FAIL — validate does not check group membership.

- [ ] **Step 3: Add `ldap.requiredGroup` to `apps/api/src/config/configuration.ts`**

In the `ldap` object, add:
```ts
requiredGroup: process.env.LDAP_REQUIRED_GROUP || '',
```

Final `ldap` block:
```ts
ldap: {
  url: process.env.LDAP_URL || '',
  bindDn: process.env.LDAP_BIND_DN || '',
  bindCredentials: process.env.LDAP_BIND_CREDENTIALS || '',
  searchBase: process.env.LDAP_SEARCH_BASE || '',
  requiredGroup: process.env.LDAP_REQUIRED_GROUP || '',
},
```

- [ ] **Step 4: Update `apps/api/src/auth/strategies/ldap.strategy.ts`**

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import Strategy from 'passport-ldapauth';
import { ConfigService } from '@nestjs/config';
import { IncomingMessage } from 'http';

interface RequestWithBody extends IncomingMessage {
  body: { username: string; password: string };
}

interface LdapUser {
  sAMAccountName: string;
  displayName: string;
  mail?: string;
  memberOf?: string | string[];
}

@Injectable()
export class LdapStrategy extends PassportStrategy(Strategy, 'ldapauth') {
  private readonly requiredGroup: string;

  constructor(private readonly config: ConfigService) {
    super({
      server: {
        url: config.get<string>('ldap.url') || 'ldap://localhost:389',
        bindDN: config.get<string>('ldap.bindDn') || '',
        bindCredentials: config.get<string>('ldap.bindCredentials') || '',
        searchBase: config.get<string>('ldap.searchBase') || '',
        searchFilter: '(sAMAccountName={{username}})',
        searchAttributes: ['displayName', 'mail', 'sAMAccountName', 'memberOf'],
      },
      credentialsLookup: (req: IncomingMessage) => {
        const r = req as RequestWithBody;
        return { username: r.body.username, password: r.body.password };
      },
    });
    this.requiredGroup = config.get<string>('ldap.requiredGroup') || '';
  }

  async validate(user: LdapUser) {
    if (this.requiredGroup) {
      const groups: string[] = Array.isArray(user.memberOf)
        ? user.memberOf
        : user.memberOf
        ? [user.memberOf]
        : [];
      if (!groups.includes(this.requiredGroup)) {
        throw new UnauthorizedException('Not a member of the required group');
      }
    }
    return {
      username: user.sAMAccountName,
      displayName: user.displayName,
      email: user.mail,
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/api && npx jest ldap.strategy.spec --no-coverage
```

Expected: all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/strategies/ldap.strategy.ts \
        apps/api/src/auth/strategies/ldap.strategy.spec.ts \
        apps/api/src/config/configuration.ts
git commit -m "feat(api): enforce LDAP welfare_group membership on AD login"
```

---

## Task 7: API — annotate existing controllers with @RequirePermission

**Files:**
- Modify: `apps/api/src/contributions/contributions.controller.ts`
- Modify: `apps/api/src/staff/staff.controller.ts`
- Modify: `apps/api/src/loans/loans.controller.ts`
- Modify: `apps/api/src/reports/reports.controller.ts`
- Modify: `apps/api/src/system-config/system-config.controller.ts`
- Modify: `apps/api/src/audit/audit.controller.ts`
- Modify: `apps/api/src/email/email.controller.ts`

For each controller, add `@RequirePermission` at the **class level** where all methods share the same module. Use handler-level overrides only where needed (e.g. Reports has both readonly GET and full POST endpoints).

- [ ] **Step 1: Annotate `ContributionsController`**

Add to imports:
```ts
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { AppModule } from '@welfare/shared';
```

Add class-level decorator (all GET = readonly, POST/PATCH/DELETE = full — but class-level `full` would block Director on reads). Use method-level decorators instead.

Add `@RequirePermission(AppModule.Contributions, 'readonly')` to every `@Get` handler.
Add `@RequirePermission(AppModule.Contributions, 'full')` to every `@Post`, `@Patch`, `@Delete` handler.

- [ ] **Step 2: Annotate `StaffController`**

Same pattern as Contributions.

Add `@RequirePermission(AppModule.Staff, 'readonly')` to every `@Get` handler.
Add `@RequirePermission(AppModule.Staff, 'full')` to every `@Post`, `@Patch` handler.

- [ ] **Step 3: Annotate `LoansController`**

Add `@RequirePermission(AppModule.Loans, 'readonly')` to every `@Get` handler.
Add `@RequirePermission(AppModule.Loans, 'full')` to every `@Post`, `@Patch`, `@Delete` handler.

- [ ] **Step 4: Annotate `ReportsController`**

GET endpoints → `@RequirePermission(AppModule.Reports, 'readonly')`.

POST endpoints that trigger actions (send emails, bulk operations):
- `POST /reports/contributions/staff-statement/send` → `@RequirePermission(AppModule.Reports, 'full')`
- `POST /reports/contributions/bulk-send` → `@RequirePermission(AppModule.Reports, 'full')`
- `GET /reports/contributions/staff-statement/pdf` → `@RequirePermission(AppModule.Reports, 'readonly')`
- `GET /reports/contributions/bulk-send/status` → `@RequirePermission(AppModule.Reports, 'readonly')`

- [ ] **Step 5: Annotate `SystemConfigController`**

```ts
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { AppModule } from '@welfare/shared';
```

- `@Get()` → `@RequirePermission(AppModule.Settings, 'readonly')`
- `@Patch()` → `@RequirePermission(AppModule.Settings, 'full')`
- `@Post('test-email')` → `@RequirePermission(AppModule.Settings, 'full')`

Also remove the duplicate `@UseGuards(JwtAuthGuard)` from the class — JWT is already applied globally.

- [ ] **Step 6: Annotate `AuditController`**

```ts
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { AppModule } from '@welfare/shared';
```

- `@Get()` → `@RequirePermission(AppModule.AuditLog, 'readonly')`

- [ ] **Step 7: Annotate `EmailController`**

```ts
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { AppModule } from '@welfare/shared';
```

- `@Get('logs')` → `@RequirePermission(AppModule.EmailLog, 'readonly')`
- `@Post('contribution-statement/bulk')` → `@RequirePermission(AppModule.EmailLog, 'full')`
- `@Post('contribution-statement/:staffId')` → `@RequirePermission(AppModule.EmailLog, 'full')`
- `@Post('loan-schedule/:loanId')` → `@RequirePermission(AppModule.EmailLog, 'full')`

- [ ] **Step 8: Run all API tests**

```bash
cd apps/api && npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/contributions/contributions.controller.ts \
        apps/api/src/staff/staff.controller.ts \
        apps/api/src/loans/loans.controller.ts \
        apps/api/src/reports/reports.controller.ts \
        apps/api/src/system-config/system-config.controller.ts \
        apps/api/src/audit/audit.controller.ts \
        apps/api/src/email/email.controller.ts
git commit -m "feat(api): gate all module endpoints with RequirePermission"
```

---

## Task 8: Frontend — usePermission hook

**Files:**
- Create: `apps/web/src/hooks/use-permission.ts`

- [ ] **Step 1: Create `apps/web/src/hooks/use-permission.ts`**

```ts
import { useAuthStore } from '../store/auth.store';
import { PERMISSIONS, AppModule, AccessLevel, UserRole } from '@welfare/shared';

export function usePermission(module: AppModule): AccessLevel {
  const user = useAuthStore((s) => s.user);
  if (!user?.role) return 'none';
  const role = user.role as UserRole;
  return PERMISSIONS[role]?.[module] ?? 'none';
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/use-permission.ts
git commit -m "feat(web): add usePermission hook"
```

---

## Task 9: Frontend — sidebar filtering + Users nav item

**Files:**
- Modify: `apps/web/src/components/nav/sidebar.tsx`

- [ ] **Step 1: Rewrite `apps/web/src/components/nav/sidebar.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import {
  LayoutDashboard,
  Users,
  UserCog,
  Landmark,
  FileBarChart2,
  Settings,
  ScrollText,
  Mail,
  Coins,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePermission } from '../../hooks/use-permission';
import { AppModule } from '@welfare/shared';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  matchPrefix?: boolean;
  module?: AppModule;
}

const navItems: NavItem[] = [
  { href: '/',               label: 'Dashboard',     icon: LayoutDashboard },
  { href: '/staff',          label: 'Staff',         icon: Users,         matchPrefix: true, module: AppModule.Staff },
  { href: '/contributions',  label: 'Contributions', icon: Coins,         matchPrefix: true, module: AppModule.Contributions },
  { href: '/loans',          label: 'Loans',         icon: Landmark,      matchPrefix: true, module: AppModule.Loans },
  { href: '/reports',        label: 'Reports',       icon: FileBarChart2, matchPrefix: true, module: AppModule.Reports },
  { href: '/audit',          label: 'Audit Log',     icon: ScrollText,    module: AppModule.AuditLog },
  { href: '/email-log',      label: 'Email Log',     icon: Mail,          module: AppModule.EmailLog },
  { href: '/settings',       label: 'Settings',      icon: Settings,      module: AppModule.Settings },
  { href: '/users',          label: 'Users',         icon: UserCog,       matchPrefix: true, module: AppModule.UserManagement },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchPrefix) return pathname === item.href || pathname.startsWith(item.href + '/');
  return pathname === item.href;
}

function NavItemLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const permission = usePermission(item.module!);
  if (item.module && permission === 'none') return null;
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 px-3 rounded-sm text-base font-medium transition-colors duration-fast',
        'h-[var(--row-default)]',
        active
          ? 'bg-primary-50 text-primary-700'
          : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
      )}
    >
      <item.icon
        size={18}
        strokeWidth={1.75}
        className={active ? 'text-primary-600' : 'text-neutral-400'}
      />
      {item.label}
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside className="w-60 shrink-0 bg-white border-r border-neutral-200 flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-neutral-200">
        <div className="relative w-8 h-8 shrink-0">
          <Image src="/assets/ncc-logo.png" alt="NCC" fill className="object-contain" priority />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-neutral-900 leading-tight truncate">NACOC Welfare</p>
          <p className="text-xs text-neutral-400 leading-tight truncate">Management System</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) =>
          item.module ? (
            <NavItemLink key={item.href} item={item} />
          ) : (
            <DashboardLink key={item.href} item={item} />
          ),
        )}
      </nav>

      <div className="px-5 py-4 border-t border-neutral-200">
        <p className="text-xs text-neutral-400">
          &copy; {new Date().getFullYear()} Narcotics Control Commission
        </p>
      </div>
    </aside>
  );
}

function DashboardLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 px-3 rounded-sm text-base font-medium transition-colors duration-fast',
        'h-[var(--row-default)]',
        active
          ? 'bg-primary-50 text-primary-700'
          : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
      )}
    >
      <item.icon
        size={18}
        strokeWidth={1.75}
        className={active ? 'text-primary-600' : 'text-neutral-400'}
      />
      {item.label}
    </Link>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/nav/sidebar.tsx
git commit -m "feat(web): filter sidebar nav items by role permissions"
```

---

## Task 10: Frontend — Login page AD/Local toggle

**Files:**
- Modify: `apps/web/src/app/(auth)/login/page.tsx`
- Modify: `apps/web/src/lib/auth.ts`

- [ ] **Step 1: Update `apps/web/src/lib/auth.ts` — support auth mode**

Change the `login` function signature to accept a `mode` parameter:

```ts
import { useAuthStore } from '../store/auth.store';

interface LoginCredentials {
  username: string;
  password: string;
  mode?: 'ad' | 'local';
}

export async function login(credentials: LoginCredentials): Promise<void> {
  const endpoint = credentials.mode === 'local' ? '/api/auth/login' : '/api/auth/login/ldap';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: credentials.username, password: credentials.password }),
  });

  if (!res.ok) {
    const error = await res.json() as { message?: string };
    throw new Error(error.message || 'Login failed');
  }

  const data = await res.json() as { accessToken: string };
  useAuthStore.getState().setTokenAndUser(data.accessToken);
  const store = useAuthStore.getState();
  if (store.user?.id) localStorage.setItem('welfare_user_id', store.user.id);
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  useAuthStore.getState().clearAuth();
  localStorage.removeItem('welfare_user_id');
  localStorage.removeItem('welfare_auth_store');
}

export async function refreshAccessToken(): Promise<string | null> {
  const userId = localStorage.getItem('welfare_user_id');
  if (!userId) return null;

  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });

  if (!res.ok) {
    await logout();
    return null;
  }

  const data = await res.json() as { accessToken: string };
  useAuthStore.getState().setTokenAndUser(data.accessToken);
  return data.accessToken;
}
```

- [ ] **Step 2: Rewrite `apps/web/src/app/(auth)/login/page.tsx`**

```tsx
'use client';

import { Suspense, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import Image from 'next/image';
import { login } from '../../../lib/auth';
import { cn } from '@/lib/utils';

type AuthMode = 'ad' | 'local';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<AuthMode>('ad');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login({ username, password, mode });
      const raw = searchParams.get('from') || '/';
      const from = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
      router.push(from);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Mode toggle */}
      <div className="flex rounded-md border border-neutral-200 p-0.5 bg-neutral-50 gap-0.5">
        {(['ad', 'local'] as AuthMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'flex-1 py-1.5 text-sm font-medium rounded transition-colors',
              mode === m
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-700',
            )}
          >
            {m === 'ad' ? 'Active Directory' : 'Local Account'}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
          Username
        </label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={loading}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
        />
      </div>

      <button
        type="submit"
        disabled={loading || !username || !password}
        className="w-full bg-blue-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
      <div className="mb-6 flex items-center gap-3">
        <div className="relative w-10 h-10 shrink-0">
          <Image src="/assets/ncc-logo.png" alt="NCC" fill className="object-contain" priority />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">NACOC Welfare</h1>
          <p className="text-sm text-gray-500">Sign in to your account</p>
        </div>
      </div>

      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>

      <p className="mt-6 text-xs text-center text-gray-400">
        Welfare Management System · IT Department
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(auth)/login/page.tsx \
        apps/web/src/lib/auth.ts
git commit -m "feat(web): add AD/Local toggle to login page"
```

---

## Task 11: Frontend — Users API client

**Files:**
- Create: `apps/web/src/lib/users.ts`

- [ ] **Step 1: Create `apps/web/src/lib/users.ts`**

```ts
import { apiClient } from './api-client';
import { UserRole } from '@welfare/shared';

export interface UserRecord {
  _id: string;
  username: string;
  displayName: string;
  email?: string;
  role: UserRole;
  source: 'ldap' | 'local';
  isActive: boolean;
  lastLogin?: string;
  createdAt?: string;
}

export interface CreateUserDto {
  username: string;
  displayName: string;
  email?: string;
  password: string;
  role?: UserRole;
}

export async function fetchUsers(): Promise<UserRecord[]> {
  return apiClient<UserRecord[]>('/users');
}

export async function createUser(dto: CreateUserDto): Promise<UserRecord> {
  return apiClient<UserRecord>('/users', { method: 'POST', body: JSON.stringify(dto) });
}

export async function updateUser(id: string, dto: Partial<Pick<UserRecord, 'displayName' | 'email' | 'isActive'>>): Promise<UserRecord> {
  return apiClient<UserRecord>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(dto) });
}

export async function updateUserRole(id: string, role: UserRole): Promise<UserRecord> {
  return apiClient<UserRecord>(`/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
}

export async function resetUserPassword(id: string, password: string): Promise<void> {
  await apiClient<void>(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) });
}
```

- [ ] **Step 2: Check the `apiClient` signature in `apps/web/src/lib/api-client.ts`**

Open the file and confirm `apiClient<T>(path, options?)` matches the calls above. Adjust the wrapper calls if the signature differs.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/users.ts
git commit -m "feat(web): add Users API client"
```

---

## Task 12: Frontend — User Management page

**Files:**
- Create: `apps/web/src/app/(dashboard)/users/page.tsx`
- Create: `apps/web/src/app/(dashboard)/users/users-list-client.tsx`

- [ ] **Step 1: Create `apps/web/src/app/(dashboard)/users/page.tsx`**

```tsx
import { UsersListClient } from './users-list-client';

export default function UsersPage() {
  return <UsersListClient />;
}
```

- [ ] **Step 2: Create `apps/web/src/app/(dashboard)/users/users-list-client.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserCog, Plus, RefreshCw } from 'lucide-react';
import { UserRole, AppModule } from '@welfare/shared';
import { usePermission } from '../../../hooks/use-permission';
import { useAuthStore } from '../../../store/auth.store';
import {
  fetchUsers, createUser, updateUser, updateUserRole, resetUserPassword,
  type UserRecord, type CreateUserDto,
} from '../../../lib/users';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Modal } from '../../../components/ui/modal';
import { EmptyState } from '../../../components/ui/empty-state';
import { DataTable } from '../../../components/ui/data-table';
import { cn } from '@/lib/utils';

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.WelfareOfficer]:  'Officer',
  [UserRole.WelfareManager]:  'Manager',
  [UserRole.WelfareDirector]: 'Director',
  [UserRole.Admin]:           'Admin',
};

const ROLE_VARIANT: Record<UserRole, string> = {
  [UserRole.WelfareOfficer]:  'neutral',
  [UserRole.WelfareManager]:  'primary',
  [UserRole.WelfareDirector]: 'purple',
  [UserRole.Admin]:           'danger',
};

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
      role === UserRole.Admin           && 'bg-red-100 text-red-700',
      role === UserRole.WelfareManager  && 'bg-blue-100 text-blue-700',
      role === UserRole.WelfareDirector && 'bg-purple-100 text-purple-700',
      role === UserRole.WelfareOfficer  && 'bg-neutral-100 text-neutral-700',
    )}>
      {ROLE_LABELS[role]}
    </span>
  );
}

export function UsersListClient() {
  const qc = useQueryClient();
  const permission = usePermission(AppModule.UserManagement);
  const currentUser = useAuthStore((s) => s.user);
  const canManageRoles = currentUser?.role === UserRole.Admin || currentUser?.role === UserRole.WelfareManager;

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  });

  // Create modal state
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserDto>({
    username: '', displayName: '', email: '', password: '', role: UserRole.WelfareOfficer,
  });

  // Edit role modal state
  const [roleTarget, setRoleTarget] = useState<UserRecord | null>(null);
  const [newRole, setNewRole] = useState<UserRole>(UserRole.WelfareOfficer);

  // Reset password modal state
  const [resetTarget, setResetTarget] = useState<UserRecord | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setShowCreate(false); toast.success('User created'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) => updateUserRole(id, role),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setRoleTarget(null); toast.success('Role updated'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => resetUserPassword(id, password),
    onSuccess: () => { setResetTarget(null); setNewPassword(''); toast.success('Password reset'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => updateUser(id, { isActive }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('User updated'); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-6 text-sm text-neutral-500">Loading users…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserCog size={20} className="text-neutral-400" />
          <h1 className="text-lg font-semibold text-neutral-900">Users</h1>
        </div>
        {permission === 'full' && (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={16} className="mr-1" /> Add User
          </Button>
        )}
      </div>

      {users.length === 0 ? (
        <EmptyState title="No users found" />
      ) : (
        <div className="rounded-md border border-neutral-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 border-b border-neutral-200">
              <tr>
                {['Name', 'Username', 'Email', 'Role', 'Status', 'Last Login', ''].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {users.map((u) => (
                <tr key={u._id} className="hover:bg-neutral-50">
                  <td className="px-4 py-3 font-medium text-neutral-900">{u.displayName}</td>
                  <td className="px-4 py-3 text-neutral-600">{u.username}</td>
                  <td className="px-4 py-3 text-neutral-600">{u.email ?? '—'}</td>
                  <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                      u.isActive ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-500',
                    )}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-500 text-xs">
                    {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      {canManageRoles && (
                        <button
                          onClick={() => { setRoleTarget(u); setNewRole(u.role); }}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Edit role
                        </button>
                      )}
                      {canManageRoles && u.source === 'local' && (
                        <button
                          onClick={() => { setResetTarget(u); setNewPassword(''); }}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Reset password
                        </button>
                      )}
                      {permission === 'full' && (
                        <button
                          onClick={() => toggleActiveMutation.mutate({ id: u._id, isActive: !u.isActive })}
                          className="text-xs text-neutral-500 hover:underline"
                        >
                          {u.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create user modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add User">
        <form
          onSubmit={(e) => { e.preventDefault(); createMutation.mutate(createForm); }}
          className="space-y-4"
        >
          {[
            { label: 'Username', key: 'username', type: 'text', required: true },
            { label: 'Display Name', key: 'displayName', type: 'text', required: true },
            { label: 'Email', key: 'email', type: 'email', required: false },
            { label: 'Password', key: 'password', type: 'password', required: true },
          ].map(({ label, key, type, required }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-neutral-700 mb-1">{label}</label>
              <input
                type={type}
                required={required}
                value={(createForm as Record<string, string>)[key] ?? ''}
                onChange={(e) => setCreateForm((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          ))}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Role</label>
            <select
              value={createForm.role}
              onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as UserRole }))}
              className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value={UserRole.WelfareOfficer}>Welfare Officer</option>
              {currentUser?.role === UserRole.Admin && (
                <>
                  <option value={UserRole.WelfareManager}>Welfare Manager</option>
                  <option value={UserRole.WelfareDirector}>Welfare Director</option>
                  <option value={UserRole.Admin}>Admin</option>
                </>
              )}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>Create</Button>
          </div>
        </form>
      </Modal>

      {/* Edit role modal */}
      <Modal open={!!roleTarget} onClose={() => setRoleTarget(null)} title="Change Role">
        {roleTarget && (
          <form onSubmit={(e) => { e.preventDefault(); roleMutation.mutate({ id: roleTarget._id, role: newRole }); }} className="space-y-4">
            <p className="text-sm text-neutral-600">Changing role for <strong>{roleTarget.displayName}</strong>.</p>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">New Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
                className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value={UserRole.WelfareOfficer}>Welfare Officer</option>
                <option value={UserRole.WelfareManager}>Welfare Manager</option>
                <option value={UserRole.WelfareDirector}>Welfare Director</option>
                {currentUser?.role === UserRole.Admin && <option value={UserRole.Admin}>Admin</option>}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setRoleTarget(null)}>Cancel</Button>
              <Button type="submit" loading={roleMutation.isPending}>Save</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Reset password modal */}
      <Modal open={!!resetTarget} onClose={() => setResetTarget(null)} title="Reset Password">
        {resetTarget && (
          <form onSubmit={(e) => { e.preventDefault(); resetMutation.mutate({ id: resetTarget._id, password: newPassword }); }} className="space-y-4">
            <p className="text-sm text-neutral-600">Set a new password for <strong>{resetTarget.displayName}</strong>.</p>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">New Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setResetTarget(null)}>Cancel</Button>
              <Button type="submit" loading={resetMutation.isPending}>Reset</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
```

- [ ] **Step 3: Check that `Modal` component accepts an `open` prop**

Open `apps/web/src/components/ui/modal.tsx`. Verify the `Modal` component accepts `open: boolean`, `onClose: () => void`, and `title: string`. If the interface differs, adjust the `users-list-client.tsx` to match the existing API.

- [ ] **Step 4: Check that `Button` accepts a `loading` prop**

Open `apps/web/src/components/ui/button.tsx`. Verify `loading?: boolean` is accepted. If not, remove `loading={...}` from all Button usages in this file and rely on `disabled` instead.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors. Fix any type mismatches with the Modal/Button component APIs before committing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/users/page.tsx \
        apps/web/src/app/\(dashboard\)/users/users-list-client.tsx
git commit -m "feat(web): add User Management page"
```

---

## Task 13: Frontend — write-action suppression on existing pages

**Files:**
- Modify: `apps/web/src/app/(dashboard)/staff/staff-list-client.tsx`
- Modify: `apps/web/src/app/(dashboard)/contributions/contributions-list-client.tsx`
- Modify: `apps/web/src/app/(dashboard)/loans/loans-list-client.tsx`
- Modify: `apps/web/src/app/(dashboard)/reports/reports-client.tsx`
- Modify: `apps/web/src/app/(dashboard)/settings/settings-client.tsx`

The pattern for each file is the same:

1. Import `usePermission` and the relevant `AppModule` value.
2. Call `const permission = usePermission(AppModule.X)` near the top of the client component.
3. Wrap every create button, edit/delete row action, import trigger, send email button, approval action, and save button with `{permission === 'full' && ...}`.

- [ ] **Step 1: Update `staff-list-client.tsx`**

Add at the top of the component function:
```tsx
import { usePermission } from '../../../hooks/use-permission';
import { AppModule } from '@welfare/shared';

// Inside component:
const permission = usePermission(AppModule.Staff);
```

Wrap every write action:
- "Add Staff" button → `{permission === 'full' && <Button ...>Add Staff</Button>}`
- Any edit/delete/change-status row actions → `{permission === 'full' && ...}`
- Import Excel button → `{permission === 'full' && ...}`

- [ ] **Step 2: Update `contributions-list-client.tsx`**

```tsx
const permission = usePermission(AppModule.Contributions);
```

Wrap:
- "Add Contribution" / "Import" buttons → `{permission === 'full' && ...}`
- Row-level edit/delete/resolve-flagged actions → `{permission === 'full' && ...}`

- [ ] **Step 3: Update `loans-list-client.tsx`**

```tsx
const permission = usePermission(AppModule.Loans);
```

Wrap:
- "New Loan" button → `{permission === 'full' && ...}`
- "Import" button → `{permission === 'full' && ...}`
- Row-level approve/reject/payment actions → `{permission === 'full' && ...}`

- [ ] **Step 4: Update `reports-client.tsx`**

```tsx
const permission = usePermission(AppModule.Reports);
```

Wrap:
- "Send Statement" / "Bulk Send" email trigger buttons → `{permission === 'full' && ...}`
- All data fetch/view/download actions are readonly — leave visible.

- [ ] **Step 5: Update `settings-client.tsx`**

```tsx
const permission = usePermission(AppModule.Settings);
```

Wrap:
- "Save" button on any settings form → `{permission === 'full' && ...}`
- "Test Email" button → `{permission === 'full' && ...}`
- All input fields → `disabled={permission !== 'full'}` (keep visible but non-editable)

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/staff/staff-list-client.tsx \
        apps/web/src/app/\(dashboard\)/contributions/contributions-list-client.tsx \
        apps/web/src/app/\(dashboard\)/loans/loans-list-client.tsx \
        apps/web/src/app/\(dashboard\)/reports/reports-client.tsx \
        apps/web/src/app/\(dashboard\)/settings/settings-client.tsx
git commit -m "feat(web): suppress write actions for read-only roles"
```

---

## Self-Review Checklist

### Spec coverage

| Spec requirement | Task |
|---|---|
| 4 roles in UserRole enum | Task 1 |
| PERMISSIONS matrix in shared | Task 1 |
| AuditEntity.User added | Task 1 |
| UserRole enum moved to shared | Task 2 |
| seedAdminIfEmpty seeds Admin | Task 2 |
| PermissionsGuard + @RequirePermission | Task 3 |
| UsersService.updateRole + resetPassword | Task 4 |
| /users CRUD endpoints | Task 5 |
| /users/:id/role endpoint (Admin+Manager) | Task 5 |
| /users/:id/reset-password (Admin+Manager) | Task 5 |
| Reset password 400 for LDAP users | Task 4 (service throws BadRequestException) |
| LDAP welfare_group check | Task 6 |
| Existing controllers gated | Task 7 |
| usePermission hook | Task 8 |
| Sidebar filtered by role | Task 9 |
| Users nav item (Manager+Admin only) | Task 9 |
| Login AD/Local toggle, AD default | Task 10 |
| Users API client | Task 11 |
| User Management page | Task 12 |
| Role badge colours | Task 12 |
| Create user modal (role restricted) | Task 12 |
| Edit role modal | Task 12 |
| Reset password modal | Task 12 |
| Activate/Deactivate | Task 12 |
| Write-action suppression (existing pages) | Task 13 |
| Role changes audit logged | Task 5 |
| Password reset audit logged | Task 5 |

All requirements covered.
