'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Download } from 'lucide-react';
import {
  getMonthlyContributions,
  getArrears,
  getGuarantorOffsets,
  getActiveLoans,
  getOverdueLoans,
  getRepaidLoans,
  getGuarantorExposure,
  getBadDebt,
  getExitClearance,
  buildDownloadUrl,
} from '@/lib/reports';
import type {
  IMonthlyContributionRow,
  IArrearRow,
  IGuarantorOffsetRow,
  IActiveLoanRow,
  IOverdueLoanRow,
  IRepaidLoanRow,
  IGuarantorExposureRow,
  IBadDebtRow,
  IExitClearanceRow,
} from '@welfare/shared';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { fmtGHS, fmtDate } from '@/lib/format';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const now = new Date();
const CUR_MONTH = now.getMonth() + 1;
const CUR_YEAR = now.getFullYear();

// ── Column definitions ────────────────────────────────────────────────────────

const colContrib = createColumnHelper<IMonthlyContributionRow>();
const COLS_CONTRIB = [
  colContrib.accessor('staffName', { header: 'Staff Name' }),
  colContrib.accessor('staffNo', { header: 'Staff No' }),
  colContrib.accessor('expectedAmount', { header: 'Expected', cell: i => fmtGHS(i.getValue()) }),
  colContrib.accessor('paidAmount', { header: 'Paid', cell: i => fmtGHS(i.getValue()) }),
  colContrib.accessor('surplusCarriedForward', { header: 'Surplus C/F', cell: i => fmtGHS(i.getValue()) }),
  colContrib.accessor('status', { header: 'Status' }),
];

const colArrear = createColumnHelper<IArrearRow>();
const COLS_ARREARS = [
  colArrear.accessor('staffName', { header: 'Staff Name' }),
  colArrear.accessor('staffNo', { header: 'Staff No' }),
  colArrear.accessor('month', { header: 'Month', cell: i => MONTHS[i.getValue() - 1] }),
  colArrear.accessor('year', { header: 'Year' }),
  colArrear.accessor('expectedAmount', { header: 'Expected', cell: i => fmtGHS(i.getValue()) }),
  colArrear.accessor('paidAmount', { header: 'Paid', cell: i => fmtGHS(i.getValue()) }),
  colArrear.accessor('shortfall', { header: 'Shortfall', cell: i => fmtGHS(i.getValue()) }),
  colArrear.accessor('status', { header: 'Status' }),
];

const colOffset = createColumnHelper<IGuarantorOffsetRow>();
const COLS_OFFSETS = [
  colOffset.accessor('guarantorName', { header: 'Guarantor' }),
  colOffset.accessor('borrowerName', { header: 'Borrower' }),
  colOffset.accessor('instalmentNumber', { header: 'Instalment #' }),
  colOffset.accessor('offsetAmount', { header: 'Offset', cell: i => fmtGHS(i.getValue()) }),
  colOffset.accessor('offsetDate', { header: 'Date', cell: i => fmtDate(new Date(i.getValue())) }),
];

const colActive = createColumnHelper<IActiveLoanRow>();
const COLS_ACTIVE = [
  colActive.accessor('staffName', { header: 'Staff Name' }),
  colActive.accessor('staffNo', { header: 'Staff No' }),
  colActive.accessor('guarantorName', { header: 'Guarantor' }),
  colActive.accessor('principalAmount', { header: 'Principal', cell: i => fmtGHS(i.getValue()) }),
  colActive.accessor('outstandingBalance', { header: 'Outstanding', cell: i => fmtGHS(i.getValue()) }),
  colActive.accessor('disbursedDate', { header: 'Disbursed', cell: i => fmtDate(new Date(i.getValue())) }),
];

const colOverdue = createColumnHelper<IOverdueLoanRow>();
const COLS_OVERDUE = [
  colOverdue.accessor('staffName', { header: 'Staff Name' }),
  colOverdue.accessor('instalmentNumber', { header: 'Instalment #' }),
  colOverdue.accessor('dueDate', { header: 'Due Date', cell: i => fmtDate(new Date(i.getValue())) }),
  colOverdue.accessor('dueAmount', { header: 'Due', cell: i => fmtGHS(i.getValue()) }),
  colOverdue.accessor('paidAmount', { header: 'Paid', cell: i => fmtGHS(i.getValue()) }),
  colOverdue.accessor('penaltyAmount', { header: 'Penalty', cell: i => fmtGHS(i.getValue()) }),
  colOverdue.accessor('daysOverdue', { header: 'Days Overdue' }),
];

const colRepaid = createColumnHelper<IRepaidLoanRow>();
const COLS_REPAID = [
  colRepaid.accessor('staffName', { header: 'Staff Name' }),
  colRepaid.accessor('principalAmount', { header: 'Principal', cell: i => fmtGHS(i.getValue()) }),
  colRepaid.accessor('totalRepayable', { header: 'Total Repaid', cell: i => fmtGHS(i.getValue()) }),
  colRepaid.accessor('disbursedDate', { header: 'Disbursed', cell: i => fmtDate(new Date(i.getValue())) }),
  colRepaid.accessor('settledAt', { header: 'Settled', cell: i => fmtDate(new Date(i.getValue())) }),
  colRepaid.accessor('tenureMonths', { header: 'Tenure (mo)' }),
];

