'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getConfig, updateConfig, testEmail, type ConfigMap } from '../../../lib/config';
import { runBulkAnnualStatement } from '../../../lib/email';
import { AppModule } from '@welfare/shared';
import { usePermission } from '@/hooks/use-permission';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { fmtDate } from '@/lib/format';
import { Skeleton } from '@/components/ui/skeleton';

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  if (!iso) return '—';
  try { return fmtDate(new Date(iso)); } catch { return iso; }
}

function latestEntry(cfg: ConfigMap, keys: string[]): { updatedBy: string; updatedAt: string } | null {
  let latest: { updatedBy: string; updatedAt: string } | null = null;
  for (const k of keys) {
    const entry = cfg[k];
    if (!entry) continue;
    if (!latest || entry.updatedAt > latest.updatedAt) {
      latest = { updatedBy: entry.updatedBy, updatedAt: entry.updatedAt };
    }
  }
  return latest;
}

// ─── shared UI primitives ───────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <Card>
      <CardBody className="space-y-4 animate-pulse">
        <Skeleton className="h-5 w-48" />
        {[1, 2, 3].map((i) => (
          <div key={i}>
            <Skeleton className="h-3 w-32 mb-2" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
        <div className="flex justify-end">
          <Skeleton className="h-9 w-20" />
        </div>
      </CardBody>
    </Card>
  );
}

interface SectionCardProps {
  title: string;
  meta: { updatedBy: string; updatedAt: string } | null;
  children: React.ReactNode;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
  canEdit: boolean;
}

function SectionCard({ title, meta, children, onSave, saving, dirty, canEdit }: SectionCardProps) {
  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={meta ? `Last updated by ${meta.updatedBy} on ${fmt(meta.updatedAt)}` : undefined}
        action={
          canEdit ? (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={saving || !dirty}
              loading={saving}
            >
              Save
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  );
}

// ─── cron presets ───────────────────────────────────────────────────────────

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: 'Quarterly — 1st Jan, Apr, Jul, Oct', value: '0 8 1 1,4,7,10 *' },
  { label: 'Bi-annual — 1st Jan & Jul', value: '0 8 1 1,7 *' },
  { label: 'Monthly — 1st of each month', value: '0 8 1 * *' },
  { label: 'Monthly — 5th of each month', value: '0 8 5 * *' },
  { label: 'Monthly — 15th of each month', value: '0 8 15 * *' },
  { label: 'Annual — 1st January', value: '0 8 1 1 *' },
];

// ─── section: Contributions ─────────────────────────────────────────────────

const CONTRIBUTION_KEYS = ['MONTHLY_CONTRIBUTION_AMOUNT'] as const;

