'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getConfig, updateConfig, testEmail, type ConfigMap } from '../../../lib/config';

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** Returns the most-recent updatedAt across a set of keys */
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
    <div className="bg-white rounded-lg shadow-sm p-6 animate-pulse">
      <div className="h-5 bg-gray-200 rounded w-48 mb-6" />
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i}>
            <div className="h-3 bg-gray-200 rounded w-32 mb-2" />
            <div className="h-9 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
      <div className="mt-6 flex justify-end">
        <div className="h-9 bg-gray-200 rounded w-20" />
      </div>
    </div>
  );
}

interface SectionCardProps {
  title: string;
  meta: { updatedBy: string; updatedAt: string } | null;
  children: React.ReactNode;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
}

function SectionCard({ title, meta, children, onSave, saving, dirty }: SectionCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="flex items-start justify-between mb-5">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {meta && (
          <span className="text-xs text-gray-400 mt-0.5">
            Last updated by {meta.updatedBy} on {fmt(meta.updatedAt)}
          </span>
        )}
      </div>
      <div className="space-y-4">{children}</div>
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  helper?: string;
  children: React.ReactNode;
}

function Field({ label, helper, children }: FieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {helper && <p className="mt-1 text-xs text-gray-500">{helper}</p>}
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50';

const selectCls =
  'w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50';

// ─── cron presets ───────────────────────────────────────────────────────────

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: '1st of month, 9am', value: '0 9 1 * *' },
  { label: '5th of month, 9am', value: '0 9 5 * *' },
  { label: '10th of month, 9am', value: '0 9 10 * *' },
  { label: '15th of month, 9am', value: '0 9 15 * *' },
  { label: 'Last day of month, 9am', value: '0 9 28 * *' },
  { label: 'Weekly Monday 9am', value: '0 9 * * 1' },
];

// ─── section: Contributions ─────────────────────────────────────────────────

const CONTRIBUTION_KEYS = ['MONTHLY_CONTRIBUTION_AMOUNT'] as const;

function ContributionsSection({ cfg, onUpdate, onDirtyChange }: { cfg: ConfigMap; onUpdate: (next: ConfigMap) => void; onDirtyChange: (dirty: boolean) => void }) {
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
    <SectionCard title="Contributions" meta={meta} onSave={save} saving={saving} dirty={dirty}>
      <Field label="Monthly Contribution Amount (GHS)">
        <input
          type="number"
          min={1}
          step={0.01}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={saving}
          className={inputCls}
        />
      </Field>
    </SectionCard>
  );
}

// ─── section: Loans ─────────────────────────────────────────────────────────

const LOAN_KEYS = [
  'LOAN_MIN_AMOUNT',
  'LOAN_MAX_AMOUNT',
  'INTEREST_RATE_SHORT',
  'INTEREST_RATE_LONG',
  'ELIGIBILITY_MONTHS',
  'LOAN_MAX_TENURE',
] as const;

type LoanFields = {
  LOAN_MIN_AMOUNT: string;
  LOAN_MAX_AMOUNT: string;
  INTEREST_RATE_SHORT: string;
  INTEREST_RATE_LONG: string;
  ELIGIBILITY_MONTHS: string;
  LOAN_MAX_TENURE: string;
};

function initLoan(cfg: ConfigMap): LoanFields {
  return {
    LOAN_MIN_AMOUNT: cfg['LOAN_MIN_AMOUNT']?.value ?? '',
    LOAN_MAX_AMOUNT: cfg['LOAN_MAX_AMOUNT']?.value ?? '',
    INTEREST_RATE_SHORT: cfg['INTEREST_RATE_SHORT']?.value ?? '',
    INTEREST_RATE_LONG: cfg['INTEREST_RATE_LONG']?.value ?? '',
    ELIGIBILITY_MONTHS: cfg['ELIGIBILITY_MONTHS']?.value ?? '',
    LOAN_MAX_TENURE: cfg['LOAN_MAX_TENURE']?.value ?? '',
  };
}

