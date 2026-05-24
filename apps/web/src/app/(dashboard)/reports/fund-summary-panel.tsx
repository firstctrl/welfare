'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Banknote, TrendingUp, AlertCircle, BarChart3, Users, ChevronDown, ChevronRight, Download } from 'lucide-react';
import { getFundSummary, buildFundSummaryDownloadUrl } from '@/lib/reports';
import type { FundSummaryParams } from '@/lib/reports';
import type {
  IFundSummaryContributionBreakdownRow,
  IFundSummaryLoanBreakdownRow,
  IFundSummaryDefaultRow,
} from '@welfare/shared';
import { KpiCard } from '@/components/ui/kpi-card';
import { Field, Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { fmtGHS, fmtGHSShort } from '@/lib/format';
import { cn } from '@/lib/utils';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CUR_YEAR = new Date().getFullYear();

// ── Column defs ────────────────────────────────────────────────────────────────

const colContrib = createColumnHelper<IFundSummaryContributionBreakdownRow>();
const COLS_CONTRIB = [
  colContrib.accessor('month', { header: 'Month', cell: i => MONTHS[i.getValue() - 1] }),
  colContrib.accessor('year', { header: 'Year' }),
  colContrib.accessor('totalExpected',  { header: 'Expected (GHS)',  cell: i => fmtGHS(i.getValue()) }),
  colContrib.accessor('totalCollected', { header: 'Collected (GHS)', cell: i => fmtGHS(i.getValue()) }),
  colContrib.accessor('missedCount',  { header: 'Missed' }),
  colContrib.accessor('partialCount', { header: 'Partial' }),
];

const colLoan = createColumnHelper<IFundSummaryLoanBreakdownRow>();
const COLS_LOANS = [
  colLoan.accessor('status',      { header: 'Status' }),
  colLoan.accessor('count',       { header: 'Count' }),
  colLoan.accessor('totalAmount', { header: 'Total (GHS)', cell: i => fmtGHS(i.getValue()) }),
];

const colDefault = createColumnHelper<IFundSummaryDefaultRow>();
const COLS_DEFAULTS = [
  colDefault.accessor('staffName',       { header: 'Staff Name' }),
  colDefault.accessor('principalAmount', { header: 'Principal (GHS)', cell: i => fmtGHS(i.getValue()) }),
  colDefault.accessor('totalRecovered',  { header: 'Recovered (GHS)', cell: i => fmtGHS(i.getValue()) }),
  colDefault.accessor('badDebtAmount',   { header: 'Bad Debt (GHS)',  cell: i => fmtGHS(i.getValue()) }),
  colDefault.accessor('settledAt',       { header: 'Settled At', cell: i => i.getValue() ? new Date(i.getValue()).toLocaleDateString('en-GB') : '—' }),
];

// ── Generic table ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SummaryTable<T>({ columns, data }: { columns: any[]; data: T[] }) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          {table.getHeaderGroups().map(hg => (
            <tr key={hg.id} className="border-b border-neutral-200 bg-neutral-50">
              {hg.headers.map(h => (
                <th key={h.id} className="px-3 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap">
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-neutral-400">No data</td>
            </tr>
          ) : (
            table.getRowModel().rows.map(row => (
              <tr key={row.id} className="hover:bg-neutral-50">
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="px-3 py-2 whitespace-nowrap text-neutral-700">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Collapsible section ────────────────────────────────────────────────────────

function Section({
  title,
  downloadLinks,
  children,
}: {
  title: string;
  downloadLinks?: { label: string; href: string }[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-neutral-200 rounded-md overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-2.5 bg-neutral-50 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          {open
            ? <ChevronDown size={14} className="text-neutral-400" />
            : <ChevronRight size={14} className="text-neutral-400" />}
          <span className="text-sm font-semibold text-neutral-700">{title}</span>
        </div>
        {downloadLinks && (
          <div className="flex gap-2" onClick={e => e.stopPropagation()}>
            {downloadLinks.map(l => (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary" size="sm" Icon={Download}>{l.label}</Button>
              </a>
            ))}
          </div>
        )}
      </div>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

type FilterMode = 'full' | 'quarter' | 'range';

export function FundSummaryPanel() {
  const [year,      setYear]      = useState(CUR_YEAR);
  const [mode,      setMode]      = useState<FilterMode>('full');
  const [quarter,   setQuarter]   = useState<1|2|3|4>(1);
  const [fromMonth, setFromMonth] = useState(1);
  const [toMonth,   setToMonth]   = useState(12);

  const params: FundSummaryParams = {
    year,
    ...(mode === 'quarter' ? { quarter } : {}),
    ...(mode === 'range'   ? { fromMonth, toMonth } : {}),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['fund-summary', params],
    queryFn:  () => getFundSummary(params),
  });

  const monthOptions = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));

  return (
    <div className="space-y-6">
      {/* All-time overview — unaffected by filters */}
      {data && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-3">
            All-Time Fund Overview
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Net Fund Balance"
              value={fmtGHSShort(data.fundBalance.netBalance)}
              title={fmtGHS(data.fundBalance.netBalance)}
              icon={TrendingUp}
              iconKind={data.fundBalance.netBalance >= 0 ? 'success' : 'danger'}
            />
            <KpiCard
              label="Total Contributions"
              value={fmtGHSShort(data.fundBalance.totalContributionsAllTime)}
              title={fmtGHS(data.fundBalance.totalContributionsAllTime)}
              icon={Banknote}
              iconKind="success"
            />
            <KpiCard
              label="Total Disbursed"
              value={fmtGHSShort(data.fundBalance.totalDisbursedAllTime)}
              title={fmtGHS(data.fundBalance.totalDisbursedAllTime)}
              icon={Banknote}
              iconKind="primary"
            />
            <KpiCard
              label="Active Members"
              value={String(data.membership.activeCount)}
              icon={Users}
              iconKind="primary"
            />
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-4 p-4 bg-neutral-50 border border-neutral-200 rounded-md">
        <Field label="Year">
          <Input
            type="number"
            value={year}
            onChange={(e) => setYear(+e.target.value)}
            style={{ width: 100 }}
          />
        </Field>

        <Field label="Period">
          <div className="flex gap-1">
            {(['full', 'quarter', 'range'] as FilterMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'px-3 h-[var(--row-default)] rounded-sm text-sm font-medium border transition-colors',
                  mode === m
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-100',
                )}
              >
                {m === 'full' ? 'Full Year' : m === 'quarter' ? 'Quarter' : 'Month Range'}
              </button>
            ))}
          </div>
        </Field>

        {mode === 'quarter' && (
          <Field label="Quarter">
            <div className="flex gap-1">
              {([1, 2, 3, 4] as const).map((q) => (
                <button
                  key={q}
                  onClick={() => setQuarter(q)}
                  className={cn(
                    'w-10 h-[var(--row-default)] rounded-sm text-sm font-medium border transition-colors',
                    quarter === q
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-100',
                  )}
                >
                  Q{q}
                </button>
              ))}
            </div>
          </Field>
        )}

        {mode === 'range' && (
          <>
            <Field label="From">
              <Select
                value={String(fromMonth)}
                onChange={(e) => setFromMonth(+e.target.value)}
                options={monthOptions}
                style={{ width: 110 }}
              />
            </Field>
            <Field label="To">
              <Select
                value={String(toMonth)}
                onChange={(e) => setToMonth(+e.target.value)}
                options={monthOptions}
                style={{ width: 110 }}
              />
            </Field>
          </>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-neutral-400 text-sm">
          Loading…
        </div>
      )}

      {data && (
        <>
          {/* Period-filtered KPIs */}
          <div>
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-3">
              Period Summary
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard
                label="Contributions"
                value={fmtGHSShort(data.contributions.totalCollected)}
                title={fmtGHS(data.contributions.totalCollected)}
                subtext={`Expected: ${fmtGHSShort(data.contributions.totalExpected)}`}
                icon={Banknote}
                iconKind="success"
              />
              <KpiCard
                label="Collection Rate"
                value={`${data.contributions.collectionRate}%`}
                subtext={`${data.contributions.missedCount} missed · ${data.contributions.partialCount} partial`}
                icon={BarChart3}
                iconKind={
                  data.contributions.collectionRate >= 90
                    ? 'success'
                    : data.contributions.collectionRate >= 70
                      ? 'warning'
                      : 'danger'
                }
              />
              <KpiCard
                label="Loans Disbursed"
                value={fmtGHSShort(data.loans.disbursedAmount)}
                title={fmtGHS(data.loans.disbursedAmount)}
                subtext={`${data.loans.disbursedCount} loans`}
                icon={Banknote}
                iconKind="primary"
              />
              <KpiCard
                label="Defaulted Loans"
                value={fmtGHSShort(data.loans.defaultedAmount)}
                title={fmtGHS(data.loans.defaultedAmount)}
                subtext={`${data.loans.defaultedCount} loans`}
                icon={AlertCircle}
                iconKind={data.loans.defaultedCount === 0 ? 'success' : 'danger'}
              />
              <KpiCard
                label="Recovery Rate"
                value={`${data.recovery.recoveryRate}%`}
                subtext={`Recovered: ${fmtGHSShort(data.recovery.totalRecovered)}`}
                icon={BarChart3}
                iconKind={
                  data.recovery.recoveryRate >= 80
                    ? 'success'
                    : data.recovery.recoveryRate >= 50
                      ? 'warning'
                      : 'danger'
                }
              />
              <KpiCard
                label="Active Loans"
                value={fmtGHSShort(data.loans.activeAmount)}
                title={fmtGHS(data.loans.activeAmount)}
                subtext={`${data.loans.activeCount} loans outstanding`}
                icon={TrendingUp}
                iconKind="warning"
              />
              <KpiCard
                label="New Joiners"
                value={String(data.membership.joinersInPeriod)}
                icon={Users}
                iconKind="success"
              />
              <KpiCard
                label="Exits"
                value={String(data.membership.exitsInPeriod)}
                icon={Users}
                iconKind={data.membership.exitsInPeriod === 0 ? 'success' : 'warning'}
              />
            </div>
          </div>

          {/* Detail tables */}
          <div className="space-y-3">
            <Section
              title="Contributions Breakdown"
              downloadLinks={[
                { label: 'CSV', href: buildFundSummaryDownloadUrl('contributions', params, 'csv') },
              ]}
            >
              <SummaryTable columns={COLS_CONTRIB} data={data.contributionBreakdown} />
            </Section>

            <Section
              title="Loans Breakdown"
              downloadLinks={[
                { label: 'CSV', href: buildFundSummaryDownloadUrl('loans', params, 'csv') },
                { label: 'PDF', href: buildFundSummaryDownloadUrl('loans', params, 'pdf') },
              ]}
            >
              <SummaryTable columns={COLS_LOANS} data={data.loanBreakdown} />
            </Section>

            <Section
              title="Defaulted Loans Detail"
              downloadLinks={[
                { label: 'CSV', href: buildFundSummaryDownloadUrl('defaults', params, 'csv') },
                { label: 'PDF', href: buildFundSummaryDownloadUrl('defaults', params, 'pdf') },
              ]}
            >
              <SummaryTable columns={COLS_DEFAULTS} data={data.defaultDetails} />
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
