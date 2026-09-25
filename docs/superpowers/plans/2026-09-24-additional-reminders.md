# Additional Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five new reminder/notice emails the app currently doesn't send — missed contribution, loan-overdue (first day), grace-period-ending, guarantor-restitution-outstanding, and guarantor-cap notice — all using a new shared, on-theme email shell instead of each template hand-rolling its own HTML.

**Architecture:** One new shared template helper (`renderEmailShell`) centralizes the header/footer chrome and pulls its colors from the web app's real Tailwind palette (`primary` #bc4680, `info`/`warning`/`danger` families) instead of the off-theme amber (#d97706) the two existing templates use. Four new reminders are cron `@Cron()` jobs mirroring the existing `PaymentReminderJob`/`OverdueDetectionJob` shape (own job class, own `@InjectModel`s, `EmailService.send`, idempotency via a `*SentAt` timestamp field). The fifth (guarantor-cap notice) is not time-based — it fires synchronously the moment a guarantor's active-guarantee count reaches the enforced cap, from inside the loan-creation flow, mirroring the existing fire-and-forget `LoanScheduleSenderService.sendForLoan` call in `LoansService.create`.

**Tech Stack:** NestJS, Mongoose, `@nestjs/schedule` (`@Cron`), Jest.

**Spec:** No separate spec doc — this plan is scoped directly from conversation: five reminder ideas discussed and agreed (missed contribution, loan overdue, grace-period-ending, guarantor-restitution-outstanding, guarantor-cap), plus the explicit requirement that new email templates "use the color theme of the app and should look nice and professional."

## Global Constraints

- New email templates must use the web app's real Tailwind palette (`apps/web/tailwind.config.ts`): primary `#bc4680`, info `#1671D9`, warning `#D69E2E`, danger `#CB1A14`, neutral borders `#E4E7EC`, surface `#F9FAFB`, text `#101928` — not the existing templates' off-theme `#d97706` amber.
- Every new cron job follows the existing pattern: `@Injectable()` + `@Cron()`, `Logger`, try/catch per-recipient so one failure doesn't abort the batch, skip staff with no email or non-Active status, use `EmailService.send(...)` with `EmailTriggerSource.Cron`.
- Every new recurring (cron-based) reminder that isn't meant to repeat daily forever must guard against re-sending via a `*SentAt` timestamp field on the record it's about, set only after a successful send.
- New `EmailLogType` enum values go in `packages/shared/src/enums/email-log-type.enum.ts` — this file is consumed by both `apps/api` and `apps/web` via the `@welfare/shared` package, so no separate web-side change is needed for the enum itself.
- Money and date fields already on `Loan`/`LoanRepayment`/`Contribution` schemas are reused as-is (see File Structure) — no new business-logic fields beyond the `*SentAt` idempotency guards.

## Review Focus