function LoansSection({ cfg, onUpdate, onDirtyChange }: { cfg: ConfigMap; onUpdate: (next: ConfigMap) => void; onDirtyChange: (dirty: boolean) => void }) {
  const [fields, setFields] = useState<LoanFields>(() => initLoan(cfg));
  const [saving, setSaving] = useState(false);

  const [original] = useState(() => initLoan(cfg));
  const dirty = (Object.keys(fields) as (keyof LoanFields)[]).some((k) => fields[k] !== original[k]);
  const meta = latestEntry(cfg, [...LOAN_KEYS]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  function set(k: keyof LoanFields) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setFields((prev) => ({ ...prev, [k]: e.target.value }));
  }

  async function save() {
    if (!dirty) return;
    const numericKeys: (keyof LoanFields)[] = [
      'LOAN_MIN_AMOUNT', 'LOAN_MAX_AMOUNT', 'INTEREST_RATE_SHORT',
      'INTEREST_RATE_LONG', 'ELIGIBILITY_MONTHS', 'LOAN_MAX_TENURE',
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
    <SectionCard title="Loans" meta={meta} onSave={save} saving={saving} dirty={dirty}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Minimum Loan Amount (GHS)">
          <input type="number" min={1} value={fields.LOAN_MIN_AMOUNT} onChange={set('LOAN_MIN_AMOUNT')} disabled={saving} className={inputCls} />
        </Field>
        <Field label="Maximum Loan Amount (GHS)">
          <input type="number" min={1} value={fields.LOAN_MAX_AMOUNT} onChange={set('LOAN_MAX_AMOUNT')} disabled={saving} className={inputCls} />
        </Field>
        <Field label="Interest Rate 1–6 Months (%)">
          <input type="number" min={0} step={0.1} value={fields.INTEREST_RATE_SHORT} onChange={set('INTEREST_RATE_SHORT')} disabled={saving} className={inputCls} />
        </Field>
        <Field label="Interest Rate 7–12 Months (%)">
          <input type="number" min={0} step={0.1} value={fields.INTEREST_RATE_LONG} onChange={set('INTEREST_RATE_LONG')} disabled={saving} className={inputCls} />
        </Field>
        <Field label="Eligibility Threshold (months)">
          <input type="number" min={1} step={1} value={fields.ELIGIBILITY_MONTHS} onChange={set('ELIGIBILITY_MONTHS')} disabled={saving} className={inputCls} />
        </Field>
        <Field label="Maximum Loan Tenure (months)">
          <input type="number" min={1} step={1} value={fields.LOAN_MAX_TENURE} onChange={set('LOAN_MAX_TENURE')} disabled={saving} className={inputCls} />
        </Field>
      </div>
    </SectionCard>
  );
}

// ─── section: Guarantors ────────────────────────────────────────────────────

const GUARANTOR_KEYS = ['MAX_LOANS_PER_GUARANTOR'] as const;

function GuarantorsSection({ cfg, onUpdate, onDirtyChange }: { cfg: ConfigMap; onUpdate: (next: ConfigMap) => void; onDirtyChange: (dirty: boolean) => void }) {
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
    <SectionCard title="Guarantors" meta={meta} onSave={save} saving={saving} dirty={dirty}>
      <Field
        label="Max Active Loans Per Guarantor"
        helper="Set to 0 for unlimited (no restriction enforced)."
      >
        <input
          type="number"
          min={0}
          step={1}
          value={max}
          onChange={(e) => setMax(e.target.value)}
          disabled={saving}
          className={inputCls}
        />
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
    PENALTY_TYPE: cfg['PENALTY_TYPE']?.value ?? 'Fixed',
    PENALTY_VALUE: cfg['PENALTY_VALUE']?.value ?? '',
  };
}