const colExposure = createColumnHelper<IGuarantorExposureRow>();
const COLS_EXPOSURE = [
  colExposure.accessor('guarantorName', { header: 'Guarantor' }),
  colExposure.accessor('guarantorStaffNo', { header: 'Staff No' }),
  colExposure.accessor('activeLoansCount', { header: 'Active Loans' }),
  colExposure.accessor('totalOutstanding', { header: 'Total Outstanding', cell: i => fmtGHS(i.getValue() as number) }),
  colExposure.accessor('totalOffsetAmount', { header: 'Offset Paid', cell: i => fmtGHS(i.getValue() as number) }),
];

const colBad = createColumnHelper<IBadDebtRow>();
const COLS_BAD = [
  colBad.accessor('staffName', { header: 'Staff Name' }),
  colBad.accessor('principalAmount', { header: 'Principal', cell: i => fmtGHS(i.getValue()) }),
  colBad.accessor('exitDeductionAmount', { header: 'Exit Deduction', cell: i => fmtGHS(i.getValue()) }),
  colBad.accessor('guarantorOffsetAmount', { header: 'Guarantor Offset', cell: i => fmtGHS(i.getValue()) }),
  colBad.accessor('badDebtAmount', { header: 'Bad Debt', cell: i => fmtGHS(i.getValue()) }),
  colBad.accessor('settledAt', { header: 'Settled At', cell: i => fmtDate(new Date(i.getValue())) }),
];

const colExit = createColumnHelper<IExitClearanceRow>();
const COLS_EXIT = [
  colExit.accessor('staffName', { header: 'Staff Name' }),
  colExit.accessor('staffNo', { header: 'Staff No' }),
  colExit.accessor('status', { header: 'Status' }),
  colExit.accessor('outstandingLoanBalance', { header: 'Outstanding Loans', cell: i => fmtGHS(i.getValue()) }),
  colExit.accessor('missedContributionsCount', { header: 'Missed Contributions' }),
];

// ── Generic table ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ReportTable<T>({ columns, data }: { columns: any[]; data: T[] }) {
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
              <td colSpan={columns.length} className="px-3 py-6 text-center text-neutral-400">
                No data
              </td>
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

// ── Download button ───────────────────────────────────────────────────────────