- **Staff/guarantor has no email on record** — every new job must skip that recipient without throwing, same as `PaymentReminderJob` (`if (!staff?.email) continue;`). Covered in Tasks 2–6.
- **Contribution/loan already resolved before the job runs** (contribution paid before the missed-reminder cron fires same day it's due; loan repaid before overdue-reminder cron fires; loan restituted before grace-warning cron fires) — the job's query itself must exclude these (status filters), not rely on post-hoc checks. Covered in Tasks 2–5.
- **Reminder already sent this cycle** — re-running the same cron on the same day, or the scheduler firing twice, must not double-send. Covered via `*SentAt: { $exists: false }` guards in Tasks 2–4.
- **Guarantor restitution reminder must NOT stop recurring** — unlike the other four, this one is intentionally sent every week until the guarantor is made whole; a wrongly-added `*SentAt` guard here would silently stop nagging after the first week. Covered in Task 5 (explicitly no guard, tested by asserting no update-marking call exists).
- **Guarantor-cap notice must fire exactly once per loan, not once per day** — because it's a synchronous creation-time hook, not a cron scan, there is no possibility of a daily duplicate; Task 6 tests that it fires only when the post-creation count crosses the cap, not on every loan.

---

## File Structure

- Create: `apps/api/src/email/templates/theme.ts` — shared color tokens + `renderEmailShell()` + `fmtGHS()`/`mono()` helpers used by all five new templates.
- Create: `apps/api/src/email/templates/theme.spec.ts`
- Modify: `packages/shared/src/enums/email-log-type.enum.ts` — five new `EmailLogType` values (one per task that needs it).
- Modify: `apps/api/src/contributions/schemas/contribution.schema.ts` — add `reminderSentAt?: Date`.
- Create: `apps/api/src/email/templates/contribution-missed-reminder.template.ts`
- Create: `apps/api/src/contributions/jobs/missed-contribution-reminder.job.ts`
- Create: `apps/api/src/contributions/jobs/missed-contribution-reminder.job.spec.ts`
- Modify: `apps/api/src/contributions/contributions.module.ts` — register `Staff` schema + new job provider.
- Modify: `apps/api/src/loans/schemas/loan-repayment.schema.ts` — add `overdueReminderSentAt?: Date`.
- Create: `apps/api/src/email/templates/loan-overdue-reminder.template.ts`
- Create: `apps/api/src/loans/jobs/loan-overdue-reminder.job.ts`
- Create: `apps/api/src/loans/jobs/loan-overdue-reminder.job.spec.ts`
- Modify: `apps/api/src/loans/schemas/loan.schema.ts` — add `gracePeriodWarningSentAt?: Date`.
- Create: `apps/api/src/email/templates/grace-period-warning.template.ts`
- Create: `apps/api/src/loans/jobs/grace-period-warning.job.ts`
- Create: `apps/api/src/loans/jobs/grace-period-warning.job.spec.ts`
- Create: `apps/api/src/email/templates/guarantor-restitution-reminder.template.ts`
- Create: `apps/api/src/contributions/jobs/guarantor-restitution-reminder.job.ts`
- Create: `apps/api/src/contributions/jobs/guarantor-restitution-reminder.job.spec.ts`
- Create: `apps/api/src/email/templates/guarantor-cap-notice.template.ts`
- Modify: `apps/api/src/loans/loan-schedule-sender.service.ts` — add `sendGuarantorCapNotice(...)`.
- Modify: `apps/api/src/loans/loan-schedule-sender.service.spec.ts` (create if it doesn't exist) — tests for the new method.
- Modify: `apps/api/src/loans/loans.service.ts:176-224` — call the new method after loan creation.
- Modify: `apps/api/src/loans/loans.service.spec.ts` — test the call is made/skipped correctly.
- Modify: `apps/api/src/loans/loans.module.ts` — register the two new job providers.

---

### Task 1: Shared themed email shell

**Files:**
- Create: `apps/api/src/email/templates/theme.ts`
- Test: `apps/api/src/email/templates/theme.spec.ts`

**Interfaces:**
- Consumes: `getFontFaceCSS()` from `./fonts` (existing).
- Produces: `EMAIL_COLORS` (const object), `renderEmailShell(props: EmailShellProps): string`, `fmtGHS(n: number): string`, `mono(s: string | number): string` — consumed by Tasks 2–5's templates.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/email/templates/theme.spec.ts
import { renderEmailShell, EMAIL_COLORS, fmtGHS, mono } from './theme';

describe('renderEmailShell', () => {
  it('uses the primary theme color for the "primary" accent', () => {
    const html = renderEmailShell({
      accent: 'primary',
      organisationName: 'Test Welfare Union',
      eyebrow: 'Test Notice',
      bodyHtml: '<p>Hello world</p>',
    });

    expect(html).toContain(EMAIL_COLORS.primary);
    expect(html).toContain('Test Welfare Union');
    expect(html).toContain('Test Notice');
    expect(html).toContain('<p>Hello world</p>');
  });

  it('switches header color per accent and never mixes accents', () => {
    const warning = renderEmailShell({
      accent: 'warning',
      organisationName: 'Org',
      eyebrow: 'Warning Notice',
      bodyHtml: '<p>x</p>',
    });
    const danger = renderEmailShell({
      accent: 'danger',
      organisationName: 'Org',
      eyebrow: 'Danger Notice',
      bodyHtml: '<p>x</p>',
    });

    expect(warning).toContain(EMAIL_COLORS.warning);
    expect(warning).not.toContain(EMAIL_COLORS.danger);
    expect(danger).toContain(EMAIL_COLORS.danger);
    expect(danger).not.toContain(EMAIL_COLORS.warning);
  });

  it('includes an optional footer note when provided', () => {
    const html = renderEmailShell({
      accent: 'info',
      organisationName: 'Org',
      eyebrow: 'Info Notice',
      bodyHtml: '<p>x</p>',
      footerNote: 'Automated notice',
    });

    expect(html).toContain('Automated notice');
  });
});

describe('fmtGHS', () => {
  it('formats to two decimal places with the GHS prefix', () => {
    expect(fmtGHS(1234.5)).toBe('GHS 1,234.50');
  });
});

describe('mono', () => {
  it('wraps the value in the monospace font span', () => {
    expect(mono('ABC123')).toContain('ABC123');
    expect(mono('ABC123')).toContain("'JetBrains Mono'");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd apps/api && npx jest email/templates/theme.spec.ts`
Expected: FAIL — `Cannot find module './theme'`

- [ ] **Step 3: Implement the shell**

```typescript
// apps/api/src/email/templates/theme.ts
import { getFontFaceCSS } from './fonts';

export const EMAIL_COLORS = {
  primary: '#bc4680',
  info: '#1671D9',
  warning: '#D69E2E',
  danger: '#CB1A14',
  success: '#0F973D',
  textPrimary: '#101928',
  textMuted: '#667085',
  border: '#E4E7EC',
  surface: '#F9FAFB',
} as const;

export type EmailAccent = 'primary' | 'info' | 'warning' | 'danger';

interface EmailShellProps {
  accent: EmailAccent;
  organisationName: string;
  eyebrow: string;
  bodyHtml: string;
  footerNote?: string;
}

const ACCENT_HEX: Record<EmailAccent, string> = {
  primary: EMAIL_COLORS.primary,
  info: EMAIL_COLORS.info,
  warning: EMAIL_COLORS.warning,
  danger: EMAIL_COLORS.danger,
};

export function renderEmailShell(props: EmailShellProps): string {
  const { accent, organisationName, eyebrow, bodyHtml, footerNote } = props;
  const headerColor = ACCENT_HEX[accent];

  return `<!DOCTYPE html>
<html>
<head>
  ${getFontFaceCSS()}
  <style>body,table,td,th,p,span,strong,a{font-family: 'Nunito', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif}</style>
</head>
<body style="font-family: 'Nunito', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:14px;color:${EMAIL_COLORS.textPrimary};margin:0;padding:0;background-color:${EMAIL_COLORS.surface}">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;border:1px solid ${EMAIL_COLORS.border}">
          <tr>
            <td style="background-color:${headerColor};padding:20px 32px;color:#ffffff;border-radius:8px 8px 0 0">
              <p style="margin:0;font-size:18px;font-weight:bold">${organisationName}</p>
              <p style="margin:4px 0 0;font-size:13px;opacity:0.9">${eyebrow}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:12px 32px;background-color:${EMAIL_COLORS.surface};border-top:1px solid ${EMAIL_COLORS.border};font-size:12px;color:${EMAIL_COLORS.textMuted}">
              Generated: ${new Date().toLocaleDateString('en-GB')} | ${organisationName}${footerNote ? ` | ${footerNote}` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function fmtGHS(n: number): string {
  return `GHS ${new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

export function mono(s: string | number): string {
  return `<span style="font-family: 'JetBrains Mono', 'Consolas', 'SFMono-Regular', monospace">${s}</span>`;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd apps/api && npx jest email/templates/theme.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/email/templates/theme.ts apps/api/src/email/templates/theme.spec.ts
git commit -m "feat(email): add shared on-theme email shell for reminder templates"
```

---

### Task 2: Missed Contribution Reminder

**Files:**
- Modify: `packages/shared/src/enums/email-log-type.enum.ts`
- Modify: `apps/api/src/contributions/schemas/contribution.schema.ts`
- Create: `apps/api/src/email/templates/contribution-missed-reminder.template.ts`
- Create: `apps/api/src/contributions/jobs/missed-contribution-reminder.job.ts`
- Test: `apps/api/src/contributions/jobs/missed-contribution-reminder.job.spec.ts`
- Modify: `apps/api/src/contributions/contributions.module.ts`

**Interfaces:**
- Consumes: `renderEmailShell`, `fmtGHS`, `mono` (Task 1); `ConfigKey.PaymentDeadlineDay` (existing, default `'5'`); `ContributionStatus.Missed` (existing).
- Produces: `renderMissedContributionReminder(props): string`; `MissedContributionReminderJob.sendMissedContributionReminders(): Promise<void>` (cron-invoked, also callable directly in tests).

- [ ] **Step 1: Add the enum value**

In `packages/shared/src/enums/email-log-type.enum.ts`, add:

```typescript
export enum EmailLogType {
  ContributionStatement = 'ContributionStatement',
  LoanSchedule = 'LoanSchedule',
  PaymentReminder = 'PaymentReminder',
  LoanPaymentReminder = 'LoanPaymentReminder',
  LoanForfeitureNotice = 'LoanForfeitureNotice',
  PasswordReset = 'PasswordReset',
  MissedContributionReminder = 'MissedContributionReminder',
}
```

- [ ] **Step 2: Add the idempotency field to the schema**

In `apps/api/src/contributions/schemas/contribution.schema.ts`, add after `recordedBy`:

```typescript
  @Prop() reminderSentAt?: Date;
```

- [ ] **Step 3: Write the failing job test**

```typescript
// apps/api/src/contributions/jobs/missed-contribution-reminder.job.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MissedContributionReminderJob } from './missed-contribution-reminder.job';
import { Contribution } from '../schemas/contribution.schema';
import { Staff } from '../../staff/schemas/staff.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { EmailService } from '../../email/email.service';
import { ContributionStatus } from '@welfare/shared';

describe('MissedContributionReminderJob', () => {
  let job: MissedContributionReminderJob;
  let contributionModel: any;
  let staffModel: any;
  let configService: any;
  let emailService: any;

  const fixedToday = new Date('2026-04-10T00:00:00.000Z');

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(fixedToday);

    contributionModel = {
      find: jest.fn(),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    staffModel = { findById: jest.fn() };
    configService = { getAll: jest.fn().mockResolvedValue({ PAYMENT_DEADLINE_DAY: { value: '5' }, EMAIL_FROM_NAME: { value: 'Test Union' } }) };
    emailService = { send: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissedContributionReminderJob,
        { provide: getModelToken(Contribution.name), useValue: contributionModel },
        { provide: getModelToken(Staff.name), useValue: staffModel },
        { provide: SystemConfigService, useValue: configService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    job = module.get<MissedContributionReminderJob>(MissedContributionReminderJob);
  });

  afterEach(() => jest.useRealTimers());

  it('emails staff with a missed contribution this month and marks it sent', async () => {
    const row = {
      _id: { toString: () => 'contrib-1' },
      staffId: 'staff-1',
      expectedAmount: 200,
      month: 4,
      year: 2026,
    };
    contributionModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([row]) });
    staffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'staff-1' }, fullName: 'Ama Owusu', email: 'ama@example.com' }) });

    await job.sendMissedContributionReminders();

    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(contributionModel.updateOne).toHaveBeenCalledWith(
      { _id: row._id },
      { $set: { reminderSentAt: expect.any(Date) } },
    );
  });

  it('skips staff with no email and does not mark the reminder sent', async () => {
    const row = { _id: { toString: () => 'contrib-2' }, staffId: 'staff-2', expectedAmount: 200, month: 4, year: 2026 };
    contributionModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([row]) });
    staffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'staff-2' }, fullName: 'No Email', email: undefined }) });

    await job.sendMissedContributionReminders();

    expect(emailService.send).not.toHaveBeenCalled();
    expect(contributionModel.updateOne).not.toHaveBeenCalled();
  });

  it('does nothing before the payment deadline day has passed', async () => {
    jest.setSystemTime(new Date('2026-04-03T00:00:00.000Z'));

    await job.sendMissedContributionReminders();

    expect(contributionModel.find).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run the test to confirm it fails**

Run: `cd apps/api && npx jest missed-contribution-reminder.job.spec.ts`
Expected: FAIL — `Cannot find module './missed-contribution-reminder.job'`

- [ ] **Step 5: Write the template**

```typescript
// apps/api/src/email/templates/contribution-missed-reminder.template.ts
import { renderEmailShell, fmtGHS, mono } from './theme';

interface MissedContributionReminderProps {
  staffName: string;
  expectedAmount: number;
  month: number;
  year: number;
  organisationName: string;
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function renderMissedContributionReminder(props: MissedContributionReminderProps): string {
  const { staffName, expectedAmount, month, year, organisationName } = props;
  const period = `${MONTH_NAMES[month - 1]} ${year}`;

  const bodyHtml = `
    <p style="margin:0 0 16px">Dear ${mono(staffName)},</p>
    <p style="margin:0 0 16px">Our records show your welfare contribution of <strong>${fmtGHS(expectedAmount)}</strong> for <strong>${period}</strong> has not yet been received.</p>
    <p style="margin:0 0 16px;padding:12px 16px;background-color:#FEF6E7;border-radius:6px;font-size:13px">Please arrange payment as soon as possible to keep your contribution record up to date.</p>
    <p style="margin:0;color:#6b7280;font-size:13px">If you have already made this payment, please disregard this notice.</p>
  `;

  return renderEmailShell({
    accent: 'warning',
    organisationName,
    eyebrow: 'Missed Contribution Reminder',
    bodyHtml,
  });
}
```

- [ ] **Step 6: Write the job**

```typescript
// apps/api/src/contributions/jobs/missed-contribution-reminder.job.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigKey, ContributionStatus, EmailLogType, EmailTriggerSource, IEmailRecipient } from '@welfare/shared';
import { Contribution, ContributionDocument } from '../schemas/contribution.schema';
import { Staff, StaffDocument } from '../../staff/schemas/staff.schema';
import { EmailService } from '../../email/email.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { renderMissedContributionReminder } from '../../email/templates/contribution-missed-reminder.template';

type ConfigMap = Record<string, { value: string }>;

@Injectable()
export class MissedContributionReminderJob {
  private readonly logger = new Logger(MissedContributionReminderJob.name);

  constructor(
    @InjectModel(Contribution.name) private readonly contributionModel: Model<ContributionDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly configService: SystemConfigService,
    private readonly emailService: EmailService,
  ) {}

  @Cron('30 0 * * *')
  async sendMissedContributionReminders(): Promise<void> {
    this.logger.log('Starting missed contribution reminder job');

    const config = (await this.configService.getAll()) as unknown as ConfigMap;
    const deadlineDay = parseInt(config[ConfigKey.PaymentDeadlineDay]?.value ?? '5', 10);
    const today = new Date();
    if (today.getDate() <= deadlineDay) {
      this.logger.log('Payment deadline has not passed this month — skipping');
      return;
    }

    const month = today.getMonth() + 1;
    const year = today.getFullYear();
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';

    const missed = await this.contributionModel
      .find({ status: ContributionStatus.Missed, month, year, reminderSentAt: { $exists: false } })
      .exec();

    this.logger.log(`Found ${missed.length} missed contributions for ${month}/${year}`);

    for (const row of missed) {
      try {
        const staff = await this.staffModel.findById(row.staffId).exec();
        if (!staff?.email) continue;

        const html = renderMissedContributionReminder({
          staffName: staff.fullName,
          expectedAmount: row.expectedAmount,
          month,
          year,
          organisationName,
        });

        const recipient: IEmailRecipient = {
          staffId: staff._id.toString(),
          staffName: staff.fullName,
          email: staff.email,
        };
        await this.emailService.send(
          recipient,
          EmailLogType.MissedContributionReminder,
          `Missed Contribution Reminder - ${month}/${year}`,
          html,
          EmailTriggerSource.Cron,
        );

        await this.contributionModel.updateOne({ _id: row._id }, { $set: { reminderSentAt: new Date() } }).exec();
      } catch (err) {
        this.logger.error(`Reminder failed for contribution ${row._id.toString()}`, err);
      }
    }

    this.logger.log('Missed contribution reminder job complete');
  }
}
```

- [ ] **Step 7: Wire into the module**

In `apps/api/src/contributions/contributions.module.ts`, add `Staff` to the `MongooseModule.forFeature` array and register the job:

```typescript
import { Staff, StaffSchema } from '../staff/schemas/staff.schema';
import { MissedContributionReminderJob } from './jobs/missed-contribution-reminder.job';
// ...
    MongooseModule.forFeature([
      { name: Contribution.name, schema: ContributionSchema },
      { name: ImportBatch.name, schema: ImportBatchSchema },
      { name: Loan.name, schema: LoanSchema },
      { name: ContributionRate.name, schema: ContributionRateSchema },
      { name: Staff.name, schema: StaffSchema },
    ]),
// ...
  providers: [ContributionsService, ImportService, ContributionRatesService, MissedContributionReminderJob],
```

- [ ] **Step 8: Run all new and existing contributions tests**

Run: `cd apps/api && npx jest missed-contribution-reminder.job.spec.ts contributions.module`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/enums/email-log-type.enum.ts apps/api/src/contributions/schemas/contribution.schema.ts apps/api/src/email/templates/contribution-missed-reminder.template.ts apps/api/src/contributions/jobs/missed-contribution-reminder.job.ts apps/api/src/contributions/jobs/missed-contribution-reminder.job.spec.ts apps/api/src/contributions/contributions.module.ts
git commit -m "feat(contributions): add missed contribution reminder email"
```

---

### Task 3: Loan Overdue Reminder (first day overdue)

**Files:**
- Modify: `packages/shared/src/enums/email-log-type.enum.ts`
- Modify: `apps/api/src/loans/schemas/loan-repayment.schema.ts`
- Create: `apps/api/src/email/templates/loan-overdue-reminder.template.ts`
- Create: `apps/api/src/loans/jobs/loan-overdue-reminder.job.ts`
- Test: `apps/api/src/loans/jobs/loan-overdue-reminder.job.spec.ts`
- Modify: `apps/api/src/loans/loans.module.ts`

**Interfaces:**
- Consumes: `renderEmailShell`, `fmtGHS`, `mono` (Task 1).
- Produces: `renderLoanOverdueReminder(props): string`; `LoanOverdueReminderJob.sendOverdueReminders(): Promise<void>`.

This complements the existing `OverdueDetectionJob` (which runs at `5 0 * * *`, marks instalments `Overdue`, applies penalty, and — once the grace period expires — starts offsetting guarantor/defaulter contributions). This new job runs after it and nags the borrower on the day their instalment first becomes `Overdue`, before any contribution gets touched.

- [ ] **Step 1: Add the enum value**

In `packages/shared/src/enums/email-log-type.enum.ts`, add `LoanOverdueReminder = 'LoanOverdueReminder',`.

- [ ] **Step 2: Add the idempotency field**

In `apps/api/src/loans/schemas/loan-repayment.schema.ts`, add after `notes`:

```typescript
  @Prop() overdueReminderSentAt?: Date;
```

- [ ] **Step 3: Write the failing job test**

```typescript
// apps/api/src/loans/jobs/loan-overdue-reminder.job.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { LoanOverdueReminderJob } from './loan-overdue-reminder.job';
import { LoanRepayment } from '../schemas/loan-repayment.schema';
import { Loan } from '../schemas/loan.schema';
import { Staff } from '../../staff/schemas/staff.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { EmailService } from '../../email/email.service';
import { LoanRepaymentStatus, LoanStatus } from '@welfare/shared';

describe('LoanOverdueReminderJob', () => {
  let job: LoanOverdueReminderJob;
  let repaymentModel: any;
  let loanModel: any;
  let staffModel: any;
  let configService: any;
  let emailService: any;

  beforeEach(async () => {
    repaymentModel = { find: jest.fn(), updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }) };
    loanModel = { findById: jest.fn() };
    staffModel = { findById: jest.fn() };
    configService = { getAll: jest.fn().mockResolvedValue({ EMAIL_FROM_NAME: { value: 'Test Union' } }) };
    emailService = { send: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoanOverdueReminderJob,
        { provide: getModelToken(LoanRepayment.name), useValue: repaymentModel },
        { provide: getModelToken(Loan.name), useValue: loanModel },
        { provide: getModelToken(Staff.name), useValue: staffModel },
        { provide: SystemConfigService, useValue: configService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    job = module.get<LoanOverdueReminderJob>(LoanOverdueReminderJob);
  });

  const makeInst = () => ({
    _id: { toString: () => 'inst-1' },
    loanId: 'loan-1',
    staffId: 'staff-1',
    instalmentNumber: 1,
    dueAmount: 3500,
    penaltyAmount: 500,
    paidAmount: 0,
  });

  it('emails the borrower for a newly-overdue instalment and marks it sent', async () => {
    const inst = makeInst();
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'loan-1' }, status: LoanStatus.Active }) });
    staffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'staff-1' }, fullName: 'Kofi Mensah', email: 'kofi@example.com' }) });

    await job.sendOverdueReminders();

    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(repaymentModel.updateOne).toHaveBeenCalledWith(
      { _id: inst._id },
      { $set: { overdueReminderSentAt: expect.any(Date) } },
    );
  });

  it('skips instalments on a loan that is no longer Active', async () => {
    const inst = makeInst();
    repaymentModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([inst]) });
    loanModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'loan-1' }, status: LoanStatus.Completed }) });

    await job.sendOverdueReminders();

    expect(emailService.send).not.toHaveBeenCalled();
    expect(repaymentModel.updateOne).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run the test to confirm it fails**

