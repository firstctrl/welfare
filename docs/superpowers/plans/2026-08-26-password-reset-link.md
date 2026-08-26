# Password Reset Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin's direct type/confirm password-reset modal with an emailed, token-backed reset link, triggerable both by an admin ("send reset link") and by the user themselves ("forgot password?" on the login page).

**Architecture:** A new `PasswordResetToken` Mongo collection stores only a sha256 hash of a random token plus expiry/used state. A new `PasswordResetModule` exposes `PasswordResetService` (token issue + consume + email send) to both `AuthModule` (self-service `/auth/forgot-password`, `/auth/reset-password`) and `UsersModule` (admin `/users/:id/send-reset-link`), avoiding a circular dependency between those two modules by not routing through `UsersService`.

**Tech Stack:** NestJS, Mongoose, class-validator, `@nestjs/throttler`, existing `EmailService`/Nodemailer-or-Resend pipeline, Next.js App Router, `@tanstack/react-query`, axios (`apiClient`).

**Spec:** `docs/superpowers/specs/2026-08-26-password-reset-link-design.md`

## Global Constraints

- Reset tokens: 32 random bytes (hex), sha256-hashed before storage, raw value never persisted — only ever in the emailed URL.
- Token expiry: 1 hour from issuance.
- `POST /auth/forgot-password` always responds `200` with the same generic message whether or not the email matched an account — never reveal account existence.
- `POST /auth/reset-password` always responds the same generic 400 message ("Reset link is invalid or has expired") for not-found / expired / already-used tokens — never distinguish which.
- LDAP accounts (`source: 'ldap'`) are never eligible for a reset link, on either the self-service or admin path (existing rule from the old `resetPassword` method, preserved).
- Both new public auth endpoints throttled at `{ limit: 5, ttl: 60000 }` via `@Throttle`, tighter than the app's global default (`{ limit: 100, ttl: 60000 }`).
- `EmailTriggerSource.Manual` used for both self-service and admin-triggered reset emails (neither is cron-driven).

---

## File Structure

**New:**
- `apps/api/src/password-reset/schemas/password-reset-token.schema.ts` — the token collection.
- `apps/api/src/password-reset/password-reset.service.ts` — `requestReset`, `consumeToken`.
- `apps/api/src/password-reset/password-reset.service.spec.ts`
- `apps/api/src/password-reset/password-reset.module.ts`
- `apps/api/src/email/templates/password-reset.template.ts` — `renderPasswordResetTemplate`.
- `apps/api/src/auth/dto/forgot-password.dto.ts` — `ForgotPasswordDto`.
- `apps/api/src/auth/dto/reset-password.dto.ts` — `ResetPasswordDto` (token + password; distinct from the users-module DTO of the same old name, which is deleted).
- `apps/web/src/app/(auth)/forgot-password/page.tsx`
- `apps/web/src/app/(auth)/reset-password/page.tsx`

**Modified:**
- `packages/shared/src/enums/email-log-type.enum.ts` — add `PasswordReset`.
- `apps/api/src/auth/auth.service.ts` — add `forgotPassword`, `resetPassword`.
- `apps/api/src/auth/auth.controller.ts` — add two `@Public()` routes.
- `apps/api/src/auth/auth.module.ts` — import `PasswordResetModule`.
- `apps/api/src/users/users.service.ts` — add `findByEmail`, `sendResetLink`; remove `resetPassword`.
- `apps/api/src/users/users.controller.ts` — replace `POST :id/reset-password` with `POST :id/send-reset-link`.
- `apps/api/src/users/users.module.ts` — import `PasswordResetModule`.
- `apps/web/src/lib/auth.ts` — add `requestPasswordReset`, `confirmPasswordReset`.
- `apps/web/src/lib/users.ts` — remove `resetUserPassword`; add `sendResetLink`.
- `apps/web/src/components/ui/button.tsx` — `IconButton` gains `disabled`/`title` props.
- `apps/web/src/app/(dashboard)/users/users-list-client.tsx` — replace `ResetPasswordModal` with a send-link confirm modal.
- `apps/web/src/app/(auth)/login/page.tsx` — add "Forgot password?" link (local mode only).

**Deleted:**
- `apps/api/src/users/dto/reset-password.dto.ts`

---

### Task 1: Password reset email template + `EmailLogType.PasswordReset`

**Files:**
- Modify: `packages/shared/src/enums/email-log-type.enum.ts`
- Create: `apps/api/src/email/templates/password-reset.template.ts`

**Interfaces:**
- Consumes: `getFontFaceCSS()` from `apps/api/src/email/templates/fonts.ts`.
- Produces (used by Task 2): `renderPasswordResetTemplate(props: { displayName: string; resetUrl: string; organisationName: string; expiresInHours: number; triggeredByAdmin: boolean }): string`; `EmailLogType.PasswordReset`.

