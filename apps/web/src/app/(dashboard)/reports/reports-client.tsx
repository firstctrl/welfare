'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { FundSummaryPanel } from './fund-summary-panel';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Download, Send, FileText, TrendingUp, AlertCircle, Banknote, BarChart3, Search, Users, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { AppModule } from '@welfare/shared';
import { usePermission } from '@/hooks/use-permission';
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
  getStaffStatement,
  sendStaffStatement,
  downloadStatementPdf,
  triggerBulkSend,
  getBulkSendStatus,
  buildDownloadUrl,
  getLoanBorrowers,
  getLoanStatement,
  downloadLoanStatementPdf,
  sendLoanStatement,
} from '@/lib/reports';
import { listLoans } from '@/lib/loans';
import { getRemittancesReport, buildRemittancesReportDownloadUrl } from '@/lib/remittances';
import { searchStaff } from '@/lib/staff';
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
  ILoan,
  ILoanBorrower,
  IRemittanceReportRow,
} from '@welfare/shared';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Field, Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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

const STATUS_BG: Record<string, string> = {
  Paid:           'bg-success-50 text-success-700',
  Partial:        'bg-warning-50 text-warning-700',
  Missed:         'bg-danger-50 text-danger-700',
  CarriedForward: 'bg-info-50 text-info-700',
};

const LOAN_STATUS_BADGE: Record<string, string> = {
  Active:     'bg-info-50 text-info-700',
  Completed:  'bg-success-50 text-success-700',
  WrittenOff: 'bg-neutral-100 text-neutral-500',
  BadDebt:    'bg-danger-50 text-danger-700',
  Defaulted:  'bg-warning-50 text-warning-700',
};

const INSTALMENT_STATUS_BG: Record<string, string> = {
  Paid:    'bg-success-50 text-success-700',
  Partial: 'bg-warning-50 text-warning-700',
  Overdue: 'bg-danger-50 text-danger-700',
  Pending: 'bg-neutral-50 text-neutral-500',
  Waived:  'bg-neutral-100 text-neutral-400',
};