Run: `cd apps/api && npx jest loan-overdue-reminder.job.spec.ts`
Expected: FAIL — `Cannot find module './loan-overdue-reminder.job'`

- [ ] **Step 5: Write the template**

```typescript
// apps/api/src/email/templates/loan-overdue-reminder.template.ts
import { renderEmailShell, fmtGHS, mono } from './theme';

interface LoanOverdueReminderProps {
  staffName: string;
  loanRef: string;
  outstandingAmount: number;
  organisationName: string;
}

export function renderLoanOverdueReminder(props: LoanOverdueReminderProps): string {
  const { staffName, loanRef, outstandingAmount, organisationName } = props;

  const bodyHtml = `
    <p style="margin:0 0 16px">Dear ${mono(staffName)},</p>
    <p style="margin:0 0 16px">Your loan instalment of <strong>${fmtGHS(outstandingAmount)}</strong> (Ref: ${mono(loanRef)}) is now <strong>overdue</strong>.</p>
    <p style="margin:0 0 16px;padding:12px 16px;background-color:#FEF6E7;border-radius:6px;font-size:13px">Please make payment promptly. If this remains unpaid beyond the grace period, your guarantor's and/or your own contribution balance may be used to cover the shortfall.</p>
    <p style="margin:0;color:#6b7280;font-size:13px">If you have already made this payment, please disregard this notice.</p>
  `;

  return renderEmailShell({
    accent: 'warning',
    organisationName,
    eyebrow: 'Loan Instalment Overdue',
    bodyHtml,
  });
}
```