function DownloadBtn({ path, formats }: { path: string; formats: ('csv' | 'pdf')[] }) {
  return (
    <div className="flex gap-2">
      {formats.map(fmt => (
        <a
          key={fmt}
          href={buildDownloadUrl(path, fmt)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="secondary" size="sm" Icon={Download}>
            {fmt.toUpperCase()}
          </Button>
        </a>
      ))}
    </div>
  );
}

// ── Report panels ─────────────────────────────────────────────────────────────

function MonthlyContribPanel() {
  const [month, setMonth] = useState(CUR_MONTH);
  const [year, setYear] = useState(CUR_YEAR);
  const { data, isLoading } = useQuery({
    queryKey: ['report-monthly-contrib', month, year],
    queryFn: () => getMonthlyContributions({ month, year }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <Field label="Month">
          <Select
            value={String(month)}
            onChange={e => setMonth(+e.target.value)}
            options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
            style={{ width: 120 }}
          />
        </Field>
        <Field label="Year">
          <Input type="number" value={year} onChange={e => setYear(+e.target.value)} style={{ width: 100 }} />
        </Field>
        <div className="self-end">
          <DownloadBtn path={`contributions/monthly?month=${month}&year=${year}`} formats={['csv', 'pdf']} />
        </div>
      </div>
      {data && (
        <div className="flex gap-6 text-sm text-neutral-600 bg-primary-50 border border-primary-100 rounded-sm px-4 py-2">
          <span>Expected: <strong className="font-mono tabular text-neutral-900">{fmtGHS(data.totalExpected)}</strong></span>
          <span>Collected: <strong className="font-mono tabular text-neutral-900">{fmtGHS(data.totalPaid)}</strong></span>
          <span>Surplus: <strong className="font-mono tabular text-neutral-900">{fmtGHS(data.totalSurplus)}</strong></span>
        </div>
      )}
      {isLoading ? <p className="text-xs text-neutral-400">Loading…</p> : <ReportTable columns={COLS_CONTRIB} data={data?.rows ?? []} />}
    </div>
  );
}

function ArrearsPanel() {
  const [fromMonth, setFromMonth] = useState(1);
  const [fromYear, setFromYear] = useState(CUR_YEAR);
  const [toMonth, setToMonth] = useState(CUR_MONTH);
  const [toYear, setToYear] = useState(CUR_YEAR);
  const { data = [], isLoading } = useQuery({
    queryKey: ['report-arrears', fromMonth, fromYear, toMonth, toYear],
    queryFn: () => getArrears({ fromMonth, fromYear, toMonth, toYear }),
  });
  const monthOptions = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <Field label="From Month">
          <Select value={String(fromMonth)} onChange={e => setFromMonth(+e.target.value)} options={monthOptions} style={{ width: 120 }} />
        </Field>
        <Field label="From Year">
          <Input type="number" value={fromYear} onChange={e => setFromYear(+e.target.value)} style={{ width: 100 }} />
        </Field>
        <Field label="To Month">
          <Select value={String(toMonth)} onChange={e => setToMonth(+e.target.value)} options={monthOptions} style={{ width: 120 }} />
        </Field>
        <Field label="To Year">
          <Input type="number" value={toYear} onChange={e => setToYear(+e.target.value)} style={{ width: 100 }} />
        </Field>
        <div className="self-end">
          <DownloadBtn
            path={`contributions/arrears?fromMonth=${fromMonth}&fromYear=${fromYear}&toMonth=${toMonth}&toYear=${toYear}`}
            formats={['csv', 'pdf']}
          />
        </div>
      </div>
      {isLoading ? <p className="text-xs text-neutral-400">Loading…</p> : <ReportTable columns={COLS_ARREARS} data={data} />}
    </div>
  );
}

function SimplePanel<T>({
  queryKey,
  queryFn,
  columns,
  downloadPath,
  formats = ['csv'],
}: {
  queryKey: string;
  queryFn: () => Promise<T[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: any[];
  downloadPath: string;
  formats?: ('csv' | 'pdf')[];
}) {
  const { data = [], isLoading } = useQuery({ queryKey: [queryKey], queryFn });
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <DownloadBtn path={downloadPath} formats={formats} />
      </div>
      {isLoading ? <p className="text-xs text-neutral-400">Loading…</p> : <ReportTable columns={columns} data={data as T[]} />}
    </div>
  );
}

// ── Sidebar nav ───────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'monthly-contrib', label: 'Monthly Contributions' },
  { id: 'arrears', label: 'Arrears' },
  { id: 'guarantor-offsets', label: 'Guarantor Offsets' },
  { id: 'active-loans', label: 'Active Loans' },
  { id: 'overdue-loans', label: 'Overdue Loans' },
  { id: 'repaid-loans', label: 'Repaid Loans' },
  { id: 'guarantor-exposure', label: 'Guarantor Exposure' },
  { id: 'bad-debt', label: 'Bad Debt' },
  { id: 'exit-clearance', label: 'Exit Clearance' },
];

// ── Root component ────────────────────────────────────────────────────────────

export function ReportsClient() {
  const [active, setActive] = useState('monthly-contrib');
  const activeSection = SECTIONS.find(s => s.id === active);

  return (
    <div className="flex gap-5">
      {/* Sidebar */}
      <nav className="w-52 shrink-0">
        <ul className="space-y-0.5">
          {SECTIONS.map(s => (
            <li key={s.id}>
              <button
                onClick={() => setActive(s.id)}
                className={[
                  'w-full text-left px-3 py-2 rounded-sm text-sm transition-colors duration-fast',
                  active === s.id
                    ? 'bg-primary-600 text-white font-medium'
                    : 'text-neutral-700 hover:bg-neutral-100',
                ].join(' ')}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Panel */}
      <div className="flex-1 min-w-0">
        <Card className="min-h-[400px]">
          <CardHeader title={activeSection?.label ?? ''} />
          <CardBody>
            {active === 'monthly-contrib' && <MonthlyContribPanel />}
            {active === 'arrears' && <ArrearsPanel />}
            {active === 'guarantor-offsets' && (
              <SimplePanel
                queryKey="report-guarantor-offsets"
                queryFn={getGuarantorOffsets}
                columns={COLS_OFFSETS}
                downloadPath="contributions/guarantor-offsets"
              />
            )}
            {active === 'active-loans' && (
              <SimplePanel
                queryKey="report-active-loans"
                queryFn={getActiveLoans}
                columns={COLS_ACTIVE}
                downloadPath="loans/active"
                formats={['csv', 'pdf']}
              />
            )}
            {active === 'overdue-loans' && (
              <SimplePanel
                queryKey="report-overdue-loans"
                queryFn={getOverdueLoans}
                columns={COLS_OVERDUE}
                downloadPath="loans/overdue"
              />
            )}
            {active === 'repaid-loans' && (
              <SimplePanel
                queryKey="report-repaid-loans"
                queryFn={getRepaidLoans}
                columns={COLS_REPAID}
                downloadPath="loans/repaid"
              />
            )}
            {active === 'guarantor-exposure' && (
              <SimplePanel
                queryKey="report-guarantor-exposure"
                queryFn={getGuarantorExposure}
                columns={COLS_EXPOSURE}
                downloadPath="loans/guarantor-exposure"
              />
            )}
            {active === 'bad-debt' && (
              <SimplePanel
                queryKey="report-bad-debt"
                queryFn={getBadDebt}
                columns={COLS_BAD}
                downloadPath="loans/bad-debt"
              />
            )}
            {active === 'exit-clearance' && (
              <SimplePanel
                queryKey="report-exit-clearance"
                queryFn={getExitClearance}
                columns={COLS_EXIT}
                downloadPath="staff/exit"
                formats={['csv', 'pdf']}
              />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