function PaymentsSection({ cfg, onUpdate, onDirtyChange }: { cfg: ConfigMap; onUpdate: (next: ConfigMap) => void; onDirtyChange: (dirty: boolean) => void }) {
  const [fields, setFields] = useState<PaymentFields>(() => initPayment(cfg));
  const [saving, setSaving] = useState(false);

  const [original] = useState(() => initPayment(cfg));
  const dirty = (Object.keys(fields) as (keyof PaymentFields)[]).some((k) => fields[k] !== original[k]);
  const meta = latestEntry(cfg, [...PAYMENT_KEYS]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  function set(k: keyof PaymentFields) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setFields((prev) => ({ ...prev, [k]: e.target.value }));
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
    <SectionCard title="Payments" meta={meta} onSave={save} saving={saving} dirty={dirty}>
      <Field label="Deadline Day of Month">
        <input
          type="number"
          min={1}
          max={28}
          step={1}
          value={fields.PAYMENT_DEADLINE_DAY}
          onChange={set('PAYMENT_DEADLINE_DAY')}
          disabled={saving}
          className={inputCls}
        />
      </Field>
      <Field label="Penalty Type">
        <select
          value={fields.PENALTY_TYPE}
          onChange={set('PENALTY_TYPE')}
          disabled={saving}
          className={selectCls}
        >
          <option value="Fixed">Fixed</option>
          <option value="Percentage">Percentage</option>
        </select>
      </Field>
      <Field label="Penalty Value" helper="Set to 0 to disable penalties.">
        <input
          type="number"
          min={0}
          step={0.01}
          value={fields.PENALTY_VALUE}
          onChange={set('PENALTY_VALUE')}
          disabled={saving}
          className={inputCls}
        />
      </Field>
    </SectionCard>
  );
}

// ─── section: Email ─────────────────────────────────────────────────────────

const EMAIL_KEYS = [
  'EMAIL_PROVIDER',
  'EMAIL_FROM_NAME',
  'EMAIL_FROM_ADDRESS',
  'RESEND_API_KEY',
  'OUTLOOK_HOST',
  'OUTLOOK_PORT',
  'OUTLOOK_USERNAME',
  'OUTLOOK_PASSWORD',
  'EMAIL_CONTRIBUTION_STATEMENT_CRON',
  'EMAIL_LOAN_SCHEDULE_ENABLED',
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
    EMAIL_PROVIDER: cfg['EMAIL_PROVIDER']?.value ?? 'resend',
    EMAIL_FROM_NAME: cfg['EMAIL_FROM_NAME']?.value ?? '',
    EMAIL_FROM_ADDRESS: cfg['EMAIL_FROM_ADDRESS']?.value ?? '',
    RESEND_API_KEY: cfg['RESEND_API_KEY']?.value ?? '',
    OUTLOOK_HOST: cfg['OUTLOOK_HOST']?.value ?? '',
    OUTLOOK_PORT: cfg['OUTLOOK_PORT']?.value ?? '',
    OUTLOOK_USERNAME: cfg['OUTLOOK_USERNAME']?.value ?? '',
    OUTLOOK_PASSWORD: cfg['OUTLOOK_PASSWORD']?.value ?? '',
    EMAIL_CONTRIBUTION_STATEMENT_CRON:
      cfg['EMAIL_CONTRIBUTION_STATEMENT_CRON']?.value ?? CRON_PRESETS[0].value,
    EMAIL_LOAN_SCHEDULE_ENABLED: cfg['EMAIL_LOAN_SCHEDULE_ENABLED']?.value ?? 'false',
  };
}