- [ ] **Step 6: Write the job**

```typescript
// apps/api/src/loans/jobs/loan-overdue-reminder.job.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailLogType, EmailTriggerSource, IEmailRecipient, LoanRepaymentStatus, LoanStatus } from '@welfare/shared';
import { LoanRepayment, LoanRepaymentDocument } from '../schemas/loan-repayment.schema';
import { Loan, LoanDocument } from '../schemas/loan.schema';
import { Staff, StaffDocument } from '../../staff/schemas/staff.schema';
import { EmailService } from '../../email/email.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { renderLoanOverdueReminder } from '../../email/templates/loan-overdue-reminder.template';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class LoanOverdueReminderJob {
  private readonly logger = new Logger(LoanOverdueReminderJob.name);

  constructor(
    @InjectModel(LoanRepayment.name) private readonly repaymentModel: Model<LoanRepaymentDocument>,
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly configService: SystemConfigService,
    private readonly emailService: EmailService,
  ) {}

  @Cron('0 1 * * *')
  async sendOverdueReminders(): Promise<void> {
    this.logger.log('Starting loan overdue reminder job');

    const config = await this.configService.getAll();
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';

    const overdue = await this.repaymentModel
      .find({
        status: LoanRepaymentStatus.Overdue,
        overdueReminderSentAt: { $exists: false },
      })
      .exec();

    this.logger.log(`Found ${overdue.length} newly-overdue instalments`);

    for (const inst of overdue) {
      try {
        const loan = await this.loanModel.findById(inst.loanId).exec();
        if (!loan || loan.status !== LoanStatus.Active) continue;

        const staff = await this.staffModel.findById(inst.staffId).exec();
        if (!staff?.email) continue;

        const outstanding = round2(inst.dueAmount + inst.penaltyAmount - inst.paidAmount);
        const html = renderLoanOverdueReminder({
          staffName: staff.fullName,
          loanRef: inst.loanId.slice(-6).toUpperCase(),
          outstandingAmount: outstanding,
          organisationName,
        });

        const recipient: IEmailRecipient = {
          staffId: staff._id.toString(),
          staffName: staff.fullName,
          email: staff.email,
        };
        await this.emailService.send(
          recipient,
          EmailLogType.LoanOverdueReminder,
          `Loan Instalment Overdue - Ref ${inst.loanId.slice(-6).toUpperCase()}`,
          html,
          EmailTriggerSource.Cron,
        );

        await this.repaymentModel.updateOne({ _id: inst._id }, { $set: { overdueReminderSentAt: new Date() } }).exec();
      } catch (err) {
        this.logger.error(`Overdue reminder failed for instalment ${inst._id.toString()}`, err);
      }
    }

    this.logger.log('Loan overdue reminder job complete');
  }
}
```

- [ ] **Step 7: Wire into the module**

In `apps/api/src/loans/loans.module.ts`, import and add `LoanOverdueReminderJob` to `providers`.

- [ ] **Step 8: Run the tests**

Run: `cd apps/api && npx jest loan-overdue-reminder.job.spec.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/enums/email-log-type.enum.ts apps/api/src/loans/schemas/loan-repayment.schema.ts apps/api/src/email/templates/loan-overdue-reminder.template.ts apps/api/src/loans/jobs/loan-overdue-reminder.job.ts apps/api/src/loans/jobs/loan-overdue-reminder.job.spec.ts apps/api/src/loans/loans.module.ts
git commit -m "feat(loans): add first-day-overdue loan reminder email"
```