- [ ] **Step 1: Add the enum value**

`packages/shared/src/enums/email-log-type.enum.ts` — add one line:

```ts
export enum EmailLogType {
  ContributionStatement = 'ContributionStatement',
  LoanSchedule = 'LoanSchedule',
  PaymentReminder = 'PaymentReminder',
  LoanPaymentReminder = 'LoanPaymentReminder',
  LoanForfeitureNotice = 'LoanForfeitureNotice',
  PasswordReset = 'PasswordReset',
}
```

- [ ] **Step 2: Write the template**

`apps/api/src/email/templates/password-reset.template.ts`:

```ts
import { getFontFaceCSS } from './fonts';

interface PasswordResetProps {
  displayName: string;
  resetUrl: string;
  organisationName: string;
  expiresInHours: number;
  triggeredByAdmin: boolean;
}

export function renderPasswordResetTemplate(props: PasswordResetProps): string {
  const { displayName, resetUrl, organisationName, expiresInHours, triggeredByAdmin } = props;

  const intro = triggeredByAdmin
    ? 'An administrator initiated a password reset for your account.'
    : 'You requested a password reset for your account.';

  return `<!DOCTYPE html>
<html>
<head>
  ${getFontFaceCSS()}
  <style>body,table,td,th,p,span,strong,a{font-family: 'Nunito', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif}</style>
</head>
<body style="font-family: 'Nunito', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:14px;color:#111827;margin:0;padding:0;background-color:#f9fafb">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;border:1px solid #e5e7eb">
          <tr>
            <td style="background-color:#2563eb;padding:20px 32px;color:#ffffff">
              <p style="margin:0;font-size:18px;font-weight:bold">${organisationName}</p>
              <p style="margin:4px 0 0;font-size:13px;opacity:0.9">Password Reset</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px">
              <p style="margin:0 0 16px">Hi ${displayName},</p>
              <p style="margin:0 0 16px">${intro} Click the button below to choose a new password. This link expires in ${expiresInHours} hour${expiresInHours === 1 ? '' : 's'}.</p>
              <p style="margin:0 0 24px">
                <a href="${resetUrl}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600">Reset Password</a>
              </p>
              <p style="margin:0;font-size:12px;color:#6b7280">If you didn't expect this email, you can safely ignore it — your password won't change unless you click the link above and set a new one.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
```

- [ ] **Step 3: Sanity-check it compiles**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: no errors (this template isn't consumed by anything yet — that's Task 2).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/enums/email-log-type.enum.ts apps/api/src/email/templates/password-reset.template.ts
git commit -m "feat(email): add password reset email template"
```

---

### Task 2: `PasswordResetToken` schema + `PasswordResetService`

**Files:**
- Create: `apps/api/src/password-reset/schemas/password-reset-token.schema.ts`
- Create: `apps/api/src/password-reset/password-reset.service.ts`
- Create: `apps/api/src/password-reset/password-reset.service.spec.ts`
- Test: `apps/api/src/password-reset/password-reset.service.spec.ts`

**Interfaces:**
- Consumes: `User`/`UserDocument` from `apps/api/src/users/schemas/user.schema.ts`; `EmailService.send(recipient: IEmailRecipient, type: EmailLogType, subject: string, html: string, triggeredBy: EmailTriggerSource): Promise<void>` from `apps/api/src/email/email.service.ts`; `SystemConfigService.getAll(): Promise<ConfigMap>` from `apps/api/src/system-config/system-config.service.ts`; `renderPasswordResetTemplate` and `EmailLogType.PasswordReset` (Task 1).
- Produces (used by Tasks 3, 4, 5):
  - `PasswordResetService.requestReset(user: UserDocument, opts: { triggeredByAdmin: boolean }): Promise<void>`
  - `PasswordResetService.consumeToken(rawToken: string, newPassword: string): Promise<void>` — throws `BadRequestException` on any invalid/expired/used/unknown token.
  - `PasswordResetToken` schema class + `PasswordResetTokenDocument` type + `PasswordResetTokenSchema` from the new schema file.

- [ ] **Step 1: Write the schema**

`apps/api/src/password-reset/schemas/password-reset-token.schema.ts`:

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PasswordResetTokenDocument = HydratedDocument<PasswordResetToken>;

@Schema({ timestamps: true, collection: 'password_reset_tokens' })
export class PasswordResetToken {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, unique: true })
  tokenHash!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop()
  usedAt?: Date;
}

export const PasswordResetTokenSchema = SchemaFactory.createForClass(PasswordResetToken);
PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/password-reset/password-reset.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetToken } from './schemas/password-reset-token.schema';
import { User } from '../users/schemas/user.schema';
import { EmailService } from '../email/email.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { EmailLogType, EmailTriggerSource } from '@welfare/shared';

const mockTokenModel = {
  create: jest.fn(),
  findOne: jest.fn(),
  updateMany: jest.fn(),
};

