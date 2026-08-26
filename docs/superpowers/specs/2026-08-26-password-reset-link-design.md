# Password Reset Link — Design

## Problem

Admin can only set a user's password directly (type/confirm). No email-based
reset flow exists — no self-service "forgot password," no admin "send reset
link" option, no token infrastructure, no email template for it.

## Scope

- Admin sends a reset link to a user's email, replacing the current
  type/confirm modal.
- Self-service "Forgot password?" link on the login page (local accounts
  only — LDAP accounts authenticate against Active Directory and cannot be
  reset here).
- Both converge on the same token-backed reset-password completion flow.

Out of scope: changing LDAP auth, changing session/JWT handling, rate-limit
tuning beyond the existing global throttler, notifying admins when a user
resets their own password.

## Data model

New collection `PasswordResetToken`:

```ts
@Schema({ timestamps: true })
export class PasswordResetToken {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, unique: true, index: true })
  tokenHash!: string; // sha256 hex of the raw token

  @Prop({ required: true })
  expiresAt!: Date; // now + 1 hour

  @Prop()
  usedAt?: Date;
}
```

The raw token (32 random bytes, hex-encoded) is generated once, embedded in
the emailed URL, and never persisted — only its sha256 hash is stored. This
matches how the codebase already treats other one-shot secrets and means a
DB read can't be used to forge a reset.

## Backend

### `PasswordResetService` (new, in `apps/api/src/auth/`)

- `createToken(userId): Promise<string>` — generates raw token, stores hash
  + 1hr expiry, returns raw token (caller embeds in email URL).
- `consumeToken(rawToken, newPassword): Promise<void>` — hashes input,
  looks up an unused/unexpired record, sets the user's `passwordHash`,
  marks the token `usedAt`, and invalidates (deletes) any other outstanding
  tokens for that user. Throws `BadRequestException` if not found/expired/used.

Reused by both the admin-triggered and self-service paths so there is one
code path for "what makes a token valid."

### Endpoints

- `POST /auth/forgot-password` — **public**, throttled tighter than the
  global default (5/min via `@Throttle`). Body `{ email: string }`. Looks up
  a `source: 'local'` user by email. If found, calls
  `passwordResetService.createToken` and emails the link. Always responds
  `200 { message: 'If an account exists, a reset link was sent' }` — same
  response whether or not a match was found, to avoid leaking which emails
  have accounts.

- `POST /auth/reset-password` — **public**, throttled. Body
  `{ token: string, password: string }`. Calls
  `passwordResetService.consumeToken`. Returns `204` on success, `400` on
  invalid/expired/used token (message: "Reset link is invalid or has
  expired").

- `POST /users/:id/send-reset-link` — **Admin/WelfareManager**, replaces the
  existing `POST /users/:id/reset-password` route (which is deleted, along
  with `ResetPasswordDto`). Looks up the user; throws `BadRequestException`
  if `source === 'ldap'` (existing rule, preserved) or if `!user.email`.
  Otherwise creates a token and emails the link. Audit-logs
  `AuditAction.Update` / `AuditEntity.User` with `{ passwordResetLinkSent: true }`,
  same as the old route's audit entry shape.

### Email

- New `EmailLogType.PasswordReset` in `packages/shared/src/enums/email-log-type.enum.ts`.
- New template `renderPasswordResetTemplate` in
  `apps/api/src/email/templates/password-reset.template.ts`, following the
  existing template pattern (inline styles, `getFontFaceCSS()`, branded
  header). Props: `{ displayName, resetUrl, organisationName, expiresInHours, triggeredByAdmin }`.
  Copy differs by `triggeredByAdmin`: "An administrator initiated a password
  reset for your account" vs "You requested a password reset."
- Link built as `` `${baseUrl}/reset-password?token=${rawToken}` `` where
  `baseUrl = process.env.APP_URL ?? process.env.CORS_ORIGIN ?? ''`. If
  neither env var is set the link will be relative-looking (`/reset-password?...`)
  — acceptable for local dev, and `APP_URL` should be set in production
  alongside `CORS_ORIGIN`.
- Sent via the existing `EmailService.send(...)`, `EmailTriggerSource.Manual`
  for both paths (self-service counts as a manual, non-cron trigger).

## Frontend

- `apps/web/src/app/(auth)/forgot-password/page.tsx` — email input, submit
  calls a new `requestPasswordReset(email)` in `lib/auth.ts`, shows the
  generic confirmation message inline (no navigation away — so the URL bar
  doesn't reveal anything either).
- `apps/web/src/app/(auth)/reset-password/page.tsx` — reads `token` from
  `useSearchParams()`, password + confirm fields (client-side match check),
  submit calls new `confirmPasswordReset(token, password)` in `lib/auth.ts`.
  On success: toast + redirect to `/login`. On 400: inline error "This link
  is invalid or has expired — request a new one," with a link back to
  `/forgot-password`.
- Login page (`(auth)/login/page.tsx`): "Forgot password?" link under the
  password field, shown only when `mode === 'local'`, pointing to
  `/forgot-password`.
- `users-list-client.tsx`: the `KeyRound` reset-password button now opens a
  lightweight confirm modal ("Send a password reset link to
  `{user.email}`?") instead of `ResetPasswordModal`. Confirm calls a new
  `sendResetLink(id)` in `lib/users.ts` → `POST /users/:id/send-reset-link`.
  If `user.email` is falsy, the button is disabled with a tooltip ("No
  email on file"). `ResetPasswordModal` component and `resetUserPassword`
  are deleted (dead code once the direct-set route is gone).

## Error handling

- Forgot-password: never reveals whether the email matched an account.
- Reset-password: generic "invalid or expired" for any failure mode (not
  found / expired / already used) — doesn't distinguish, so an attacker
  probing tokens learns nothing more than "no."
- Admin send-link: normal validation errors (LDAP account, no email) shown
  as toasts, same as other admin actions in this app.

## Testing

- `PasswordResetService` unit tests: token creation stores hash not raw
  value; `consumeToken` succeeds and updates passwordHash + marks used;
  rejects expired token; rejects already-used token; rejects unknown token;
  invalidates sibling tokens on success.
- `AuthController`/`UsersController` tests: forgot-password returns generic
  200 for both matched and unmatched email; send-reset-link rejects LDAP
  users and users without email.
- Manual UI pass: login → forgot password → check email log (or console in
  dev) → reset page → new password → login with it.