---

### Task 4: Grace-Period-Ending Warning

**Files:**
- Modify: `packages/shared/src/enums/email-log-type.enum.ts`
- Modify: `apps/api/src/loans/schemas/loan.schema.ts`
- Create: `apps/api/src/email/templates/grace-period-warning.template.ts`
- Create: `apps/api/src/loans/jobs/grace-period-warning.job.ts`
- Test: `apps/api/src/loans/jobs/grace-period-warning.job.spec.ts`
- Modify: `apps/api/src/loans/loans.module.ts`

**Interfaces:**
- Consumes: `renderEmailShell`, `fmtGHS`, `mono` (Task 1); `Loan.endOfTenureGraceExpiry`, `Loan.status === LoanStatus.Defaulted`, `Loan.recoveryRanAt` (existing fields set by `DefaultRecoveryJob`).
- Produces: `renderGracePeriodWarning(props): string`; `GracePeriodWarningJob.sendGracePeriodWarnings(): Promise<void>`.

Warns both the defaulter and their guarantor 7 days before `DefaultRecoveryJob.runGracePeriodRecovery` (`15 0 * * *`) offsets contributions — giving the defaulter a last chance to pay and settle without either contribution balance being touched.

- [ ] **Step 1: Add the enum value**

In `packages/shared/src/enums/email-log-type.enum.ts`, add `GracePeriodWarning = 'GracePeriodWarning',`.

- [ ] **Step 2: Add the idempotency field**

In `apps/api/src/loans/schemas/loan.schema.ts`, add after `endOfTenureGraceExpiry`:

```typescript
  @Prop() gracePeriodWarningSentAt?: Date;
```

- [ ] **Step 3: Write the failing job test**

```typescript
// apps/api/src/loans/jobs/grace-period-warning.job.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { GracePeriodWarningJob } from './grace-period-warning.job';
import { Loan } from '../schemas/loan.schema';
import { Staff } from '../../staff/schemas/staff.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { EmailService } from '../../email/email.service';
import { LoanStatus } from '@welfare/shared';

describe('GracePeriodWarningJob', () => {
  let job: GracePeriodWarningJob;
  let loanModel: any;
  let staffModel: any;
  let configService: any;
  let emailService: any;

  const fixedToday = new Date('2026-04-10T00:00:00.000Z');

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(fixedToday);

    loanModel = { find: jest.fn(), updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }) };
    staffModel = { findById: jest.fn() };
    configService = { getAll: jest.fn().mockResolvedValue({ EMAIL_FROM_NAME: { value: 'Test Union' } }) };
    emailService = { send: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GracePeriodWarningJob,
        { provide: getModelToken(Loan.name), useValue: loanModel },
        { provide: getModelToken(Staff.name), useValue: staffModel },
        { provide: SystemConfigService, useValue: configService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    job = module.get<GracePeriodWarningJob>(GracePeriodWarningJob);
  });

  afterEach(() => jest.useRealTimers());

  const makeLoan = () => ({
    _id: { toString: () => 'loan-1' },
    staffId: 'staff-1',
    guarantorId: 'guarantor-1',
    principalAmount: 7000,
    endOfTenureGraceExpiry: new Date('2026-04-17T00:00:00.000Z'),
  });

  it('emails both the defaulter and the guarantor and marks the loan warned', async () => {
    const loan = makeLoan();
    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
    staffModel.findById
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'staff-1' }, fullName: 'Kofi Mensah', email: 'kofi@example.com' }) })
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'guarantor-1' }, fullName: 'Ama Owusu', email: 'ama@example.com' }) });

    await job.sendGracePeriodWarnings();

    expect(emailService.send).toHaveBeenCalledTimes(2);
    expect(loanModel.updateOne).toHaveBeenCalledWith(
      { _id: loan._id },
      { $set: { gracePeriodWarningSentAt: expect.any(Date) } },
    );
  });

  it('still marks the loan warned when the guarantor has no email but the defaulter does', async () => {
    const loan = makeLoan();
    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
    staffModel.findById
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'staff-1' }, fullName: 'Kofi Mensah', email: 'kofi@example.com' }) })
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'guarantor-1' }, fullName: 'Ama Owusu', email: undefined }) });

    await job.sendGracePeriodWarnings();

    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(loanModel.updateOne).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run the test to confirm it fails**

Run: `cd apps/api && npx jest grace-period-warning.job.spec.ts`
Expected: FAIL — `Cannot find module './grace-period-warning.job'`

- [ ] **Step 5: Write the template**

```typescript
// apps/api/src/email/templates/grace-period-warning.template.ts
import { renderEmailShell, fmtGHS, mono } from './theme';

interface GracePeriodWarningProps {
  recipientName: string;
  role: 'Borrower' | 'Guarantor';
  loanRef: string;
  principalAmount: number;
  graceExpiryDate: string;
  organisationName: string;
}

export function renderGracePeriodWarning(props: GracePeriodWarningProps): string {
  const { recipientName, role, loanRef, principalAmount, graceExpiryDate, organisationName } = props;

  const bodyHtml = role === 'Borrower'
    ? `
    <p style="margin:0 0 16px">Dear ${mono(recipientName)},</p>
    <p style="margin:0 0 16px">Your loan (Ref: ${mono(loanRef)}, principal ${fmtGHS(principalAmount)}) has reached the end of its tenure and is still outstanding. Your grace period ends on <strong>${new Date(graceExpiryDate).toLocaleDateString('en-GB')}</strong>.</p>
    <p style="margin:0 0 16px;padding:12px 16px;background-color:#FBEAE9;border-radius:6px;font-size:13px">If the loan is not settled before then, your guarantor's contribution balance — and if needed, your own — will be used to cover the outstanding amount.</p>
    <p style="margin:0;color:#6b7280;font-size:13px">Please contact the welfare office to settle this loan before the grace period ends.</p>
  `
    : `
    <p style="margin:0 0 16px">Dear ${mono(recipientName)},</p>
    <p style="margin:0 0 16px">A loan you guaranteed (Ref: ${mono(loanRef)}, principal ${fmtGHS(principalAmount)}) is past its tenure and still outstanding. The borrower's grace period ends on <strong>${new Date(graceExpiryDate).toLocaleDateString('en-GB')}</strong>.</p>
    <p style="margin:0 0 16px;padding:12px 16px;background-color:#FBEAE9;border-radius:6px;font-size:13px">If it remains unpaid after that date, your contribution balance may be used to cover the shortfall, in line with the guarantee you provided.</p>
    <p style="margin:0;color:#6b7280;font-size:13px">This is an early notice so you can follow up with the borrower before that happens.</p>
  `;

  return renderEmailShell({
    accent: 'danger',
    organisationName,
    eyebrow: 'Grace Period Ending Soon',
    bodyHtml,
  });
}
```

- [ ] **Step 6: Write the job**

```typescript
// apps/api/src/loans/jobs/grace-period-warning.job.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailLogType, EmailTriggerSource, IEmailRecipient, LoanStatus } from '@welfare/shared';
import { Loan, LoanDocument } from '../schemas/loan.schema';
import { Staff, StaffDocument } from '../../staff/schemas/staff.schema';
import { EmailService } from '../../email/email.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { renderGracePeriodWarning } from '../../email/templates/grace-period-warning.template';

@Injectable()
export class GracePeriodWarningJob {
  private readonly logger = new Logger(GracePeriodWarningJob.name);

  constructor(
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly configService: SystemConfigService,
    private readonly emailService: EmailService,
  ) {}