const mockUserModel = {
  findById: jest.fn(),
};

const mockEmailService = { send: jest.fn().mockResolvedValue(undefined) };
const mockConfigService = {
  getAll: jest.fn().mockResolvedValue({ EMAIL_FROM_NAME: { value: 'Welfare System' } }),
};

const fakeUser = {
  _id: { toString: () => 'user-1' },
  displayName: 'Aminu Tijani',
  email: 'aminu@example.com',
};

describe('PasswordResetService', () => {
  let service: PasswordResetService;

  beforeEach(async () => {
    process.env.APP_URL = 'https://welfare.example.com';
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: getModelToken(PasswordResetToken.name), useValue: mockTokenModel },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: EmailService, useValue: mockEmailService },
        { provide: SystemConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get<PasswordResetService>(PasswordResetService);
    jest.clearAllMocks();
    mockConfigService.getAll.mockResolvedValue({ EMAIL_FROM_NAME: { value: 'Welfare System' } });
    mockTokenModel.create.mockResolvedValue({});
    mockTokenModel.updateMany.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
  });

  describe('requestReset', () => {
    it('stores a hash of the token, not the raw value, and emails the user', async () => {
      await service.requestReset(fakeUser as any, { triggeredByAdmin: false });

      expect(mockTokenModel.create).toHaveBeenCalledTimes(1);
      const created = mockTokenModel.create.mock.calls[0][0];
      expect(created.userId).toBe('user-1');
      expect(created.tokenHash).toHaveLength(64); // sha256 hex
      expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now());

      expect(mockEmailService.send).toHaveBeenCalledWith(
        { staffId: 'user-1', staffName: 'Aminu Tijani', email: 'aminu@example.com' },
        EmailLogType.PasswordReset,
        expect.any(String),
        expect.stringContaining('https://welfare.example.com/reset-password?token='),
        EmailTriggerSource.Manual,
      );
    });
  });

  describe('consumeToken', () => {
    it('updates the password and marks the token used for a valid token', async () => {
      const record = {
        userId: 'user-1',
        usedAt: undefined,
        expiresAt: new Date(Date.now() + 60_000),
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockTokenModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(record) });
      const userDoc = { passwordHash: undefined, save: jest.fn().mockResolvedValue(undefined) };
      mockUserModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(userDoc) });

      await service.consumeToken('raw-token-value', 'NewPassw0rd!');

      expect(record.usedAt).toBeInstanceOf(Date);
      expect(record.save).toHaveBeenCalled();
      expect(userDoc.save).toHaveBeenCalled();
      expect(await bcrypt.compare('NewPassw0rd!', userDoc.passwordHash as string)).toBe(true);
      expect(mockTokenModel.updateMany).toHaveBeenCalledWith(
        { userId: 'user-1', usedAt: { $exists: false } },
        { $set: { usedAt: expect.any(Date) } },
      );
    });

    it('rejects an unknown token', async () => {
      mockTokenModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.consumeToken('bad-token', 'x')).rejects.toThrow(BadRequestException);
    });

    it('rejects an expired token', async () => {
      const record = { userId: 'user-1', usedAt: undefined, expiresAt: new Date(Date.now() - 1000) };
      mockTokenModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(record) });
      await expect(service.consumeToken('expired-token', 'x')).rejects.toThrow(BadRequestException);
    });

    it('rejects an already-used token', async () => {
      const record = { userId: 'user-1', usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) };
      mockTokenModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(record) });
      await expect(service.consumeToken('used-token', 'x')).rejects.toThrow(BadRequestException);
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/api && npx jest password-reset.service.spec.ts`
Expected: FAIL — `Cannot find module './password-reset.service'` (file doesn't exist yet).

- [ ] **Step 4: Implement `PasswordResetService`**

`apps/api/src/password-reset/password-reset.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { EmailLogType, EmailTriggerSource } from '@welfare/shared';
import { PasswordResetToken, PasswordResetTokenDocument } from './schemas/password-reset-token.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { EmailService } from '../email/email.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { renderPasswordResetTemplate } from '../email/templates/password-reset.template';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class PasswordResetService {
  constructor(
    @InjectModel(PasswordResetToken.name) private readonly tokenModel: Model<PasswordResetTokenDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly emailService: EmailService,
    private readonly configService: SystemConfigService,
  ) {}

  async requestReset(user: UserDocument, opts: { triggeredByAdmin: boolean }): Promise<void> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const userId = user._id.toString();

    await this.tokenModel.create({
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    });

    const config = await this.configService.getAll() as unknown as Record<string, { value: string }>;
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';
    const baseUrl = process.env.APP_URL ?? process.env.CORS_ORIGIN ?? '';
    const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

    const html = renderPasswordResetTemplate({
      displayName: user.displayName,
      resetUrl,
      organisationName,
      expiresInHours: 1,
      triggeredByAdmin: opts.triggeredByAdmin,
    });

    await this.emailService.send(
      { staffId: userId, staffName: user.displayName, email: user.email! },
      EmailLogType.PasswordReset,
      'Reset Your Password',
      html,
      EmailTriggerSource.Manual,
    );
  }

  async consumeToken(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const record = await this.tokenModel.findOne({ tokenHash }).exec();

    const invalid =
      !record ||
      record.usedAt !== undefined ||
      record.expiresAt.getTime() < Date.now();
    if (invalid) {
      throw new BadRequestException('Reset link is invalid or has expired');
    }

    const user = await this.userModel.findById(record!.userId).select('+passwordHash').exec();
    if (!user) throw new BadRequestException('Reset link is invalid or has expired');

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();

    record!.usedAt = new Date();
    await record!.save();

    await this.tokenModel
      .updateMany(
        { userId: record!.userId, usedAt: { $exists: false } },
        { $set: { usedAt: new Date() } },
      )
      .exec();
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && npx jest password-reset.service.spec.ts`
Expected: PASS (4 `consumeToken` tests + 1 `requestReset` test, 5 total).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/password-reset
git commit -m "feat(auth): add PasswordResetService with token issue/consume"
```

---

### Task 3: `PasswordResetModule`

**Files:**
- Create: `apps/api/src/password-reset/password-reset.module.ts`

**Interfaces:**
- Consumes: `PasswordResetService`, `PasswordResetToken`/`PasswordResetTokenSchema` (Task 2); `User`/`UserSchema` from `apps/api/src/users/schemas/user.schema.ts`; `SystemConfigModule` from `apps/api/src/system-config/system-config.module.ts`. `EmailService` is available without an explicit import because `EmailModule` is `@Global()`.
- Produces: `PasswordResetModule` (exports `PasswordResetService`) — imported by `AuthModule` (Task 5) and `UsersModule` (Task 4).

- [ ] **Step 1: Write the module**

`apps/api/src/password-reset/password-reset.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PasswordResetToken, PasswordResetTokenSchema } from './schemas/password-reset-token.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { PasswordResetService } from './password-reset.service';
import { SystemConfigModule } from '../system-config/system-config.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PasswordResetToken.name, schema: PasswordResetTokenSchema },
      { name: User.name, schema: UserSchema },
    ]),
    SystemConfigModule,
  ],
  providers: [PasswordResetService],
  exports: [PasswordResetService],
})
export class PasswordResetModule {}
```

- [ ] **Step 2: Verify the project still compiles**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: no new errors (this module isn't imported anywhere yet, so it just needs to compile standalone).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/password-reset/password-reset.module.ts
git commit -m "feat(auth): add PasswordResetModule"
```

---

### Task 4: Admin "send reset link" — `UsersService` + `UsersController`

**Files:**
- Modify: `apps/api/src/users/users.service.ts`
- Modify: `apps/api/src/users/users.controller.ts`
- Modify: `apps/api/src/users/users.module.ts`
- Delete: `apps/api/src/users/dto/reset-password.dto.ts`
- Create: `apps/api/src/users/users.service.spec.ts`

**Interfaces:**
- Consumes: `PasswordResetService.requestReset(user, opts)` (Task 2/3).
- Produces (used by Task 8 frontend wiring):
  - `UsersService.findByEmail(email: string): Promise<UserDocument | null>` — matches `source: 'local'` only.
  - `UsersService.sendResetLink(id: string): Promise<void>` — throws `NotFoundException` if no such user, `BadRequestException` if `source === 'ldap'` or `!user.email`.
  - Route `POST /users/:id/send-reset-link` (`@Roles(UserRole.Admin, UserRole.WelfareManager)`, `204` on success) replacing the deleted `POST /users/:id/reset-password`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/users/users.service.spec.ts` (new file):

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';
import { PasswordResetService } from '../password-reset/password-reset.service';

const mockUserModel = {
  findOne: jest.fn(),
  findById: jest.fn(),
};

const mockPasswordResetService = { requestReset: jest.fn().mockResolvedValue(undefined) };

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: PasswordResetService, useValue: mockPasswordResetService },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  describe('findByEmail', () => {
    it('queries by email scoped to local accounts', async () => {
      mockUserModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await service.findByEmail('someone@example.com');
      expect(mockUserModel.findOne).toHaveBeenCalledWith({ email: 'someone@example.com', source: 'local' });
    });
  });

  describe('sendResetLink', () => {
    it('requests a reset for a local user with an email on file', async () => {
      const user = { _id: { toString: () => 'u1' }, source: 'local', email: 'u1@example.com' };
      mockUserModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(user) });

      await service.sendResetLink('u1');

      expect(mockPasswordResetService.requestReset).toHaveBeenCalledWith(user, { triggeredByAdmin: true });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      mockUserModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      await expect(service.sendResetLink('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for an LDAP account', async () => {
      const user = { _id: { toString: () => 'u1' }, source: 'ldap', email: 'u1@example.com' };
      mockUserModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(user) });
      await expect(service.sendResetLink('u1')).rejects.toThrow(BadRequestException);
      expect(mockPasswordResetService.requestReset).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the user has no email', async () => {
      const user = { _id: { toString: () => 'u1' }, source: 'local', email: undefined };
      mockUserModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(user) });
      await expect(service.sendResetLink('u1')).rejects.toThrow(BadRequestException);
      expect(mockPasswordResetService.requestReset).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest users.service.spec.ts`
Expected: FAIL — `service.findByEmail is not a function` / `service.sendResetLink is not a function` (methods don't exist yet), and `PasswordResetService` isn't a registered provider dependency of `UsersService` yet.

- [ ] **Step 3: Implement the service changes**

In `apps/api/src/users/users.service.ts`:

Replace the import line:
```ts
import { Injectable, ConflictException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
```
(unchanged — already has everything needed) and add:
```ts
import { PasswordResetService } from '../password-reset/password-reset.service';
```

Update the constructor:
```ts
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly passwordResetService: PasswordResetService,
  ) {}
```

Add `findByEmail` next to `findByUsername`:
```ts
  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email, source: 'local' }).exec();
  }