function EmailSection({ cfg, onUpdate, onDirtyChange }: { cfg: ConfigMap; onUpdate: (next: ConfigMap) => void; onDirtyChange: (dirty: boolean) => void }) {
  const [fields, setFields] = useState<EmailFields>(() => initEmail(cfg));
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);

  const [original] = useState(() => initEmail(cfg));
  const dirty = (Object.keys(fields) as (keyof EmailFields)[]).some((k) => fields[k] !== original[k]);
  const meta = latestEntry(cfg, [...EMAIL_KEYS]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  function setField(k: keyof EmailFields) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setFields((prev) => ({ ...prev, [k]: e.target.value }));
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
    } catch {
      toast.error('Failed to send test email');
    } finally {
      setTesting(false);
    }
  }

  const isResend = fields.EMAIL_PROVIDER === 'resend';

  return (
    <SectionCard title="Email" meta={meta} onSave={save} saving={saving} dirty={dirty}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Email Provider">
          <select value={fields.EMAIL_PROVIDER} onChange={setField('EMAIL_PROVIDER')} disabled={saving} className={selectCls}>
            <option value="resend">Resend</option>
            <option value="outlook365">Outlook 365</option>
          </select>
        </Field>
        <Field label="From Name">
          <input type="text" value={fields.EMAIL_FROM_NAME} onChange={setField('EMAIL_FROM_NAME')} disabled={saving} className={inputCls} />
        </Field>
        <Field label="From Address">
          <input type="email" value={fields.EMAIL_FROM_ADDRESS} onChange={setField('EMAIL_FROM_ADDRESS')} disabled={saving} className={inputCls} />
        </Field>
        <Field label="Contribution Statement Schedule">
          <select value={fields.EMAIL_CONTRIBUTION_STATEMENT_CRON} onChange={setField('EMAIL_CONTRIBUTION_STATEMENT_CRON')} disabled={saving} className={selectCls}>
            {CRON_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Toggle */}
      <div className="flex items-center gap-3 mt-2">
        <input
          id="loan-schedule-toggle"
          type="checkbox"
          checked={fields.EMAIL_LOAN_SCHEDULE_ENABLED === 'true'}
          onChange={toggleLoanSchedule}
          disabled={saving}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="loan-schedule-toggle" className="text-sm font-medium text-gray-700">
          Enable Loan Schedule Emails
        </label>
      </div>

      {/* Conditional credentials */}
      <div className="mt-4 border-t pt-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Provider Credentials</p>
        {isResend ? (
          <Field label="API Key">
            <input type="password" value={fields.RESEND_API_KEY} onChange={setField('RESEND_API_KEY')} disabled={saving} autoComplete="new-password" className={inputCls} />
          </Field>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="SMTP Host">
              <input type="text" value={fields.OUTLOOK_HOST} onChange={setField('OUTLOOK_HOST')} disabled={saving} className={inputCls} />
            </Field>
            <Field label="SMTP Port">
              <input type="number" value={fields.OUTLOOK_PORT} onChange={setField('OUTLOOK_PORT')} disabled={saving} className={inputCls} />
            </Field>
            <Field label="SMTP Username">
              <input type="text" value={fields.OUTLOOK_USERNAME} onChange={setField('OUTLOOK_USERNAME')} disabled={saving} autoComplete="username" className={inputCls} />
            </Field>
            <Field label="SMTP Password">
              <input type="password" value={fields.OUTLOOK_PASSWORD} onChange={setField('OUTLOOK_PASSWORD')} disabled={saving} autoComplete="new-password" className={inputCls} />
            </Field>
          </div>
        )}
      </div>

      {/* Test email */}
      <div className="mt-4 border-t pt-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Send Test Email</p>
        <div className="flex items-center gap-3">
          <input
            type="email"
            placeholder="Recipient email address"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            disabled={testing}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
          />
          <button
            type="button"
            onClick={handleTestEmail}
            disabled={testing || !testTo}
            className="px-4 py-2 bg-gray-700 text-white text-sm font-medium rounded-md hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {testing ? 'Sending…' : 'Send Test Email'}
          </button>
        </div>
      </div>
    </SectionCard>
  );
}

// ─── root client component ───────────────────────────────────────────────────

export function SettingsClient() {
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

  // Unsaved changes warning — only fires when at least one section is dirty.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!anyDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [anyDirty]);

  if (loading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3, 4, 5].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (!cfg) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
        Failed to load settings. Please refresh the page.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ContributionsSection cfg={cfg} onUpdate={setCfg} onDirtyChange={makeDirtyHandler('contributions')} />
      <LoansSection cfg={cfg} onUpdate={setCfg} onDirtyChange={makeDirtyHandler('loans')} />
      <GuarantorsSection cfg={cfg} onUpdate={setCfg} onDirtyChange={makeDirtyHandler('guarantors')} />
      <PaymentsSection cfg={cfg} onUpdate={setCfg} onDirtyChange={makeDirtyHandler('payments')} />
      <EmailSection cfg={cfg} onUpdate={setCfg} onDirtyChange={makeDirtyHandler('email')} />
    </div>
  );
}