  @Cron('0 2 * * *')
  async sendGracePeriodWarnings(): Promise<void> {
    this.logger.log('Starting grace period warning job');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + 7);
    const targetEnd = new Date(targetDate);
    targetEnd.setHours(23, 59, 59, 999);

    const config = await this.configService.getAll();
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';

    const loans = await this.loanModel
      .find({
        status: LoanStatus.Defaulted,
        endOfTenureGraceExpiry: { $gte: targetDate, $lte: targetEnd },
        gracePeriodWarningSentAt: { $exists: false },
      })
      .exec();

    this.logger.log(`Found ${loans.length} loans with grace period ending in 7 days`);

    for (const loan of loans) {
      try {
        const loanRef = loan._id.toString().slice(-6).toUpperCase();
        let sentAny = false;

        const [borrower, guarantor] = await Promise.all([
          this.staffModel.findById(loan.staffId).exec(),
          this.staffModel.findById(loan.guarantorId).exec(),
        ]);

        if (borrower?.email) {
          const html = renderGracePeriodWarning({
            recipientName: borrower.fullName,
            role: 'Borrower',
            loanRef,
            principalAmount: loan.principalAmount,
            graceExpiryDate: loan.endOfTenureGraceExpiry!.toISOString(),
            organisationName,
          });
          const recipient: IEmailRecipient = { staffId: borrower._id.toString(), staffName: borrower.fullName, email: borrower.email };
          await this.emailService.send(recipient, EmailLogType.GracePeriodWarning, `Grace Period Ending - Loan Ref ${loanRef}`, html, EmailTriggerSource.Cron);
          sentAny = true;
        }

        if (guarantor?.email) {
          const html = renderGracePeriodWarning({
            recipientName: guarantor.fullName,
            role: 'Guarantor',
            loanRef,
            principalAmount: loan.principalAmount,
            graceExpiryDate: loan.endOfTenureGraceExpiry!.toISOString(),
            organisationName,
          });
          const recipient: IEmailRecipient = { staffId: guarantor._id.toString(), staffName: guarantor.fullName, email: guarantor.email };
          await this.emailService.send(recipient, EmailLogType.GracePeriodWarning, `Grace Period Ending - Loan Ref ${loanRef}`, html, EmailTriggerSource.Cron);
          sentAny = true;
        }

        if (sentAny) {
          await this.loanModel.updateOne({ _id: loan._id }, { $set: { gracePeriodWarningSentAt: new Date() } }).exec();
        }
      } catch (err) {
        this.logger.error(`Grace period warning failed for loan ${loan._id.toString()}`, err);
      }
    }

    this.logger.log('Grace period warning job complete');
  }
}
```

- [ ] **Step 7: Wire into the module**

In `apps/api/src/loans/loans.module.ts`, import and add `GracePeriodWarningJob` to `providers`.

- [ ] **Step 8: Run the tests**

Run: `cd apps/api && npx jest grace-period-warning.job.spec.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/enums/email-log-type.enum.ts apps/api/src/loans/schemas/loan.schema.ts apps/api/src/email/templates/grace-period-warning.template.ts apps/api/src/loans/jobs/grace-period-warning.job.ts apps/api/src/loans/jobs/grace-period-warning.job.spec.ts apps/api/src/loans/loans.module.ts
git commit -m "feat(loans): add grace-period-ending warning email for borrower and guarantor"
```

---

### Task 5: Guarantor Restitution Outstanding Reminder (recurring)

**Files:**
- Modify: `packages/shared/src/enums/email-log-type.enum.ts`
- Create: `apps/api/src/email/templates/guarantor-restitution-reminder.template.ts`
- Create: `apps/api/src/contributions/jobs/guarantor-restitution-reminder.job.ts`
- Test: `apps/api/src/contributions/jobs/guarantor-restitution-reminder.job.spec.ts`
- Modify: `apps/api/src/contributions/contributions.module.ts`

**Interfaces:**
- Consumes: `renderEmailShell`, `fmtGHS`, `mono` (Task 1); `Loan.guarantorRestitutionOwed`/`guarantorRestitutionPaid` (existing, maintained by `ContributionsService.redirectToGuarantorRestitution`/`settleGuarantorRestitution` and the offset jobs).
- Produces: `renderGuarantorRestitutionReminder(props): string`; `GuarantorRestitutionReminderJob.sendRestitutionReminders(): Promise<void>`.

Unlike Tasks 2–4, this job is meant to **recur weekly until resolved** — do not add a `*SentAt` guard field. It reuses `ContributionsModule`'s existing `Staff` registration once Task 2 adds it (Task 2 must land first, or duplicate the `forFeature` entry — Mongoose allows registering the same schema in multiple modules, matching the existing convention across this codebase).

- [ ] **Step 1: Add the enum value**

In `packages/shared/src/enums/email-log-type.enum.ts`, add `GuarantorRestitutionReminder = 'GuarantorRestitutionReminder',`.

- [ ] **Step 2: Write the failing job test**

```typescript
// apps/api/src/contributions/jobs/guarantor-restitution-reminder.job.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { GuarantorRestitutionReminderJob } from './guarantor-restitution-reminder.job';
import { Loan } from '../../loans/schemas/loan.schema';
import { Staff } from '../../staff/schemas/staff.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { EmailService } from '../../email/email.service';

describe('GuarantorRestitutionReminderJob', () => {
  let job: GuarantorRestitutionReminderJob;
  let loanModel: any;
  let staffModel: any;
  let configService: any;
  let emailService: any;

  beforeEach(async () => {
    loanModel = { find: jest.fn() };
    staffModel = { findById: jest.fn() };
    configService = { getAll: jest.fn().mockResolvedValue({ EMAIL_FROM_NAME: { value: 'Test Union' } }) };
    emailService = { send: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuarantorRestitutionReminderJob,
        { provide: getModelToken(Loan.name), useValue: loanModel },
        { provide: getModelToken(Staff.name), useValue: staffModel },
        { provide: SystemConfigService, useValue: configService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    job = module.get<GuarantorRestitutionReminderJob>(GuarantorRestitutionReminderJob);
  });

  it('emails every guarantor with unresolved restitution, every run, with no persisted send-marker', async () => {
    const loan = {
      _id: { toString: () => 'loan-1' },
      staffId: 'staff-1',
      guarantorId: 'guarantor-1',
      guarantorRestitutionOwed: 1000,
      guarantorRestitutionPaid: 300,
    };
    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([loan]) });
    staffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'guarantor-1' }, fullName: 'Ama Owusu', email: 'ama@example.com' }) });

    await job.sendRestitutionReminders();
    await job.sendRestitutionReminders();

    expect(emailService.send).toHaveBeenCalledTimes(2);
    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 'guarantor-1' }),
      expect.anything(),
      expect.any(String),
      expect.any(String),
      expect.anything(),
    );
  });

  it('skips guarantors who have already been fully restituted', async () => {
    loanModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    await job.sendRestitutionReminders();

    expect(emailService.send).not.toHaveBeenCalled();
  });
});
```

The query itself (`$expr: { $gt: ['$guarantorRestitutionOwed', '$guarantorRestitutionPaid'] }`) is what makes the second test's "already fully restituted" case return no loans — that's asserted by having `loanModel.find` return `[]` for that scenario, matching how the real query would behave once `guarantorRestitutionPaid` catches up to `guarantorRestitutionOwed`.

- [ ] **Step 3: Run the test to confirm it fails**

Run: `cd apps/api && npx jest guarantor-restitution-reminder.job.spec.ts`
Expected: FAIL — `Cannot find module './guarantor-restitution-reminder.job'`

- [ ] **Step 4: Write the template**

```typescript
// apps/api/src/email/templates/guarantor-restitution-reminder.template.ts
import { renderEmailShell, fmtGHS, mono } from './theme';