```

Replace the existing `resetPassword` method entirely with:
```ts
  async sendResetLink(id: string): Promise<void> {
    const user = await this.userModel.findById(id).exec();
    if (!user) throw new NotFoundException('User not found');
    if (user.source === 'ldap') {
      throw new BadRequestException('Cannot reset password for an Active Directory account');
    }
    if (!user.email) {
      throw new BadRequestException('User has no email address on record');
    }
    await this.passwordResetService.requestReset(user, { triggeredByAdmin: true });
  }
```

- [ ] **Step 4: Update `users.module.ts`**

`apps/api/src/users/users.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PasswordResetModule } from '../password-reset/password-reset.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    PasswordResetModule,
  ],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 5: Update `users.controller.ts`**

In `apps/api/src/users/users.controller.ts`, remove the `ResetPasswordDto` import and replace the `resetPassword` route:

```ts
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
```

with:

```ts
  @Post(':id/send-reset-link')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.Admin, UserRole.WelfareManager)
  async sendResetLink(
    @Param('id') id: string,
    @CurrentUser() actor: UserDocument,
    @Req() req: Request,
  ) {
    await this.usersService.sendResetLink(id);
    await this.auditService.log(
      actor._id.toString(),
      actor.displayName,
      AuditAction.Update,
      AuditEntity.User,
      id,
      undefined,
      { passwordResetLinkSent: true },
      req.ip,
    );
  }
```