function ContributionsSection({ cfg, onUpdate, onDirtyChange, canEdit }: { cfg: ConfigMap; onUpdate: (next: ConfigMap) => void; onDirtyChange: (dirty: boolean) => void; canEdit: boolean }) {
  const [amount, setAmount] = useState(cfg['MONTHLY_CONTRIBUTION_AMOUNT']?.value ?? '');
  const [saving, setSaving] = useState(false);

  const [original] = useState(() => cfg['MONTHLY_CONTRIBUTION_AMOUNT']?.value ?? '');
  const dirty = amount !== original;
  const meta = latestEntry(cfg, [...CONTRIBUTION_KEYS]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  async function save() {
    if (!dirty) return;
    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      toast.error('Contribution amount must be greater than 0');
      return;
    }
    setSaving(true);
    try {
      const next = await updateConfig({ MONTHLY_CONTRIBUTION_AMOUNT: amount });
      onUpdate(next);
      setAmount(next['MONTHLY_CONTRIBUTION_AMOUNT']?.value ?? amount);
      onDirtyChange(false);
      toast.success('Contributions settings saved');
    } catch {
      toast.error('Failed to save contributions settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Contributions" meta={meta} onSave={save} saving={saving} dirty={dirty} canEdit={canEdit}>
      <Field label="Monthly Contribution Amount" required>
        <Input type="number" min={1} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={saving} prefix="₵" />
      </Field>
    </SectionCard>
  );
}

// ─── section: Loans ─────────────────────────────────────────────────────────

const LOAN_KEYS = [
  'LOAN_MIN_AMOUNT', 'LOAN_MAX_AMOUNT', 'INTEREST_RATE_SHORT',
  'INTEREST_RATE_LONG', 'ELIGIBILITY_MONTHS', 'LOAN_MAX_TENURE',
  'MAX_LOANS_PER_STAFF',
] as const;

type LoanFields = {
  LOAN_MIN_AMOUNT: string;
  LOAN_MAX_AMOUNT: string;
  INTEREST_RATE_SHORT: string;
  INTEREST_RATE_LONG: string;
  ELIGIBILITY_MONTHS: string;
  LOAN_MAX_TENURE: string;
  MAX_LOANS_PER_STAFF: string;
};

function initLoan(cfg: ConfigMap): LoanFields {
  return {
    LOAN_MIN_AMOUNT:     cfg['LOAN_MIN_AMOUNT']?.value ?? '',
    LOAN_MAX_AMOUNT:     cfg['LOAN_MAX_AMOUNT']?.value ?? '',
    INTEREST_RATE_SHORT: cfg['INTEREST_RATE_SHORT']?.value ?? '',
    INTEREST_RATE_LONG:  cfg['INTEREST_RATE_LONG']?.value ?? '',
    ELIGIBILITY_MONTHS:  cfg['ELIGIBILITY_MONTHS']?.value ?? '',
    LOAN_MAX_TENURE:     cfg['LOAN_MAX_TENURE']?.value ?? '',
    MAX_LOANS_PER_STAFF: cfg['MAX_LOANS_PER_STAFF']?.value ?? '1',
  };
}

function LoansSection({ cfg, onUpdate, onDirtyChange, canEdit }: { cfg: ConfigMap; onUpdate: (next: ConfigMap) => void; onDirtyChange: (dirty: boolean) => void; canEdit: boolean }) {
  const [fields, setFields] = useState<LoanFields>(() => initLoan(cfg));
  const [saving, setSaving] = useState(false);

  const [original] = useState(() => initLoan(cfg));
  const dirty = (Object.keys(fields) as (keyof LoanFields)[]).some((k) => fields[k] !== original[k]);
  const meta = latestEntry(cfg, [...LOAN_KEYS]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  function set(k: keyof LoanFields) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setFields((prev) => ({ ...prev, [k]: e.target.value }));
  }

  async function save() {
    if (!dirty) return;
    const numericKeys: (keyof LoanFields)[] = [
      'LOAN_MIN_AMOUNT', 'LOAN_MAX_AMOUNT', 'INTEREST_RATE_SHORT',
      'INTEREST_RATE_LONG', 'ELIGIBILITY_MONTHS', 'LOAN_MAX_TENURE',
      'MAX_LOANS_PER_STAFF',
    ];
    for (const k of numericKeys) {
      if (isNaN(parseFloat(fields[k])) || parseFloat(fields[k]) <= 0) {
        toast.error(`${k.replace(/_/g, ' ').toLowerCase()} must be greater than 0`);
        return;
      }
    }
    if (parseFloat(fields.LOAN_MIN_AMOUNT) >= parseFloat(fields.LOAN_MAX_AMOUNT)) {
      toast.error('Minimum loan amount must be less than maximum');
      return;
    }
    setSaving(true);
    const updates: Record<string, string> = {};
    (Object.keys(fields) as (keyof LoanFields)[]).forEach((k) => {
      if (fields[k] !== original[k]) updates[k] = fields[k];
    });
    try {
      const next = await updateConfig(updates);
      onUpdate(next);
      setFields(initLoan(next));
      onDirtyChange(false);
      toast.success('Loan settings saved');
    } catch {
      toast.error('Failed to save loan settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Loans" meta={meta} onSave={save} saving={saving} dirty={dirty} canEdit={canEdit}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Minimum Loan Amount" required>
          <Input type="number" min={1} value={fields.LOAN_MIN_AMOUNT} onChange={set('LOAN_MIN_AMOUNT')} disabled={saving} prefix="₵" />
        </Field>
        <Field label="Maximum Loan Amount" required>
          <Input type="number" min={1} value={fields.LOAN_MAX_AMOUNT} onChange={set('LOAN_MAX_AMOUNT')} disabled={saving} prefix="₵" />
        </Field>
        <Field label="Interest Rate 1–6 Months" required>
          <Input type="number" min={0} step={0.1} value={fields.INTEREST_RATE_SHORT} onChange={set('INTEREST_RATE_SHORT')} disabled={saving} suffix="%" />
        </Field>
        <Field label="Interest Rate 7–12 Months" required>
          <Input type="number" min={0} step={0.1} value={fields.INTEREST_RATE_LONG} onChange={set('INTEREST_RATE_LONG')} disabled={saving} suffix="%" />
        </Field>
        <Field label="Eligibility Threshold" helper="Months of contributions required before a staff member can apply for a loan." required>
          <Input type="number" min={1} step={1} value={fields.ELIGIBILITY_MONTHS} onChange={set('ELIGIBILITY_MONTHS')} disabled={saving} suffix="months" />
        </Field>
        <Field label="Maximum Loan Tenure" required>
          <Input type="number" min={1} step={1} value={fields.LOAN_MAX_TENURE} onChange={set('LOAN_MAX_TENURE')} disabled={saving} suffix="months" />
        </Field>
        <Field label="Max Active Loans per Staff" helper="Staff at this limit are ineligible for new loans. Default: 1." required>
          <Input type="number" min={1} step={1} value={fields.MAX_LOANS_PER_STAFF} onChange={set('MAX_LOANS_PER_STAFF')} disabled={saving} />
        </Field>
      </div>
    </SectionCard>
  );
}

// ─── section: Guarantors ────────────────────────────────────────────────────

const GUARANTOR_KEYS = ['MAX_LOANS_PER_GUARANTOR'] as const;

function GuarantorsSection({ cfg, onUpdate, onDirtyChange, canEdit }: { cfg: ConfigMap; onUpdate: (next: ConfigMap) => void; onDirtyChange: (dirty: boolean) => void; canEdit: boolean }) {
  const [max, setMax] = useState(cfg['MAX_LOANS_PER_GUARANTOR']?.value ?? '');
  const [saving, setSaving] = useState(false);

  const [original] = useState(() => cfg['MAX_LOANS_PER_GUARANTOR']?.value ?? '');
  const dirty = max !== original;
  const meta = latestEntry(cfg, [...GUARANTOR_KEYS]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  async function save() {
    if (!dirty) return;
    if (parseInt(max) < 0) {
      toast.error('Max loans per guarantor cannot be negative');
      return;
    }
    setSaving(true);
    try {
      const next = await updateConfig({ MAX_LOANS_PER_GUARANTOR: max });
      onUpdate(next);
      setMax(next['MAX_LOANS_PER_GUARANTOR']?.value ?? max);
      onDirtyChange(false);
      toast.success('Guarantor settings saved');
    } catch {
      toast.error('Failed to save guarantor settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Guarantors" meta={meta} onSave={save} saving={saving} dirty={dirty} canEdit={canEdit}>
      <Field label="Max Active Loans Per Guarantor" helper="Set to 0 for unlimited (no restriction enforced).">
        <Input type="number" min={0} step={1} value={max} onChange={(e) => setMax(e.target.value)} disabled={saving} />
      </Field>
    </SectionCard>
  );
}

// ─── section: Payments ──────────────────────────────────────────────────────

const PAYMENT_KEYS = ['PAYMENT_DEADLINE_DAY', 'PENALTY_TYPE', 'PENALTY_VALUE'] as const;

type PaymentFields = {
  PAYMENT_DEADLINE_DAY: string;
  PENALTY_TYPE: string;
  PENALTY_VALUE: string;
};

function initPayment(cfg: ConfigMap): PaymentFields {
  return {
    PAYMENT_DEADLINE_DAY: cfg['PAYMENT_DEADLINE_DAY']?.value ?? '',
    PENALTY_TYPE:         cfg['PENALTY_TYPE']?.value ?? 'Fixed',
    PENALTY_VALUE:        cfg['PENALTY_VALUE']?.value ?? '',
  };
}

function PaymentsSection({ cfg, onUpdate, onDirtyChange, canEdit }: { cfg: ConfigMap; onUpdate: (next: ConfigMap) => void; onDirtyChange: (dirty: boolean) => void; canEdit: boolean }) {
  const [fields, setFields] = useState<PaymentFields>(() => initPayment(cfg));
  const [saving, setSaving] = useState(false);

  const [original] = useState(() => initPayment(cfg));
  const dirty = (Object.keys(fields) as (keyof PaymentFields)[]).some((k) => fields[k] !== original[k]);
  const meta = latestEntry(cfg, [...PAYMENT_KEYS]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  function setInput(k: keyof PaymentFields) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setFields((prev) => ({ ...prev, [k]: e.target.value }));
  }
  function setSelect(k: keyof PaymentFields) {
    return (e: React.ChangeEvent<HTMLSelectElement>) => setFields((prev) => ({ ...prev, [k]: e.target.value }));
  }

  async function save() {
    if (!dirty) return;
    const day = parseInt(fields.PAYMENT_DEADLINE_DAY);
    if (day < 1 || day > 28) {
      toast.error('Payment deadline day must be between 1 and 28');
      return;
    }
    if (parseFloat(fields.PENALTY_VALUE) < 0) {
      toast.error('Penalty value cannot be negative');
      return;
    }
    setSaving(true);
    const updates: Record<string, string> = {};
    (Object.keys(fields) as (keyof PaymentFields)[]).forEach((k) => {
      if (fields[k] !== original[k]) updates[k] = fields[k];
    });
    try {
      const next = await updateConfig(updates);
      onUpdate(next);
      setFields(initPayment(next));
      onDirtyChange(false);
      toast.success('Payment settings saved');
    } catch {
      toast.error('Failed to save payment settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Payments" meta={meta} onSave={save} saving={saving} dirty={dirty} canEdit={canEdit}>
      <Field label="Deadline Day of Month">
        <Input type="number" min={1} max={28} step={1} value={fields.PAYMENT_DEADLINE_DAY} onChange={setInput('PAYMENT_DEADLINE_DAY')} disabled={saving} />
      </Field>
      <Field label="Penalty Type">
        <Select
          value={fields.PENALTY_TYPE}
          onChange={setSelect('PENALTY_TYPE')}
          disabled={saving}
          options={[{ value: 'Fixed', label: 'Fixed' }, { value: 'Percentage', label: 'Percentage' }]}
        />
      </Field>
      <Field label="Penalty Value" helper="Set to 0 to disable penalties.">
        <Input type="number" min={0} step={0.01} value={fields.PENALTY_VALUE} onChange={setInput('PENALTY_VALUE')} disabled={saving} />
      </Field>
    </SectionCard>
  );
}

// ─── section: Email ─────────────────────────────────────────────────────────

const EMAIL_KEYS = [
  'EMAIL_PROVIDER', 'EMAIL_FROM_NAME', 'EMAIL_FROM_ADDRESS',
  'RESEND_API_KEY', 'OUTLOOK_HOST', 'OUTLOOK_PORT',
  'OUTLOOK_USERNAME', 'OUTLOOK_PASSWORD',
  'EMAIL_CONTRIBUTION_STATEMENT_CRON', 'EMAIL_LOAN_SCHEDULE_ENABLED',
] as const;

type EmailFields = {
  EMAIL_PROVIDER: string;
  EMAIL_FROM_NAME: string;
  EMAIL_FROM_ADDRESS: string;
  RESEND_API_KEY: string;
  OUTLOOK_HOST: string;
  OUTLOOK_PORT: string;
  OUTLOOK_USERNAME: string;
  OUTLOOK_PASSWORD: string;
  EMAIL_CONTRIBUTION_STATEMENT_CRON: string;
  EMAIL_LOAN_SCHEDULE_ENABLED: string;
};

function initEmail(cfg: ConfigMap): EmailFields {
  return {
    EMAIL_PROVIDER:                    cfg['EMAIL_PROVIDER']?.value ?? 'resend',
    EMAIL_FROM_NAME:                   cfg['EMAIL_FROM_NAME']?.value ?? '',
    EMAIL_FROM_ADDRESS:                cfg['EMAIL_FROM_ADDRESS']?.value ?? '',
    RESEND_API_KEY:                    cfg['RESEND_API_KEY']?.value ?? '',
    OUTLOOK_HOST:                      cfg['OUTLOOK_HOST']?.value ?? '',
    OUTLOOK_PORT:                      cfg['OUTLOOK_PORT']?.value ?? '',
    OUTLOOK_USERNAME:                  cfg['OUTLOOK_USERNAME']?.value ?? '',
    OUTLOOK_PASSWORD:                  cfg['OUTLOOK_PASSWORD']?.value ?? '',
    EMAIL_CONTRIBUTION_STATEMENT_CRON: cfg['EMAIL_CONTRIBUTION_STATEMENT_CRON']?.value ?? '0 8 1 1,4,7,10 *',
    EMAIL_LOAN_SCHEDULE_ENABLED:       cfg['EMAIL_LOAN_SCHEDULE_ENABLED']?.value ?? 'false',
  };
}

function EmailSection({ cfg, onUpdate, onDirtyChange, canEdit }: { cfg: ConfigMap; onUpdate: (next: ConfigMap) => void; onDirtyChange: (dirty: boolean) => void; canEdit: boolean }) {
  const [fields, setFields] = useState<EmailFields>(() => initEmail(cfg));
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [runningBulk, setRunningBulk] = useState(false);

  const [original] = useState(() => initEmail(cfg));
  const dirty = (Object.keys(fields) as (keyof EmailFields)[]).some((k) => fields[k] !== original[k]);
  const meta = latestEntry(cfg, [...EMAIL_KEYS]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  function setInput(k: keyof EmailFields) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setFields((prev) => ({ ...prev, [k]: e.target.value }));
  }
  function setSelectField(k: keyof EmailFields) {
    return (e: React.ChangeEvent<HTMLSelectElement>) => setFields((prev) => ({ ...prev, [k]: e.target.value }));
  }
  function toggleLoanSchedule(e: React.ChangeEvent<HTMLInputElement>) {
    setFields((prev) => ({ ...prev, EMAIL_LOAN_SCHEDULE_ENABLED: e.target.checked ? 'true' : 'false' }));
  }

  async function save() {
    if (!dirty) return;
    setSaving(true);
    const updates: Record<string, string> = {};
    (Object.keys(fields) as (keyof EmailFields)[]).forEach((k) => {
      if (fields[k] !== original[k]) updates[k] = fields[k];
    });
    try {
      const next = await updateConfig(updates);
      onUpdate(next);
      setFields(initEmail(next));
      onDirtyChange(false);
      toast.success('Email settings saved');
    } catch {
      toast.error('Failed to save email settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestEmail() {
    if (!testTo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo)) {
      toast.error('Enter a valid email address');
      return;
    }
    setTesting(true);
    try {
      await testEmail(fields.EMAIL_PROVIDER, testTo);
      toast.success('Test email sent successfully');
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.message ?? 'Failed to send test email';
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  }

  const isResend = fields.EMAIL_PROVIDER === 'resend';

  return (
    <SectionCard title="Email" meta={meta} onSave={save} saving={saving} dirty={dirty} canEdit={canEdit}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Email Provider">
          <Select
            value={fields.EMAIL_PROVIDER}
            onChange={setSelectField('EMAIL_PROVIDER')}
            disabled={saving}
            options={[{ value: 'resend', label: 'Resend' }, { value: 'outlook365', label: 'Outlook 365' }]}
          />
        </Field>
        <Field label="From Name">
          <Input type="text" value={fields.EMAIL_FROM_NAME} onChange={setInput('EMAIL_FROM_NAME')} disabled={saving} />
        </Field>
        <Field label="From Address">
          <Input type="email" value={fields.EMAIL_FROM_ADDRESS} onChange={setInput('EMAIL_FROM_ADDRESS')} disabled={saving} />
        </Field>
        <Field label="Contribution Statement Schedule">
          <Select
            value={fields.EMAIL_CONTRIBUTION_STATEMENT_CRON}
            onChange={setSelectField('EMAIL_CONTRIBUTION_STATEMENT_CRON')}
            disabled={saving}
            options={CRON_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
          />
        </Field>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <input
          id="loan-schedule-toggle"
          type="checkbox"
          checked={fields.EMAIL_LOAN_SCHEDULE_ENABLED === 'true'}
          onChange={toggleLoanSchedule}
          disabled={saving}
          className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
        />
        <label htmlFor="loan-schedule-toggle" className="text-sm font-medium text-neutral-700">
          Enable Loan Schedule Emails
        </label>
      </div>

      <div className="border-t border-neutral-100 pt-4">
        <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Provider Credentials</p>
        {isResend ? (
          <Field label="API Key">
            <Input type="password" value={fields.RESEND_API_KEY} onChange={setInput('RESEND_API_KEY')} disabled={saving} autoComplete="new-password" />
          </Field>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="SMTP Host">
              <Input type="text" value={fields.OUTLOOK_HOST} onChange={setInput('OUTLOOK_HOST')} disabled={saving} />
            </Field>
            <Field label="SMTP Port">
              <Input type="number" value={fields.OUTLOOK_PORT} onChange={setInput('OUTLOOK_PORT')} disabled={saving} />
            </Field>
            <Field label="SMTP Username">
              <Input type="text" value={fields.OUTLOOK_USERNAME} onChange={setInput('OUTLOOK_USERNAME')} disabled={saving} autoComplete="username" />
            </Field>
            <Field label="SMTP Password">
              <Input type="password" value={fields.OUTLOOK_PASSWORD} onChange={setInput('OUTLOOK_PASSWORD')} disabled={saving} autoComplete="new-password" />
            </Field>
          </div>
        )}
      </div>

      {canEdit && (
        <div className="border-t border-neutral-100 pt-4">
          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Send Test Email</p>
          <div className="flex items-center gap-3">
            <Input
              type="email"
              placeholder="Recipient email address"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              disabled={testing}
              className="flex-1"
            />
            <Button type="button" variant="secondary" onClick={handleTestEmail} disabled={testing || !testTo} loading={testing}>
              Send Test Email
            </Button>
          </div>
        </div>
      )}

      {canEdit && (
        <div className="border-t border-neutral-100 pt-4">
          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Bulk Actions</p>
          <div className="flex items-center gap-4">
            <Button
              type="button"
              variant="primary"
              onClick={async () => {
                setRunningBulk(true);
                try {
                  await runBulkAnnualStatement();
                  toast.success('Annual statement batch enqueued');
                } catch {
                  toast.error('Failed to enqueue annual statement batch');
                } finally {
                  setRunningBulk(false);
                }
              }}
              disabled={runningBulk}
              loading={runningBulk}
            >
              Run Annual Statement
            </Button>
            <p className="text-xs text-neutral-500">
              Sends contribution statements for the previous year to all active staff with email addresses.
            </p>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ─── section: Authentication ─────────────────────────────────────────────────

const AUTH_KEYS = ['AD_LOGIN_ENABLED'] as const;

function AuthenticationSection({ cfg, onUpdate, onDirtyChange, canEdit }: { cfg: ConfigMap; onUpdate: (next: ConfigMap) => void; onDirtyChange: (dirty: boolean) => void; canEdit: boolean }) {
  const [adEnabled, setAdEnabled] = useState(cfg['AD_LOGIN_ENABLED']?.value ?? 'true');
  const [saving, setSaving] = useState(false);

  const [original] = useState(() => cfg['AD_LOGIN_ENABLED']?.value ?? 'true');
  const dirty = adEnabled !== original;
  const meta = latestEntry(cfg, [...AUTH_KEYS]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  async function save() {
    if (!dirty) return;
    setSaving(true);
    try {
      const next = await updateConfig({ AD_LOGIN_ENABLED: adEnabled });
      onUpdate(next);
      onDirtyChange(false);
      toast.success('Authentication settings saved');
    } catch {
      toast.error('Failed to save authentication settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Authentication" meta={meta} onSave={save} saving={saving} dirty={dirty} canEdit={canEdit}>
      <Field label="Active Directory Login">
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={adEnabled === 'true'}
            disabled={saving || !canEdit}
            onClick={() => setAdEnabled(adEnabled === 'true' ? 'false' : 'true')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${adEnabled === 'true' ? 'bg-blue-600' : 'bg-neutral-300'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${adEnabled === 'true' ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
          <span className="text-sm text-neutral-700">
            {adEnabled === 'true' ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      </Field>
      <p className="text-xs text-neutral-500">
        When disabled, the login page shows only the local account form. AD/LDAP credentials will not be accepted.
      </p>
    </SectionCard>
  );
}

// ─── section: Security ──────────────────────────────────────────────────────

const SECURITY_KEYS = ['SESSION_IDLE_TIMEOUT_MINUTES'] as const;

function SecuritySection({ cfg, onUpdate, onDirtyChange, canEdit }: { cfg: ConfigMap; onUpdate: (next: ConfigMap) => void; onDirtyChange: (dirty: boolean) => void; canEdit: boolean }) {
  const [timeout, setTimeout_] = useState(cfg['SESSION_IDLE_TIMEOUT_MINUTES']?.value ?? '30');
  const [saving, setSaving] = useState(false);

  const [original] = useState(() => cfg['SESSION_IDLE_TIMEOUT_MINUTES']?.value ?? '30');
  const dirty = timeout !== original;
  const meta = latestEntry(cfg, [...SECURITY_KEYS]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  async function save() {
    if (!dirty) return;
    const mins = parseInt(timeout, 10);
    if (isNaN(mins) || mins < 5 || mins > 480) {
      toast.error('Idle timeout must be between 5 and 480 minutes');
      return;
    }
    setSaving(true);
    try {
      const next = await updateConfig({ SESSION_IDLE_TIMEOUT_MINUTES: timeout });
      onUpdate(next);
      setTimeout_(next['SESSION_IDLE_TIMEOUT_MINUTES']?.value ?? timeout);
      onDirtyChange(false);
      toast.success('Security settings saved');
    } catch {
      toast.error('Failed to save security settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Security" meta={meta} onSave={save} saving={saving} dirty={dirty} canEdit={canEdit}>
      <Field label="Session Idle Timeout (minutes)" required>
        <Input
          type="number"
          min={5}
          max={480}
          step={1}
          value={timeout}
          onChange={(e) => setTimeout_(e.target.value)}
          disabled={saving}
          suffix="min"
        />
      </Field>
      <p className="text-xs text-neutral-500">
        Users are automatically logged out after this many minutes of inactivity. Min 5, max 480 (8 hours).
      </p>
    </SectionCard>
  );
}

// ─── root client component ───────────────────────────────────────────────────

export function SettingsClient() {
  const permission = usePermission(AppModule.Settings);
  const canEdit = permission === 'full';
  const [cfg, setCfg] = useState<ConfigMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});

  const anyDirty = Object.values(dirtyMap).some(Boolean);

  const makeDirtyHandler = useCallback(
    (section: string) =>
      (dirty: boolean) =>
        setDirtyMap((prev) =>
          prev[section] === dirty ? prev : { ...prev, [section]: dirty },
        ),
    [],
  );

  useEffect(() => {
    getConfig()
      .then((data) => setCfg(data))
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!anyDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [anyDirty]);

  if (permission === 'none') {
    return (
      <div className="bg-danger-50 border border-danger-200 text-danger-700 px-4 py-3 rounded-sm text-sm">
        You do not have permission to view Settings.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3, 4, 5].map((i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  if (!cfg) {
    return (
      <div className="bg-danger-50 border border-danger-200 text-danger-700 px-4 py-3 rounded-sm text-sm">
        Failed to load settings. Please refresh the page.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <ContributionsSection cfg={cfg} onUpdate={setCfg} onDirtyChange={makeDirtyHandler('contributions')} canEdit={canEdit} />
      <LoansSection cfg={cfg} onUpdate={setCfg} onDirtyChange={makeDirtyHandler('loans')} canEdit={canEdit} />
      <GuarantorsSection cfg={cfg} onUpdate={setCfg} onDirtyChange={makeDirtyHandler('guarantors')} canEdit={canEdit} />
      <PaymentsSection cfg={cfg} onUpdate={setCfg} onDirtyChange={makeDirtyHandler('payments')} canEdit={canEdit} />
      <EmailSection cfg={cfg} onUpdate={setCfg} onDirtyChange={makeDirtyHandler('email')} canEdit={canEdit} />
      <AuthenticationSection cfg={cfg} onUpdate={setCfg} onDirtyChange={makeDirtyHandler('authentication')} canEdit={canEdit} />
      <SecuritySection cfg={cfg} onUpdate={setCfg} onDirtyChange={makeDirtyHandler('security')} canEdit={canEdit} />
    </div>
  );
}