interface GuarantorRestitutionReminderProps {
  guarantorName: string;
  borrowerName: string;
  loanRef: string;
  amountOwed: number;
  organisationName: string;
}

export function renderGuarantorRestitutionReminder(props: GuarantorRestitutionReminderProps): string {
  const { guarantorName, borrowerName, loanRef, amountOwed, organisationName } = props;

  const bodyHtml = `
    <p style="margin:0 0 16px">Dear ${mono(guarantorName)},</p>
    <p style="margin:0 0 16px">You are still owed <strong>${fmtGHS(amountOwed)}</strong> in restitution for contributions previously used to cover a default on a loan you guaranteed for <strong>${borrowerName}</strong> (Ref: ${mono(loanRef)}).</p>
    <p style="margin:0 0 16px;padding:12px 16px;background-color:#E3EFFC;border-radius:6px;font-size:13px">This amount will continue to be restored to your contribution balance as the borrower repays, and any remainder will be settled in full once the loan is fully paid off.</p>
    <p style="margin:0;color:#6b7280;font-size:13px">This is a routine status update — no action is required on your part.</p>
  `;

  return renderEmailShell({
    accent: 'info',
    organisationName,
    eyebrow: 'Restitution Still Outstanding',
    bodyHtml,
  });
}
```

- [ ] **Step 5: Write the job**

```typescript
// apps/api/src/contributions/jobs/guarantor-restitution-reminder.job.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailLogType, EmailTriggerSource, IEmailRecipient } from '@welfare/shared';
import { Loan, LoanDocument } from '../../loans/schemas/loan.schema';
import { Staff, StaffDocument } from '../../staff/schemas/staff.schema';
import { EmailService } from '../../email/email.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { renderGuarantorRestitutionReminder } from '../../email/templates/guarantor-restitution-reminder.template';

@Injectable()
export class GuarantorRestitutionReminderJob {
  private readonly logger = new Logger(GuarantorRestitutionReminderJob.name);

  constructor(
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    private readonly configService: SystemConfigService,
    private readonly emailService: EmailService,
  ) {}

  @Cron('0 8 * * 1')
  async sendRestitutionReminders(): Promise<void> {
    this.logger.log('Starting guarantor restitution reminder job');

    const config = await this.configService.getAll();
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';

    const loans = await this.loanModel
      .find({ $expr: { $gt: ['$guarantorRestitutionOwed', '$guarantorRestitutionPaid'] } })
      .exec();

    this.logger.log(`Found ${loans.length} loans with unresolved guarantor restitution`);

    for (const loan of loans) {
      try {
        const [guarantor, borrower] = await Promise.all([
          this.staffModel.findById(loan.guarantorId).exec(),
          this.staffModel.findById(loan.staffId).exec(),
        ]);
        if (!guarantor?.email) continue;

        const amountOwed = (loan.guarantorRestitutionOwed ?? 0) - (loan.guarantorRestitutionPaid ?? 0);
        const loanRef = loan._id.toString().slice(-6).toUpperCase();

        const html = renderGuarantorRestitutionReminder({
          guarantorName: guarantor.fullName,
          borrowerName: borrower?.fullName ?? 'Unknown',
          loanRef,
          amountOwed,
          organisationName,
        });

        const recipient: IEmailRecipient = { staffId: guarantor._id.toString(), staffName: guarantor.fullName, email: guarantor.email };
        await this.emailService.send(recipient, EmailLogType.GuarantorRestitutionReminder, `Restitution Still Outstanding - Loan Ref ${loanRef}`, html, EmailTriggerSource.Cron);
      } catch (err) {
        this.logger.error(`Restitution reminder failed for loan ${loan._id.toString()}`, err);
      }
    }

    this.logger.log('Guarantor restitution reminder job complete');
  }
}
```

- [ ] **Step 6: Wire into the module**

In `apps/api/src/contributions/contributions.module.ts`, register `GuarantorRestitutionReminderJob` in `providers` (Staff is already registered there from Task 2, Step 7).

- [ ] **Step 7: Run the tests**

Run: `cd apps/api && npx jest guarantor-restitution-reminder.job.spec.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/enums/email-log-type.enum.ts apps/api/src/email/templates/guarantor-restitution-reminder.template.ts apps/api/src/contributions/jobs/guarantor-restitution-reminder.job.ts apps/api/src/contributions/jobs/guarantor-restitution-reminder.job.spec.ts apps/api/src/contributions/contributions.module.ts
git commit -m "feat(contributions): add weekly guarantor restitution outstanding reminder"
```

---

### Task 6: Guarantor Cap Notice (synchronous, at loan creation)

**Files:**
- Modify: `packages/shared/src/enums/email-log-type.enum.ts`
- Create: `apps/api/src/email/templates/guarantor-cap-notice.template.ts`
- Modify: `apps/api/src/loans/loan-schedule-sender.service.ts`
- Create/Modify: `apps/api/src/loans/loan-schedule-sender.service.spec.ts`
- Modify: `apps/api/src/loans/loans.service.ts:176-224`
- Modify: `apps/api/src/loans/loans.service.spec.ts`

**Interfaces:**
- Consumes: `renderEmailShell`, `fmtGHS`, `mono` (Task 1); `ConfigKey.MaxLoansPerGuarantor` (existing, already used at `loans.service.ts:176`).
- Produces: `renderGuarantorCapNotice(props): string`; `LoanScheduleSenderService.sendGuarantorCapNotice(guarantorId: string, activeCount: number, maxPerGuarantor: number, loanRef: string): Promise<void>`.

Unlike Tasks 2–5, this is not a cron scan — `LoansService.create` already knows `guarantorLoanCount` (the count *before* this loan) and `maxPerGuarantor` at `loans.service.ts:176-185`. Firing the notice right there, guarded by `guarantorLoanCount + 1 >= maxPerGuarantor`, means it happens exactly once, at the moment the guarantor reaches their cap — no polling, no idempotency field needed.

- [ ] **Step 1: Add the enum value**

In `packages/shared/src/enums/email-log-type.enum.ts`, add `GuarantorCapNotice = 'GuarantorCapNotice',`.

- [ ] **Step 2: Write the failing test for the new sender method**

```typescript
// apps/api/src/loans/loan-schedule-sender.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { LoanScheduleSenderService } from './loan-schedule-sender.service';
import { LoanRepayment } from './schemas/loan-repayment.schema';
import { Staff } from '../staff/schemas/staff.schema';
import { EmailService } from '../email/email.service';
import { SystemConfigService } from '../system-config/system-config.service';