function LoanStatementPanel({ canSend }: { canSend: boolean }) {
  const borrowerDropdownRef                         = useRef<HTMLDivElement>(null);
  const [borrowerInput, setBorrowerInput]           = useState('');
  const [showBorrowerDropdown, setShowBorrowerDropdown] = useState(false);
  const [selectedBorrower, setSelectedBorrower]     = useState<ILoanBorrower | null>(null);
  const [selectedLoan, setSelectedLoan]             = useState<ILoan | null>(null);

  const { data: borrowers = [], isLoading: loadingBorrowers } = useQuery({
    queryKey: ['loan-borrowers'],
    queryFn: getLoanBorrowers,
  });

  const filteredBorrowers = borrowers.filter(b => {
    const q = borrowerInput.toLowerCase();
    return b.displayName.toLowerCase().includes(q) || b.staffNo.toLowerCase().includes(q);
  });

  const { data: loansPage } = useQuery({
    queryKey: ['loans-for-borrower', selectedBorrower?.staffId],
    queryFn: () => listLoans({ staffId: selectedBorrower!.staffId, limit: 100 }),
    enabled: !!selectedBorrower,
  });
  const loans = loansPage?.data ?? [];

  const { data: stmt, isLoading: loadingStmt } = useQuery({
    queryKey: ['loan-statement', selectedBorrower?.staffId, selectedLoan?._id],
    queryFn: () => getLoanStatement(selectedBorrower!.staffId, selectedLoan!._id),
    enabled: !!selectedBorrower && !!selectedLoan,
  });

  const sendMutation = useMutation({
    mutationFn: () => sendLoanStatement(selectedBorrower!.staffId, selectedLoan!._id),
    onSuccess: (res) => toast.success(`Statement sent to ${res.email}`),
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to send statement'),
  });

  function selectBorrower(b: ILoanBorrower) {
    setSelectedBorrower(b);
    setBorrowerInput(`${b.displayName} (${b.staffNo})`);
    setShowBorrowerDropdown(false);
    setSelectedLoan(null);
  }

  function handleBorrowerInput(e: React.ChangeEvent<HTMLInputElement>) {
    setBorrowerInput(e.target.value);
    setSelectedBorrower(null);
    setSelectedLoan(null);
    setShowBorrowerDropdown(true);
  }

  function handleLoanChange(e: { target: { value: string } }) {
    const l = loans.find(l => l._id === e.target.value) ?? null;
    setSelectedLoan(l);
  }

  const { kpis, instalments, loan } = stmt ?? {};

  return (
    <div className="space-y-5">
      {/* Selectors */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative" ref={borrowerDropdownRef}>
          <Field label="Select Borrower">
            <div className="relative">
              <input
                value={borrowerInput}
                onChange={handleBorrowerInput}
                onBlur={() => setTimeout(() => setShowBorrowerDropdown(false), 150)}
                placeholder={loadingBorrowers ? 'Loading…' : 'Search by name or staff no…'}
                disabled={loadingBorrowers}
                className="w-full px-3 pr-8 h-[var(--row-default)] rounded-sm border border-neutral-200 bg-white text-base outline-none focus:border-primary-500 focus:shadow-focus placeholder:text-neutral-400 disabled:opacity-50"
                style={{ minWidth: 240 }}
              />
              <Search size={14} strokeWidth={1.75} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            </div>
          </Field>
          {showBorrowerDropdown && borrowerInput.length > 0 && filteredBorrowers.length > 0 && (
            <div className="absolute z-20 w-full mt-1 bg-white border border-neutral-200 rounded-sm shadow-lg overflow-hidden max-h-60 overflow-y-auto">
              {filteredBorrowers.map(b => (
                <button
                  key={b.staffId}
                  onMouseDown={() => selectBorrower(b)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 transition-colors"
                >
                  <span className="font-medium text-neutral-900">{b.displayName}</span>
                  <span className="ml-2 font-mono text-xs text-neutral-400">{b.staffNo}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedBorrower && (
          <Field label="Select Loan">
            <Select
              value={selectedLoan?._id ?? ''}
              onChange={handleLoanChange}
              options={[
                { value: '', label: loans.length === 0 ? 'No loans found' : 'Select loan…' },
                ...loans.map(l => ({
                  value: l._id,
                  label: `GHS ${l.principalAmount.toLocaleString()} · ${new Date(l.disbursedDate).toLocaleDateString('en-GB')} · ${l.status}`,
                })),
              ]}
              style={{ minWidth: 300 }}
            />
          </Field>
        )}

        {selectedBorrower && selectedLoan && stmt && (
          <div className="flex gap-2 ml-auto">
            <Button
              variant="secondary"
              size="sm"
              Icon={FileText}
              onClick={() =>
                downloadLoanStatementPdf(
                  selectedBorrower.staffId,
                  selectedLoan._id,
                  selectedBorrower.staffNo,
                ).catch(() => toast.error('Download failed'))
              }
            >
              Download PDF
            </Button>
            {canSend && (
              <Button
                variant="primary"
                size="sm"
                Icon={Send}
                loading={sendMutation.isPending}
                onClick={() => sendMutation.mutate()}
              >
                Send Statement
              </Button>
            )}
          </div>
        )}
      </div>

      {!selectedBorrower && (
        <div className="flex items-center justify-center py-16 text-neutral-400 text-sm">
          Select a borrower to view their loan statement
        </div>
      )}

      {selectedBorrower && !selectedLoan && (
        <div className="flex items-center justify-center py-16 text-neutral-400 text-sm">
          Select a loan to view the statement
        </div>
      )}

      {selectedBorrower && selectedLoan && loadingStmt && (
        <div className="flex items-center justify-center py-16 text-neutral-400 text-sm">Loading…</div>
      )}

      {stmt && kpis && loan && (
        <>
          {/* Loan info block */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs bg-neutral-50 border border-neutral-200 rounded-md px-4 py-3">
            <div><span className="text-neutral-400">Disbursed</span><br /><span className="font-medium">{fmtDate(new Date(loan.disbursedDate))}</span></div>
            <div><span className="text-neutral-400">Tenure</span><br /><span className="font-medium">{loan.tenureMonths} months</span></div>
            <div><span className="text-neutral-400">Interest Rate</span><br /><span className="font-medium">{loan.interestRate}%</span></div>
            <div><span className="text-neutral-400">Guarantor</span><br /><span className="font-medium">{loan.guarantor.displayName} ({loan.guarantor.staffNo})</span></div>
            <div><span className="text-neutral-400">Cheque No</span><br /><span className="font-medium">{loan.chequeNo ?? '—'}</span></div>
            <div><span className="text-neutral-400">PV No</span><br /><span className="font-medium">{loan.pvNo ?? '—'}</span></div>
            <div className="col-span-2"><span className="text-neutral-400">Status</span><br />
              <span className={cn('inline-block px-2 py-0.5 rounded text-xs font-medium mt-0.5', LOAN_STATUS_BADGE[loan.status] ?? 'bg-neutral-100 text-neutral-600')}>{loan.status}</span>
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Principal" value={fmtGHS(loan.principalAmount)} icon={Banknote} iconKind="primary" />
            <KpiCard label="Amount Paid" value={fmtGHS(kpis.totalPaid)} icon={TrendingUp} iconKind="success" />
            <KpiCard
              label="Outstanding"
              value={fmtGHS(kpis.outstanding)}
              icon={AlertCircle}
              iconKind={kpis.outstanding === 0 ? 'success' : kpis.outstanding > loan.principalAmount / 2 ? 'danger' : 'warning'}
            />
            <KpiCard
              label="Completion"
              value={`${kpis.completionRate}%`}
              icon={BarChart3}
              iconKind={kpis.completionRate === 100 ? 'success' : kpis.completionRate >= 50 ? 'warning' : 'danger'}
              subtext={kpis.penaltyPaid > 0 ? `Penalty: ${fmtGHS(kpis.penaltyPaid)}` : undefined}
            />
          </div>

          {/* Instalment table */}
          {instalments && instalments.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-neutral-200">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-primary-600 text-white">
                    <th className="px-3 py-2.5 text-left font-semibold">#</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">Due Date</th>
                    <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">Due (GHS)</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Principal</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Interest</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Paid (GHS)</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Penalty</th>
                    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">Paid Date</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {instalments.map(r => (
                    <tr key={r.instalmentNumber} className="hover:bg-neutral-50">
                      <td className="px-3 py-2 text-neutral-500">{r.instalmentNumber}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(new Date(r.dueDate))}</td>
                      <td className="px-3 py-2 text-right font-mono tabular">{fmtGHS(r.dueAmount)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular text-neutral-500">{fmtGHS(r.principalAmount)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular text-neutral-500">{fmtGHS(r.interestAmount)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular font-medium">{fmtGHS(r.paidAmount)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular text-danger-600">
                        {r.penaltyAmount > 0 ? fmtGHS(r.penaltyAmount) : <span className="text-neutral-300">—</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.paidDate ? fmtDate(new Date(r.paidDate)) : <span className="text-neutral-300">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn('inline-block px-2 py-0.5 rounded text-xs font-medium', INSTALMENT_STATUS_BG[r.status] ?? 'bg-neutral-100 text-neutral-600')}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 border border-neutral-200 rounded-md text-neutral-400 text-sm">
              No instalment records found
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StaffStatementPanel({ canSend }: { canSend: boolean }) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [staffInput, setStaffInput]           = useState('');
  const [staffOptions, setStaffOptions]       = useState<{ _id: string; fullName: string; staffId: string }[]>([]);
  const [showDropdown, setShowDropdown]       = useState(false);
  const [selectedStaff, setSelectedStaff]     = useState<{ _id: string; fullName: string; staffId: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['staff-statement', selectedStaff?._id],
    queryFn: () => getStaffStatement(selectedStaff!._id),
    enabled: !!selectedStaff,
  });

  const sendMutation = useMutation({
    mutationFn: () => sendStaffStatement(selectedStaff!._id),
    onSuccess: (res) => toast.success(`Statement sent to ${res.email}`),
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to send statement'),
  });

  const handleSearch = useCallback(async (q: string) => {
    setStaffInput(q);
    if (q.length < 1) { setStaffOptions([]); setShowDropdown(false); return; }
    const res = await searchStaff(q, { limit: 8 } as any);
    const opts = res.data.map((s: any) => ({ _id: s._id, fullName: s.fullName, staffId: s.staffId }));
    setStaffOptions(opts);
    setShowDropdown(opts.length > 0);
  }, []);

  function selectStaff(s: { _id: string; fullName: string; staffId: string }) {
    setSelectedStaff(s);
    setStaffInput(`${s.fullName} (${s.staffId})`);
    setShowDropdown(false);
  }

  const { kpis, rows, years } = data ?? {};

  return (
    <div className="space-y-5">
      {/* Staff picker */}
      <div className="flex items-end gap-3">
        <div className="relative w-80" ref={dropdownRef}>
          <Field label="Select Staff Member">
            <div className="relative">
              <input
                value={staffInput}
                onChange={e => handleSearch(e.target.value)}
                onFocus={() => staffOptions.length > 0 && setShowDropdown(true)}
                placeholder="Search by name or staff ID…"
                className="w-full px-3 pr-8 h-[var(--row-default)] rounded-sm border border-neutral-200 bg-white text-base outline-none focus:border-primary-500 focus:shadow-focus placeholder:text-neutral-400"
              />
              <Search size={14} strokeWidth={1.75} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            </div>
          </Field>
          {showDropdown && (
            <div className="absolute z-20 w-full mt-1 bg-white border border-neutral-200 rounded-sm shadow-lg overflow-hidden">
              {staffOptions.map(s => (
                <button
                  key={s._id}
                  onMouseDown={() => selectStaff(s)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 transition-colors"
                >
                  <span className="font-medium text-neutral-900">{s.fullName}</span>
                  <span className="ml-2 font-mono text-xs text-neutral-400">{s.staffId}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {selectedStaff && data && (
          <div className="flex gap-2 ml-auto">
            <Button
              variant="secondary"
              size="sm"
              Icon={FileText}
              onClick={() => downloadStatementPdf(selectedStaff._id, selectedStaff.staffId).catch(err => toast.error('Download failed'))}
            >
              Download PDF
            </Button>
            {canSend && data.staff.email && (
              <Button
                variant="primary"
                size="sm"
                Icon={Send}
                loading={sendMutation.isPending}
                onClick={() => sendMutation.mutate()}
              >
                Send Statement
              </Button>
            )}
          </div>
        )}
      </div>

      {!selectedStaff && (
        <div className="flex items-center justify-center py-16 text-neutral-400 text-sm">
          Search and select a staff member to view their contribution statement
        </div>
      )}

      {selectedStaff && isLoading && (
        <div className="flex items-center justify-center py-16 text-neutral-400 text-sm">Loading…</div>
      )}

      {data && kpis && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Total Paid"
              value={fmtGHS(kpis.totalPaid)}
              icon={Banknote}
              iconKind="success"
            />
            <KpiCard
              label="Total Expected"
              value={fmtGHS(kpis.totalExpected)}
              icon={TrendingUp}
              iconKind="primary"
            />
            <KpiCard
              label="Collection Rate"
              value={`${kpis.collectionRate}%`}
              icon={BarChart3}
              iconKind={kpis.collectionRate >= 90 ? 'success' : kpis.collectionRate >= 70 ? 'warning' : 'danger'}
            />
            <KpiCard
              label="Missed / Partial"
              value={`${kpis.missedMonths} months`}
              subtext={kpis.totalSurplus > 0 ? `Surplus: ${fmtGHS(kpis.totalSurplus)}` : undefined}
              icon={AlertCircle}
              iconKind={kpis.missedMonths === 0 ? 'success' : kpis.missedMonths <= 3 ? 'warning' : 'danger'}
            />
          </div>

          {/* Crosstab */}
          {rows && rows.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-neutral-200">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-primary-600 text-white">
                    <th className="px-4 py-2.5 text-left font-semibold whitespace-nowrap w-16">Year</th>
                    {MONTHS.map(m => (
                      <th key={m} className="px-3 py-2.5 text-center font-semibold whitespace-nowrap min-w-[72px]">{m}</th>
                    ))}
                    <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {rows.map(row => (
                    <tr key={row.year} className="hover:bg-neutral-50 group">
                      <td className="px-4 py-2 font-bold text-neutral-700 bg-neutral-50 group-hover:bg-neutral-100 transition-colors">{row.year}</td>
                      {Array.from({ length: 12 }, (_, i) => {
                        const cell = row.cells[i + 1];
                        return (
                          <td key={i} className="px-1 py-1 text-center">
                            {cell ? (
                              <span
                                className={cn('inline-block w-full px-1.5 py-1 rounded text-xs font-mono tabular leading-tight', STATUS_BG[cell.status] ?? 'bg-neutral-100 text-neutral-600')}
                                title={`${cell.status} · Expected: ${fmtGHS(cell.expectedAmount)}`}
                              >
                                {fmtGHS(cell.paidAmount)}
                              </span>
                            ) : (
                              <span className="text-neutral-300">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2 text-right font-bold font-mono tabular text-neutral-900">{fmtGHS(row.yearTotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-neutral-50 border-t-2 border-neutral-200">
                    <td className="px-4 py-2 font-bold text-neutral-700 text-xs uppercase tracking-wide">Total</td>
                    {Array.from({ length: 12 }, (_, i) => {
                      const monthTotal = (rows ?? []).reduce((s, r) => s + (r.cells[i + 1]?.paidAmount ?? 0), 0);
                      return (
                        <td key={i} className="px-1 py-2 text-center font-bold font-mono tabular text-xs text-neutral-700">
                          {monthTotal > 0 ? fmtGHS(monthTotal) : <span className="text-neutral-300">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-right font-bold font-mono tabular text-neutral-900">{fmtGHS(kpis.totalPaid)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 border border-neutral-200 rounded-md text-neutral-400 text-sm">
              No contribution records found for this staff member
            </div>
          )}

          {/* Status legend */}
          <div className="flex items-center gap-4 text-xs text-neutral-500">
            <span className="font-medium">Status:</span>
            {Object.entries(STATUS_BG).map(([status, cls]) => (
              <span key={status} className={cn('px-2 py-0.5 rounded font-medium', cls)}>{status}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BulkStatementsPanel({ canSend }: { canSend: boolean }) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [year, setYear]               = useState(CUR_YEAR);
  const [sendTo, setSendTo]           = useState<'all' | 'selected'>('all');
  const [staffInput, setStaffInput]   = useState('');
  const [staffOptions, setStaffOptions] = useState<{ _id: string; fullName: string; staffId: string }[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selected, setSelected]       = useState<{ _id: string; fullName: string; staffId: string }[]>([]);
  const [jobId, setJobId]             = useState<string | null>(null);
  const [polling, setPolling]         = useState(false);
  const [status, setStatus]           = useState<Awaited<ReturnType<typeof getBulkSendStatus>> | null>(null);

  const handleSearch = useCallback(async (q: string) => {
    setStaffInput(q);
    if (q.length < 1) { setStaffOptions([]); setShowDropdown(false); return; }
    const res = await searchStaff(q, { limit: 8 } as any);
    const opts = res.data
      .map((s: any) => ({ _id: s._id, fullName: s.fullName, staffId: s.staffId }))
      .filter((s: any) => !selected.find(sel => sel._id === s._id));
    setStaffOptions(opts);
    setShowDropdown(opts.length > 0);
  }, [selected]);

  function addStaff(s: { _id: string; fullName: string; staffId: string }) {
    setSelected(prev => [...prev, s]);
    setStaffInput('');
    setStaffOptions([]);
    setShowDropdown(false);
  }

  function removeStaff(id: string) {
    setSelected(prev => prev.filter(s => s._id !== id));
  }

  useEffect(() => {
    if (!jobId || !polling) return;
    const interval = setInterval(async () => {
      try {
        const s = await getBulkSendStatus(jobId);
        setStatus(s);
        if (s.state === 'completed' || s.state === 'failed') {
          setPolling(false);
          clearInterval(interval);
        }
      } catch {
        setPolling(false);
        clearInterval(interval);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [jobId, polling]);

  const sendMutation = useMutation({
    mutationFn: () => triggerBulkSend({
      year,
      sendTo,
      staffIds: sendTo === 'selected' ? selected.map(s => s._id) : undefined,
    }),
    onSuccess: (res) => {
      setJobId(res.jobId);
      setPolling(true);
      setStatus(null);
      toast.success(`Bulk send queued — ${res.queued} staff members`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to queue bulk send'),
  });

  const isRunning = status?.state === 'active' || status?.state === 'waiting';
  const isDone    = status?.state === 'completed';
  const isFailed  = status?.state === 'failed';

  return (
    <div className="space-y-5">
      <p className="text-sm text-neutral-500">
        Generate and email contribution statements as PDF to staff members. The system automatically
        sends statements on every quarter.
      </p>

      {/* Config */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-4 bg-neutral-50 rounded-md border border-neutral-200">
        <Field label="Statement Year">
          <Input
            type="number"
            value={year}
            onChange={(e) => setYear(+e.target.value)}
            style={{ width: 120 }}
          />
        </Field>

        <Field label="Send To">
          <div className="flex gap-4 mt-1">
            {(['all', 'selected'] as const).map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="sendTo"
                  value={opt}
                  checked={sendTo === opt}
                  onChange={() => setSendTo(opt)}
                  className="accent-primary-600"
                />
                {opt === 'all' ? 'All active staff with email' : 'Selected staff only'}
              </label>
            ))}
          </div>
        </Field>
      </div>

      {/* Staff picker (selected mode) */}
      {sendTo === 'selected' && (
        <div className="space-y-3">
          <div className="relative w-80" ref={dropdownRef}>
            <Field label="Add Staff">
              <div className="relative">
                <input
                  value={staffInput}
                  onChange={(e) => handleSearch(e.target.value)}
                  onFocus={() => staffOptions.length > 0 && setShowDropdown(true)}
                  placeholder="Search by name or staff ID…"
                  className="w-full px-3 pr-8 h-[var(--row-default)] rounded-sm border border-neutral-200 bg-white text-base outline-none focus:border-primary-500 focus:shadow-focus placeholder:text-neutral-400"
                />
                <Search
                  size={14}
                  strokeWidth={1.75}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
                />
              </div>
            </Field>
            {showDropdown && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-neutral-200 rounded-sm shadow-lg overflow-hidden">
                {staffOptions.map((s) => (
                  <button
                    key={s._id}
                    onMouseDown={() => addStaff(s)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 transition-colors"
                  >
                    <span className="font-medium text-neutral-900">{s.fullName}</span>
                    <span className="ml-2 font-mono text-xs text-neutral-400">{s.staffId}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selected.map((s) => (
                <span
                  key={s._id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary-50 text-primary-700 rounded-full text-xs font-medium"
                >
                  {s.fullName}
                  <button
                    onClick={() => removeStaff(s._id)}
                    className="hover:text-danger-600 transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Send button */}
      <div className="flex items-center gap-4">
        {canSend && (
          <Button
            variant="primary"
            size="sm"
            Icon={sendMutation.isPending || polling ? Loader2 : Send}
            loading={sendMutation.isPending || polling}
            disabled={sendTo === 'selected' && selected.length === 0}
            onClick={() => sendMutation.mutate()}
          >
            Send Statements
          </Button>
        )}
        {sendTo === 'selected' && selected.length > 0 && (
          <span className="text-xs text-neutral-400">{selected.length} staff selected</span>
        )}
      </div>

      {/* Job status */}
      {status && (
        <div className="p-4 rounded-md border border-neutral-200 space-y-3">
          <div className="flex items-center gap-2">
            {isDone && <CheckCircle2 size={16} className="text-success-600" />}
            {isFailed && <XCircle size={16} className="text-danger-600" />}
            {isRunning && <Loader2 size={16} className="animate-spin text-primary-600" />}
            <span className="text-sm font-medium text-neutral-800">
              {isDone && 'Completed'}
              {isFailed && 'Failed'}
              {isRunning && `Processing… ${status.progress}%`}
            </span>
            <span className="ml-auto text-xs text-neutral-400 font-mono">Job {status.jobId}</span>
          </div>

          {/* Progress bar */}
          <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                isDone ? 'bg-success-500' : isFailed ? 'bg-danger-500' : 'bg-primary-500',
              )}
              style={{ width: `${isDone ? 100 : status.progress}%` }}
            />
          </div>

          {status.result && (
            <div className="flex gap-6 text-sm">
              <span className="text-success-700 font-medium">✓ {status.result.sent} sent</span>
              {status.result.failed > 0 && (
                <span className="text-danger-700 font-medium">✗ {status.result.failed} failed</span>
              )}
              <span className="text-neutral-500">of {status.result.total} total</span>
            </div>
          )}

          {isFailed && status.failedReason && (
            <p className="text-xs text-danger-700 bg-danger-50 px-3 py-2 rounded">
              {status.failedReason}
            </p>
          )}
        </div>
      )}
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

function RemittancesReportPanel() {
  const now = new Date();
  const [fromMonth, setFromMonth] = useState(1);
  const [fromYear, setFromYear]   = useState(now.getFullYear());
  const [toMonth, setToMonth]     = useState(now.getMonth() + 1);
  const [toYear, setToYear]       = useState(now.getFullYear());
  const [params, setParams]       = useState<{ fromMonth: number; fromYear: number; toMonth: number; toYear: number } | null>(null);
  const [rangeError, setRangeError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['remittances-report', params],
    queryFn: () => getRemittancesReport(params!),
    enabled: params !== null,
  });

  const colRem = createColumnHelper<IRemittanceReportRow>();
  const COLS = [
    colRem.accessor('period', { header: 'Period' }),
    colRem.accessor('receiptDate', { header: 'Receipt Date' }),
    colRem.accessor('grossAmount', { header: 'Gross Amt (GHS)', cell: i => fmtGHS(i.getValue()) }),
    colRem.accessor('charges', { header: 'Charges (GHS)', cell: i => fmtGHS(i.getValue()) }),
    colRem.accessor('netPayable', { header: 'Net Payable (GHS)', cell: i => fmtGHS(i.getValue()) }),
  ];

  const table = useReactTable({ data: data?.rows ?? [], columns: COLS, getCoreRowModel: getCoreRowModel() });

  const monthOptions = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));

  const handleRun = () => {
    if (toYear < fromYear || (toYear === fromYear && toMonth < fromMonth)) {
      setRangeError('To period must not be before From period');
      return;
    }
    setRangeError('');
    setParams({ fromMonth, fromYear, toMonth, toYear });
  };

  const downloadUrl = (format: 'csv' | 'pdf') =>
    params ? buildRemittancesReportDownloadUrl({ ...params, format }) : '#';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 p-4 bg-neutral-50 border border-neutral-200 rounded-md">
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
        <Button onClick={handleRun} disabled={isLoading}>
          {isLoading ? 'Loading…' : 'Run Report'}
        </Button>
      </div>
      {rangeError && <p className="text-sm text-danger-600">{rangeError}</p>}

      {data && (
        <>
          <div className="flex gap-2">
            <a href={downloadUrl('csv')} download>
              <Button variant="secondary" size="sm" Icon={Download}>CSV</Button>
            </a>
            <a href={downloadUrl('pdf')} download>
              <Button variant="secondary" size="sm" Icon={Download}>PDF</Button>
            </a>
          </div>

          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 grid grid-cols-3 gap-4 text-sm">
            <div><p className="text-neutral-500 text-xs uppercase tracking-wide">Total Gross</p><p className="font-semibold">{fmtGHS(data.totalGross)}</p></div>
            <div><p className="text-neutral-500 text-xs uppercase tracking-wide">Total Charges</p><p className="font-semibold">{fmtGHS(data.totalCharges)}</p></div>
            <div><p className="text-neutral-500 text-xs uppercase tracking-wide">Total Net Payable</p><p className="font-semibold text-primary-700">{fmtGHS(data.totalNet)}</p></div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                {table.getHeaderGroups().map(hg => (
                  <tr key={hg.id} className="border-b border-neutral-200 bg-neutral-50">
                    {hg.headers.map(h => (
                      <th key={h.id} className="px-3 py-2.5 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide whitespace-nowrap">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {table.getRowModel().rows.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-neutral-400">No remittance records in this period</td></tr>
                ) : (
                  table.getRowModel().rows.map(row => (
                    <tr key={row.id} className="hover:bg-neutral-50">
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id} className="px-3 py-2.5 text-neutral-700 whitespace-nowrap">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!data && !isLoading && params === null && (
        <p className="text-sm text-neutral-400 text-center py-8">Select a period and click Run Report.</p>
      )}
    </div>
  );
}

// ── Sidebar nav ───────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'fund-summary',    label: 'Fund Summary' },
  { id: 'monthly-contrib', label: 'Contribution Statement' },
  { id: 'bulk-statements', label: 'Bulk Statements' },
  { id: 'loan-statement', label: 'Loan Statement' },
  { id: 'arrears', label: 'Arrears' },
  { id: 'guarantor-offsets', label: 'Guarantor Offsets' },
  { id: 'active-loans', label: 'Active Loans' },
  { id: 'overdue-loans', label: 'Overdue Loans' },
  { id: 'repaid-loans', label: 'Repaid Loans' },
  { id: 'guarantor-exposure', label: 'Guarantor Exposure' },
  { id: 'bad-debt', label: 'Bad Debt' },
  { id: 'exit-clearance', label: 'Exit Clearance' },
  { id: 'remittances', label: 'Remittances' },
];

// ── Root component ────────────────────────────────────────────────────────────

export function ReportsClient() {
  const permission = usePermission(AppModule.Reports);
  const canSend = permission === 'full';
  const [active, setActive] = useState('fund-summary');
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
            {active === 'fund-summary' && <FundSummaryPanel />}
            {active === 'monthly-contrib' && <StaffStatementPanel canSend={canSend} />}
            {active === 'bulk-statements' && <BulkStatementsPanel canSend={canSend} />}
            {active === 'loan-statement' && <LoanStatementPanel canSend={canSend} />}
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
            {active === 'remittances' && <RemittancesReportPanel />}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