Remove the now-unused `import { ResetPasswordDto } from './dto/reset-password.dto';` line at the top of the file.

- [ ] **Step 6: Delete the old DTO**

```bash
rm apps/api/src/users/dto/reset-password.dto.ts
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/api && npx jest users.service.spec.ts`
Expected: PASS (5 tests).

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: no errors (confirms the controller/module edits compile and the deleted DTO has no remaining references).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/users apps/api/src/password-reset
git commit -m "feat(users): replace direct password reset with send-reset-link"
```

---

### Task 5: Self-service — `AuthService` + `AuthController`

**Files:**
- Create: `apps/api/src/auth/dto/forgot-password.dto.ts`
- Create: `apps/api/src/auth/dto/reset-password.dto.ts`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `UsersService.findByEmail` (Task 4); `PasswordResetService.requestReset` / `.consumeToken` (Task 2/3).
- Produces (used by Task 7 frontend wiring):
  - `POST /auth/forgot-password` — public, body `{ email: string }`, always `200 { message: string }`.
  - `POST /auth/reset-password` — public, body `{ token: string; password: string }`, `204` on success, `400` on invalid/expired/used token.

- [ ] **Step 1: Write the DTOs**

`apps/api/src/auth/dto/forgot-password.dto.ts`:

```ts
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}
```

`apps/api/src/auth/dto/reset-password.dto.ts`:

```ts
import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/auth/auth.service.spec.ts` (new file — there is no existing `AuthService` spec to extend):

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PasswordResetService } from '../password-reset/password-reset.service';

const mockUsersService = { findByEmail: jest.fn() };
const mockPasswordResetService = {
  requestReset: jest.fn().mockResolvedValue(undefined),
  consumeToken: jest.fn().mockResolvedValue(undefined),
};
const mockJwtService = { sign: jest.fn() };
const mockConfigService = { get: jest.fn() };
const mockRedis = { set: jest.fn(), get: jest.fn(), del: jest.fn() };

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: PasswordResetService, useValue: mockPasswordResetService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('forgotPassword', () => {
    it('requests a reset when the email matches a local user', async () => {
      const user = { _id: { toString: () => 'u1' } };
      mockUsersService.findByEmail.mockResolvedValue(user);

      await service.forgotPassword('u1@example.com');

      expect(mockPasswordResetService.requestReset).toHaveBeenCalledWith(user, { triggeredByAdmin: false });
    });

    it('does nothing (and does not throw) when no user matches', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      await expect(service.forgotPassword('nobody@example.com')).resolves.toBeUndefined();
      expect(mockPasswordResetService.requestReset).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('delegates to PasswordResetService.consumeToken', async () => {
      await service.resetPassword('raw-token', 'NewPassw0rd!');
      expect(mockPasswordResetService.consumeToken).toHaveBeenCalledWith('raw-token', 'NewPassw0rd!');
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && npx jest auth.service.spec.ts`
Expected: FAIL — `service.forgotPassword is not a function` (methods don't exist yet).

- [ ] **Step 4: Implement the service methods**

In `apps/api/src/auth/auth.service.ts`, add to imports:
```ts
import { PasswordResetService } from '../password-reset/password-reset.service';
```

Update the constructor:
```ts
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordResetService: PasswordResetService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}
```

Add two methods (anywhere after `logout`):
```ts
  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.email) return;
    await this.passwordResetService.requestReset(user, { triggeredByAdmin: false });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    await this.passwordResetService.consumeToken(token, password);
  }
```

- [ ] **Step 5: Add the controller routes**

In `apps/api/src/auth/auth.controller.ts`, add imports:
```ts
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
```

Add two routes at the end of the class, before the closing brace:
```ts
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return { message: 'If an account exists for that email, a reset link was sent.' };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.password);
  }
```

- [ ] **Step 6: Wire `PasswordResetModule` into `AuthModule`**

In `apps/api/src/auth/auth.module.ts`, add the import:
```ts
import { PasswordResetModule } from '../password-reset/password-reset.module';
```
and add `PasswordResetModule` to the `imports` array (alongside `UsersModule`, `SystemConfigModule`, `PassportModule`, `JwtModule.registerAsync(...)`).

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/api && npx jest auth.service.spec.ts`
Expected: PASS (3 tests).

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run full backend suite to confirm no regressions from the constructor signature change:
Run: `cd apps/api && npx jest`
Expected: all suites pass (any spec that constructs `AuthService` directly — there are none besides the new one — would need the new provider; confirmed none exist).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/auth
git commit -m "feat(auth): add self-service forgot-password and reset-password endpoints"
```

---

### Task 6: `IconButton` disabled/title support

**Files:**
- Modify: `apps/web/src/components/ui/button.tsx`

**Interfaces:**
- Produces: `IconButton` gains `disabled?: boolean` and `title?: string` props (used by Task 8).

- [ ] **Step 1: Update `IconButton`**

In `apps/web/src/components/ui/button.tsx`, replace the `IconButton` export:

```ts
export function IconButton({
  icon: Icon,
  label,
  onClick,
  danger = false,
  disabled = false,
  title,
  className,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-7 h-7 rounded-xs border-none inline-flex items-center justify-center text-neutral-500 cursor-pointer transition-colors duration-fast disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
        danger
          ? 'hover:bg-danger-50 hover:text-danger-700'
          : 'hover:bg-neutral-100 hover:text-neutral-700',
        className,
      )}
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: no errors (existing `IconButton` call sites don't pass `disabled`/`title`, both optional, so nothing breaks).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/button.tsx
git commit -m "feat(ui): add disabled/title support to IconButton"
```

---

### Task 7: Frontend API wrappers

**Files:**
- Modify: `apps/web/src/lib/auth.ts`
- Modify: `apps/web/src/lib/users.ts`

**Interfaces:**
- Consumes: `apiClient` from `apps/web/src/lib/api-client.ts`.
- Produces (used by Tasks 8, 9, 10):
  - `requestPasswordReset(email: string): Promise<{ message: string }>`
  - `confirmPasswordReset(token: string, password: string): Promise<void>`
  - `sendResetLink(id: string): Promise<void>`

- [ ] **Step 1: Add to `apps/web/src/lib/auth.ts`**

Add the import at the top:
```ts
import { apiClient } from './api-client';
```

Add at the end of the file:
```ts
export async function requestPasswordReset(email: string): Promise<{ message: string }> {
  const { data } = await apiClient.post('/auth/forgot-password', { email });
  return data;
}

export async function confirmPasswordReset(token: string, password: string): Promise<void> {
  await apiClient.post('/auth/reset-password', { token, password });
}
```

(These use `apiClient` directly rather than a Next.js API-route proxy — unlike `login`/`refresh`/`logout`, neither endpoint sets or reads cookies, so there's nothing for a proxy route to do.)

- [ ] **Step 2: Update `apps/web/src/lib/users.ts`**

Remove:
```ts
export async function resetUserPassword(id: string, password: string): Promise<void> {
  await apiClient.post(`/users/${id}/reset-password`, { password });
}
```

Replace with:
```ts
export async function sendResetLink(id: string): Promise<void> {
  await apiClient.post(`/users/${id}/send-reset-link`);
}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: errors in `users-list-client.tsx` referencing `resetUserPassword` — expected, Task 10 fixes it. Confirm the *only* errors are in that one file.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/auth.ts apps/web/src/lib/users.ts
git commit -m "feat(web): add password reset API wrappers"
```

(The type error left in `users-list-client.tsx` is expected and resolved in Task 10 — this is a checkpoint commit, not a green-build commit. If your workflow requires every commit to type-check clean, squash Tasks 7 and 10 instead.)

---

### Task 8: `/forgot-password` and `/reset-password` pages

**Files:**
- Create: `apps/web/src/app/(auth)/forgot-password/page.tsx`
- Create: `apps/web/src/app/(auth)/reset-password/page.tsx`

**Interfaces:**
- Consumes: `requestPasswordReset`, `confirmPasswordReset` (Task 7).

- [ ] **Step 1: Write `forgot-password/page.tsx`**

`apps/web/src/app/(auth)/forgot-password/page.tsx`:

```tsx
'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { requestPasswordReset } from '../../../lib/auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await requestPasswordReset(email);
    } finally {
      setLoading(false);
      setSubmitted(true);
    }
  }

  return (
    <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Forgot Password</h1>
        <p className="text-sm text-gray-500">Enter your email and we&apos;ll send you a reset link.</p>
      </div>

      {submitted ? (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded text-sm">
          If an account exists for that email, a reset link was sent. Check your inbox.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !email}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Sending...' : 'Send Reset Link'}
          </button>
        </form>
      )}

      <p className="mt-6 text-xs text-center text-gray-400">
        <Link href="/login" className="text-blue-600 hover:underline">Back to sign in</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Write `reset-password/page.tsx`**

`apps/web/src/app/(auth)/reset-password/page.tsx`:

```tsx
'use client';

import { Suspense, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { confirmPasswordReset } from '../../../lib/auth';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (mismatch || !token) return;
    setLoading(true);
    try {
      await confirmPasswordReset(token, password);
      toast.success('Password updated — sign in with your new password.');
      router.push('/login');
    } catch {
      setExpired(true);
    } finally {
      setLoading(false);
    }
  }

  if (!token || expired) {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
          This link is invalid or has expired — request a new one.
        </div>
        <Link href="/forgot-password" className="text-sm text-blue-600 hover:underline">
          Request a new reset link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
          New Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
        />
      </div>
      <div>
        <label htmlFor="confirm" className="block text-sm font-medium text-gray-700 mb-1">
          Confirm Password
        </label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={loading}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
        />
        {mismatch && <p className="mt-1 text-xs text-red-600">Passwords do not match</p>}
      </div>
      <button
        type="submit"
        disabled={loading || !password || mismatch}
        className="w-full bg-blue-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Updating...' : 'Update Password'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Reset Password</h1>
        <p className="text-sm text-gray-500">Choose a new password for your account.</p>
      </div>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: same single pre-existing error in `users-list-client.tsx` (from Task 7), nothing new from these two pages.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(auth)/forgot-password" "apps/web/src/app/(auth)/reset-password"
git commit -m "feat(web): add forgot-password and reset-password pages"
```

---

### Task 9: Login page "Forgot password?" link

**Files:**
- Modify: `apps/web/src/app/(auth)/login/page.tsx`

- [ ] **Step 1: Add the link**

In `apps/web/src/app/(auth)/login/page.tsx`, add the import:
```ts
import Link from 'next/link';
```
(Note: `Image` is already imported from `next/image` — add `Link` from `next/image`'s sibling `next/link`.)

Insert a "Forgot password?" line directly under the password field's closing `</div>`, before the submit `<button>`:

```tsx
      {mode === 'local' && (
        <div className="text-right -mt-2">
          <Link href="/forgot-password" className="text-xs text-blue-600 hover:underline">
            Forgot password?
          </Link>
        </div>
      )}

```

(Placed after the password `<div>...</div>` block and before the `<button type="submit" ...>` block.)

- [ ] **Step 2: Type-check**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: same single pre-existing error in `users-list-client.tsx`, nothing new.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(auth)/login/page.tsx"
git commit -m "feat(web): add forgot password link to login page"
```

---

### Task 10: Replace `ResetPasswordModal` with a send-link confirm modal

**Files:**
- Modify: `apps/web/src/app/(dashboard)/users/users-list-client.tsx`

**Interfaces:**
- Consumes: `sendResetLink` (Task 7), `IconButton`'s `disabled`/`title` props (Task 6).

- [ ] **Step 1: Update imports**

Replace:
```ts
import {
  fetchUsers,
  createUser,
  updateUser,
  updateUserRole,
  resetUserPassword,
  type UserRecord,
  type CreateUserDto,
} from '@/lib/users';
```
with:
```ts
import {
  fetchUsers,
  createUser,
  updateUser,
  updateUserRole,
  sendResetLink,
  type UserRecord,
  type CreateUserDto,
} from '@/lib/users';
```

- [ ] **Step 2: Replace `ResetPasswordModal`**

Replace the entire `ResetPasswordModal` function (from `interface ResetPasswordModalProps` through its closing `}` before `interface ToggleActiveModalProps`) with:

```tsx
interface SendResetLinkModalProps {
  user: UserRecord;
  open: boolean;
  onClose: () => void;
}

function SendResetLinkModal({ user, open, onClose }: SendResetLinkModalProps) {
  const mutation = useMutation({
    mutationFn: () => sendResetLink(user._id),
    onSuccess: () => {
      toast.success(`Reset link sent to ${user.email}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to send reset link'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Send Reset Link" size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Send Link
          </Button>
        </>
      }
    >
      <p className="text-sm text-neutral-600 mt-1">
        Send a password reset link to <span className="font-medium text-neutral-900">{user.displayName}</span>{' '}
        at <span className="font-mono text-neutral-900">{user.email}</span>?
      </p>
    </Modal>
  );
}
```

- [ ] **Step 3: Update the `ActiveModal` union**

Replace:
```ts
type ActiveModal =
  | { type: 'create' }
  | { type: 'editUser'; user: UserRecord }
  | { type: 'resetPassword'; user: UserRecord }
  | { type: 'toggleActive'; user: UserRecord }
  | null;
