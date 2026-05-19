'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
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

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const now = new Date();
const CUR_MONTH = now.getMonth() + 1;
const CUR_YEAR = now.getFullYear();

// ── Column definitions ────────────────────────────────────────────────────────

const colContrib = createColumnHelper<IMonthlyContributionRow>();
const COLS_CONTRIB = [
  colContrib.accessor('staffName', { header: 'Staff Name' }),
  colContrib.accessor('staffNo', { header: 'Staff No' }),
  colContrib.accessor('expectedAmount', { header: 'Expected (GHS)', cell: i => i.getValue().toLocaleString() }),
  colContrib.accessor('paidAmount', { header: 'Paid (GHS)', cell: i => i.getValue().toLocaleString() }),
  colContrib.accessor('surplusCarriedForward', { header: 'Surplus C/F', cell: i => i.getValue().toLocaleString() }),
  colContrib.accessor('status', { header: 'Status' }),
];

const colArrear = createColumnHelper<IArrearRow>();
const COLS_ARREARS = [
  colArrear.accessor('staffName', { header: 'Staff Name' }),
  colArrear.accessor('staffNo', { header: 'Staff No' }),
  colArrear.accessor('month', { header: 'Month', cell: i => MONTHS[i.getValue() - 1] }),
  colArrear.accessor('year', { header: 'Year' }),
  colArrear.accessor('expectedAmount', { header: 'Expected (GHS)', cell: i => i.getValue().toLocaleString() }),
  colArrear.accessor('paidAmount', { header: 'Paid (GHS)', cell: i => i.getValue().toLocaleString() }),
  colArrear.accessor('shortfall', { header: 'Shortfall (GHS)', cell: i => i.getValue().toLocaleString() }),
  colArrear.accessor('status', { header: 'Status' }),
];

const colOffset = createColumnHelper<IGuarantorOffsetRow>();
const COLS_OFFSETS = [
  colOffset.accessor('guarantorName', { header: 'Guarantor' }),
  colOffset.accessor('borrowerName', { header: 'Borrower' }),
  colOffset.accessor('instalmentNumber', { header: 'Instalment #' }),
  colOffset.accessor('offsetAmount', { header: 'Offset (GHS)', cell: i => i.getValue().toLocaleString() }),
  colOffset.accessor('offsetDate', { header: 'Date', cell: i => new Date(i.getValue()).toLocaleDateString() }),
];

const colActive = createColumnHelper<IActiveLoanRow>();
const COLS_ACTIVE = [
  colActive.accessor('staffName', { header: 'Staff Name' }),
  colActive.accessor('staffNo', { header: 'Staff No' }),
  colActive.accessor('guarantorName', { header: 'Guarantor' }),
  colActive.accessor('principalAmount', { header: 'Principal (GHS)', cell: i => i.getValue().toLocaleString() }),
  colActive.accessor('outstandingBalance', { header: 'Outstanding (GHS)', cell: i => i.getValue().toLocaleString() }),
  colActive.accessor('disbursedDate', { header: 'Disbursed', cell: i => new Date(i.getValue()).toLocaleDateString() }),
];

const colOverdue = createColumnHelper<IOverdueLoanRow>();
const COLS_OVERDUE = [
  colOverdue.accessor('staffName', { header: 'Staff Name' }),
  colOverdue.accessor('instalmentNumber', { header: 'Instalment #' }),
  colOverdue.accessor('dueDate', { header: 'Due Date', cell: i => new Date(i.getValue()).toLocaleDateString() }),
  colOverdue.accessor('dueAmount', { header: 'Due (GHS)', cell: i => i.getValue().toLocaleString() }),
  colOverdue.accessor('paidAmount', { header: 'Paid (GHS)', cell: i => i.getValue().toLocaleString() }),
  colOverdue.accessor('penaltyAmount', { header: 'Penalty (GHS)', cell: i => i.getValue().toLocaleString() }),
  colOverdue.accessor('daysOverdue', { header: 'Days Overdue' }),
];

const colRepaid = createColumnHelper<IRepaidLoanRow>();
const COLS_REPAID = [
  colRepaid.accessor('staffName', { header: 'Staff Name' }),
  colRepaid.accessor('principalAmount', { header: 'Principal (GHS)', cell: i => i.getValue().toLocaleString() }),
  colRepaid.accessor('totalRepayable', { header: 'Total Repaid (GHS)', cell: i => i.getValue().toLocaleString() }),
  colRepaid.accessor('disbursedDate', { header: 'Disbursed', cell: i => new Date(i.getValue()).toLocaleDateString() }),
  colRepaid.accessor('settledAt', { header: 'Settled', cell: i => new Date(i.getValue()).toLocaleDateString() }),
  colRepaid.accessor('tenureMonths', { header: 'Tenure (mo)' }),
];

const colExposure = createColumnHelper<IGuarantorExposureRow>();
const COLS_EXPOSURE = [
  colExposure.accessor('guarantorName', { header: 'Guarantor' }),
  colExposure.accessor('guarantorStaffNo', { header: 'Staff No' }),
  colExposure.accessor('activeLoansCount', { header: 'Active Loans' }),
  colExposure.accessor('totalOutstanding', { header: 'Total Outstanding (GHS)', cell: i => (i.getValue() as number).toLocaleString() }),
  colExposure.accessor('totalOffsetAmount', { header: 'Offset Paid (GHS)', cell: i => (i.getValue() as number).toLocaleString() }),
];