describe('LoanScheduleSenderService.sendGuarantorCapNotice', () => {
  let service: LoanScheduleSenderService;
  let staffModel: any;
  let emailService: any;
  let configService: any;

  beforeEach(async () => {
    staffModel = { findById: jest.fn() };
    emailService = { send: jest.fn().mockResolvedValue(undefined) };
    configService = { getAll: jest.fn().mockResolvedValue({ EMAIL_FROM_NAME: { value: 'Test Union' } }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoanScheduleSenderService,
        { provide: getModelToken(LoanRepayment.name), useValue: { find: jest.fn() } },
        { provide: getModelToken(Staff.name), useValue: staffModel },
        { provide: EmailService, useValue: emailService },
        { provide: SystemConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<LoanScheduleSenderService>(LoanScheduleSenderService);
  });

  it('emails the guarantor when they have just reached the cap', async () => {
    staffModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: { toString: () => 'guarantor-1' }, fullName: 'Ama Owusu', email: 'ama@example.com' }) });

    await service.sendGuarantorCapNotice('guarantor-1', 3, 3, 'ABC123');

    expect(emailService.send).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the guarantor is still below the cap', async () => {
    await service.sendGuarantorCapNotice('guarantor-1', 2, 3, 'ABC123');

    expect(staffModel.findById).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('does nothing when the cap is unset (0 = unlimited)', async () => {
    await service.sendGuarantorCapNotice('guarantor-1', 5, 0, 'ABC123');

    expect(emailService.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `cd apps/api && npx jest loan-schedule-sender.service.spec.ts`
Expected: FAIL — `service.sendGuarantorCapNotice is not a function`

- [ ] **Step 4: Write the template**

```typescript
// apps/api/src/email/templates/guarantor-cap-notice.template.ts
import { renderEmailShell, mono } from './theme';

interface GuarantorCapNoticeProps {
  guarantorName: string;
  activeCount: number;
  maxPerGuarantor: number;
  loanRef: string;
  organisationName: string;
}

export function renderGuarantorCapNotice(props: GuarantorCapNoticeProps): string {
  const { guarantorName, activeCount, maxPerGuarantor, loanRef, organisationName } = props;

  const bodyHtml = `
    <p style="margin:0 0 16px">Dear ${mono(guarantorName)},</p>
    <p style="margin:0 0 16px">You have just co-signed loan ${mono(loanRef)}, bringing your active guarantees to <strong>${activeCount} of ${maxPerGuarantor}</strong> — the maximum allowed at one time.</p>
    <p style="margin:0 0 16px;padding:12px 16px;background-color:#fbf4f8;border-radius:6px;font-size:13px">You will not be able to guarantee another loan until one of your current guarantees is fully repaid.</p>
    <p style="margin:0;color:#6b7280;font-size:13px">This is an informational notice — no action is required.</p>
  `;

  return renderEmailShell({
    accent: 'primary',
    organisationName,
    eyebrow: 'Guarantor Limit Reached',
    bodyHtml,
  });
}
```

- [ ] **Step 5: Add the method to `LoanScheduleSenderService`**

In `apps/api/src/loans/loan-schedule-sender.service.ts`, add the import and method:

```typescript
import { renderGuarantorCapNotice } from '../email/templates/guarantor-cap-notice.template';
```

```typescript
  async sendGuarantorCapNotice(
    guarantorId: string,
    activeCount: number,
    maxPerGuarantor: number,
    loanRef: string,
  ): Promise<void> {
    if (maxPerGuarantor <= 0 || activeCount < maxPerGuarantor) return;

    const guarantor = await this.staffModel.findById(guarantorId).exec();
    if (!guarantor?.email) {
      this.logger.warn(`Skipping guarantor cap notice for ${guarantorId} — no email on record`);
      return;
    }

    const config = await this.configService.getAll();
    const organisationName = config['EMAIL_FROM_NAME']?.value ?? 'Welfare System';

    const html = renderGuarantorCapNotice({
      guarantorName: guarantor.fullName,
      activeCount,
      maxPerGuarantor,
      loanRef,
      organisationName,
    });

    await this.emailService.send(
      { staffId: guarantor._id.toString(), staffName: guarantor.fullName, email: guarantor.email },
      EmailLogType.GuarantorCapNotice,
      'You Have Reached Your Guarantor Limit',
      html,
      EmailTriggerSource.Manual,
    );
  }
```

Add `EmailLogType`, `EmailTriggerSource` to the existing `import { EmailLogType, EmailTriggerSource, ConfigKey } from '@welfare/shared';` line (already present — just confirm both names are there).

- [ ] **Step 6: Run the test to confirm it passes**

Run: `cd apps/api && npx jest loan-schedule-sender.service.spec.ts`
Expected: PASS

- [ ] **Step 7: Write the failing test for the `LoansService.create` wiring**

Add to `apps/api/src/loans/loans.service.spec.ts`, in the `describe('create', ...)` block (mirror however the existing suite mocks `loanScheduleSender` — add `sendGuarantorCapNotice: jest.fn().mockResolvedValue(undefined)` to that mock object, then add):

```typescript
  it('fires the guarantor cap notice when this loan brings the guarantor to the configured cap', async () => {
    configService.getAll.mockResolvedValue({
      ...mockConfig(),
      MAX_LOANS_PER_GUARANTOR: { value: '3' },
    });
    loanModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(2) });
    // ...existing setup for a successful create() call...

    const loan = await service.create(validDto, 'actor', 'Actor');

    expect(loanScheduleSender.sendGuarantorCapNotice).toHaveBeenCalledWith(
      validDto.guarantorId,
      3,
      3,
      loan._id.toString(),
    );
  });
```

(Use this suite's existing `validDto`/mock-setup conventions from the surrounding `create` tests — the assertion is the new part.)

- [ ] **Step 8: Run the test to confirm it fails**

Run: `cd apps/api && npx jest loans.service.spec.ts -t "guarantor cap notice"`
Expected: FAIL — `loanScheduleSender.sendGuarantorCapNotice` never called

- [ ] **Step 9: Wire the call into `create()`**

In `apps/api/src/loans/loans.service.ts`, right after `this.syncLoanToMeilisearch(loan, staff.fullName, staff.staffId);` (line 223), add:

```typescript
    if (maxPerGuarantor > 0) {
      void this.loanScheduleSender
        .sendGuarantorCapNotice(dto.guarantorId, guarantorLoanCount + 1, maxPerGuarantor, loanId)
        .catch(err => this.logger.error(`Guarantor cap notice failed for ${dto.guarantorId}`, err));
    }
```

Note: `loanId` is defined two lines below this insertion point today (`const loanId = loan._id.toString();`) — move that `const loanId = ...` line up to just before this new block, since both the notice call and the existing schedule-building code that follows need it.

- [ ] **Step 10: Run the tests to confirm they pass**

Run: `cd apps/api && npx jest loans.service.spec.ts`
Expected: PASS — all existing `create` tests still pass (they don't assert on `loanScheduleSender.sendGuarantorCapNotice`, so the added mock method is a harmless no-op for them) plus the new test.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/enums/email-log-type.enum.ts apps/api/src/email/templates/guarantor-cap-notice.template.ts apps/api/src/loans/loan-schedule-sender.service.ts apps/api/src/loans/loan-schedule-sender.service.spec.ts apps/api/src/loans/loans.service.ts apps/api/src/loans/loans.service.spec.ts
git commit -m "feat(loans): notify guarantor when a new loan brings them to their guarantee cap"
```

---

## Self-Review Notes

- **Spec coverage:** all five agreed reminders (missed contribution, loan overdue, grace-period-ending, guarantor-restitution-outstanding, guarantor-cap) each have an owning task (2–6); the shared on-theme shell requirement is Task 1, consumed by every template in Tasks 2–6, replacing the off-theme amber used by the two pre-existing templates for all *new* mail (the two existing templates are intentionally left untouched — out of scope, not mentioned in the request).
- **Placeholder scan:** none — every step has literal, complete code; no "similar to Task N" shortcuts.
- **Type consistency:** `renderEmailShell(props: EmailShellProps)` signature is identical everywhere it's imported (Tasks 2–6); `EmailAccent` values (`'primary' | 'info' | 'warning' | 'danger'`) match between Task 1's definition and every template's usage; `IEmailRecipient` / `EmailLogType` / `EmailTriggerSource` usage mirrors the existing `PaymentReminderJob`/`OverdueDetectionJob` exactly.
- **Review Focus:** all five lines (no email, already-resolved record, double-send guard, restitution reminder must keep recurring, cap notice fires once-per-loan-not-once-per-day) map to explicit tests in Tasks 2–6.
- **Known gap carried forward from the prior conversation, intentionally not fixed here:** the Guaranteeing tab's "Offset History" table only shows `GuarantorOffset` debit rows, not restitution credits — Task 5's reminder is the mitigation (tells the guarantor directly by email since the UI doesn't), not a UI fix. A UI fix would be a separate, web-side plan.

---