```
with:
```ts
type ActiveModal =
  | { type: 'create' }
  | { type: 'editUser'; user: UserRecord }
  | { type: 'sendResetLink'; user: UserRecord }
  | { type: 'toggleActive'; user: UserRecord }
  | null;
```

- [ ] **Step 4: Update the reset-password `IconButton`**

Replace:
```tsx
                        {canManageRoles && u.source === 'local' && (
                          <IconButton
                            icon={KeyRound}
                            label="Reset password"
                            onClick={() => setModal({ type: 'resetPassword', user: u })}
                          />
                        )}
```
with:
```tsx
                        {canManageRoles && u.source === 'local' && (
                          <IconButton
                            icon={KeyRound}
                            label="Send reset link"
                            disabled={!u.email}
                            title={u.email ? 'Send reset link' : 'No email on file'}
                            onClick={() => setModal({ type: 'sendResetLink', user: u })}
                          />
                        )}
```

- [ ] **Step 5: Update the modal render block**

Replace:
```tsx
      {modal?.type === 'resetPassword' && (
        <ResetPasswordModal
          user={modal.user}
          open
          onClose={() => setModal(null)}
        />
      )}
```
with:
```tsx
      {modal?.type === 'sendResetLink' && (
        <SendResetLinkModal
          user={modal.user}
          open
          onClose={() => setModal(null)}
        />
      )}