const colBad = createColumnHelper<IBadDebtRow>();
const COLS_BAD = [
  colBad.accessor('staffName', { header: 'Staff Name' }),
  colBad.accessor('principalAmount', { header: 'Principal (GHS)', cell: i => i.getValue().toLocaleString() }),
  colBad.accessor('exitDeductionAmount', { header: 'Exit Deduction (GHS)', cell: i => i.getValue().toLocaleString() }),
  colBad.accessor('guarantorOffsetAmount', { header: 'Guarantor Offset (GHS)', cell: i => i.getValue().toLocaleString() }),
  colBad.accessor('badDebtAmount', { header: 'Bad Debt (GHS)', cell: i => i.getValue().toLocaleString() }),
  colBad.accessor('settledAt', { header: 'Settled At', cell: i => new Date(i.getValue()).toLocaleDateString() }),
];

const colExit = createColumnHelper<IExitClearanceRow>();
const COLS_EXIT = [
  colExit.accessor('staffName', { header: 'Staff Name' }),
  colExit.accessor('staffNo', { header: 'Staff No' }),
  colExit.accessor('status', { header: 'Status' }),
  colExit.accessor('outstandingLoanBalance', { header: 'Outstanding Loans (GHS)', cell: i => i.getValue().toLocaleString() }),
  colExit.accessor('missedContributionsCount', { header: 'Missed Contributions' }),
];

// ── Generic table ─────────────────────────────────────────────────────────────

function ReportTable<T>({ columns, data }: { columns: any[]; data: T[] }) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          {table.getHeaderGroups().map(hg => (
            <tr key={hg.id} className="bg-gray-50 border-b">
              {hg.headers.map(h => (
                <th key={h.id} className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-gray-400">
                No data
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map(row => (
              <tr key={row.id} className="border-b hover:bg-gray-50">
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="px-3 py-2 whitespace-nowrap">
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
          className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-100 font-medium uppercase"
        >
          {fmt}
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
        <label className="flex flex-col gap-1 text-xs">
          Month
          <select
            className="border rounded px-2 py-1.5 text-sm"
            value={month}
            onChange={e => setMonth(+e.target.value)}
          >
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Year
          <input
            type="number"
            className="border rounded px-2 py-1.5 text-sm w-24"
            value={year}
            onChange={e => setYear(+e.target.value)}
          />
        </label>
        <DownloadBtn path={`contributions/monthly?month=${month}&year=${year}`} formats={['csv', 'pdf']} />
      </div>
      {data && (
        <div className="flex gap-6 text-sm text-gray-600">
          <span>Expected: <strong>GHS {data.totalExpected.toLocaleString()}</strong></span>
          <span>Collected: <strong>GHS {data.totalPaid.toLocaleString()}</strong></span>
          <span>Surplus: <strong>GHS {data.totalSurplus.toLocaleString()}</strong></span>
        </div>
      )}
      {isLoading ? <p className="text-xs text-gray-400">Loading…</p> : <ReportTable columns={COLS_CONTRIB} data={data?.rows ?? []} />}
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
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        {[
          ['From Month', fromMonth, setFromMonth, 'month'],
          ['From Year', fromYear, setFromYear, 'year'],
          ['To Month', toMonth, setToMonth, 'month'],
          ['To Year', toYear, setToYear, 'year'],
        ].map(([label, val, setter, type]) => (
          <label key={label as string} className="flex flex-col gap-1 text-xs">
            {label as string}
            {type === 'month' ? (
              <select className="border rounded px-2 py-1.5 text-sm" value={val as number} onChange={e => (setter as any)(+e.target.value)}>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            ) : (
              <input type="number" className="border rounded px-2 py-1.5 text-sm w-24" value={val as number} onChange={e => (setter as any)(+e.target.value)} />
            )}
          </label>
        ))}
        <DownloadBtn
          path={`contributions/arrears?fromMonth=${fromMonth}&fromYear=${fromYear}&toMonth=${toMonth}&toYear=${toYear}`}
          formats={['csv', 'pdf']}
        />
      </div>
      {isLoading ? <p className="text-xs text-gray-400">Loading…</p> : <ReportTable columns={COLS_ARREARS} data={data} />}
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
      {isLoading ? <p className="text-xs text-gray-400">Loading…</p> : <ReportTable columns={columns} data={data as T[]} />}
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

  return (
    <div className="flex gap-6">
      {/* Sidebar */}
      <nav className="w-52 shrink-0">
        <ul className="space-y-0.5">
          {SECTIONS.map(s => (
            <li key={s.id}>
              <button
                onClick={() => setActive(s.id)}
                className={`w-full text-left px-3 py-2 rounded text-sm ${
                  active === s.id
                    ? 'bg-blue-600 text-white font-medium'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Panel */}
      <div className="flex-1 bg-white rounded-xl border border-gray-200 p-5 min-h-[400px]">
        <h2 className="text-base font-semibold text-gray-800 mb-4">
          {SECTIONS.find(s => s.id === active)?.label}
        </h2>

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
      </div>
    </div>
  );
}