```

- [ ] **Step 6: Type-check**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: no errors — this was the last remaining reference to `resetUserPassword`/`ResetPasswordModal`.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(dashboard)/users/users-list-client.tsx"
git commit -m "feat(web): replace direct password reset with send-reset-link modal"
```

---

### Task 11: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend test suite**

Run: `cd apps/api && npx jest`
Expected: all suites pass, including the 5 new `password-reset.service.spec.ts` tests, 5 new `users.service.spec.ts` tests, and 3 new `auth.service.spec.ts` tests.

- [ ] **Step 2: Type-check both apps**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: no errors in either.

- [ ] **Step 3: Manual smoke test**

With the dev stack running (`docker compose up` or equivalent per this repo's usual dev workflow):

1. Go to `/login`, switch to Local Account mode, click "Forgot password?" → lands on `/forgot-password`.
2. Submit an email that matches a local user with an email on file → generic confirmation shown.
3. Check the email log (Admin → Email Logs, or the dev SMTP catcher / console, whichever this environment uses) for a `PasswordReset` entry; open the link.
4. On `/reset-password?token=...`, set a new password → redirected to `/login`.
5. Log in with the new password → succeeds.
6. As Admin, go to Users, click the key icon next to a local user with an email → confirm modal shows their email → Send Link → toast confirms, email log shows a second `PasswordReset` entry with the admin-triggered copy.
7. Confirm the key icon is disabled (with tooltip "No email on file") for a local user with no email, and absent for LDAP users (unchanged from before).
8. Confirm an expired/garbage token on `/reset-password?token=garbage` shows the "invalid or expired" state with a link back to `/forgot-password`.

- [ ] **Step 4: No commit for this task** — verification only, nothing to stage.
