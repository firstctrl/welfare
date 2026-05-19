'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { getDashboardStats } from '@/lib/reports';

const PIE_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#6b7280'];

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-1">
      <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
      <span className={`text-2xl font-bold ${accent ?? 'text-gray-900'}`}>{value}</span>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  );
}

export function DashboardClient() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: getDashboardStats,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-gray-100 rounded-xl h-24" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return <p className="text-red-500 text-sm">Failed to load dashboard stats.</p>;
  }

  const collectionPct = data.thisMonth.collectionRate.toFixed(1);
  const outstanding = (data.loans.totalOutstanding / 1000).toFixed(1);

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Collected this month"
          value={`GHS ${data.thisMonth.collected.toLocaleString()}`}
          sub={`${collectionPct}% of GHS ${data.thisMonth.expected.toLocaleString()} expected`}
          accent={data.thisMonth.collectionRate >= 80 ? 'text-green-600' : 'text-orange-500'}
        />
        <KpiCard
          label="Active loans"
          value={data.loans.activeCount}
          sub={`GHS ${outstanding}k outstanding`}
        />
        <KpiCard
          label="Overdue instalments"
          value={data.overdueInstalments}
          accent={data.overdueInstalments > 0 ? 'text-red-600' : undefined}
        />
        <KpiCard
          label="Members in arrears"
          value={data.membersInArrears}
          accent={data.membersInArrears > 0 ? 'text-orange-500' : undefined}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 12-month trend */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Monthly Contributions (12 months)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.monthlyTrend} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => `GHS ${v.toLocaleString()}`} />
              <Bar dataKey="expected" name="Expected" fill="#e5e7eb" radius={[3, 3, 0, 0]} />
              <Bar dataKey="collected" name="Collected" fill="#2563eb" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Loan distribution */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Loan Status Distribution</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={data.loanStatusDistribution}
                dataKey="count"
                nameKey="status"
                cx="50%"
                cy="50%"
                outerRadius={70}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {data.loanStatusDistribution.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Upcoming payments */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Upcoming Payments (next 7 days)</h2>
          {data.upcomingPayments.length === 0 ? (
            <p className="text-xs text-gray-400">None due soon.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 border-b">
                  <th className="pb-2">Staff</th>
                  <th className="pb-2">Instalment</th>
                  <th className="pb-2">Due Date</th>
                  <th className="pb-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.upcomingPayments.map((p, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5">{p.staffName}</td>
                    <td className="py-1.5">#{p.instalmentNumber}</td>
                    <td className="py-1.5">{new Date(p.dueDate).toLocaleDateString()}</td>
                    <td className="py-1.5 text-right font-mono">GHS {p.dueAmount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent flagged batches */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Recently Flagged Imports</h2>
          {data.recentFlaggedBatches.length === 0 ? (
            <p className="text-xs text-gray-400">No flagged batches recently.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 border-b">
                  <th className="pb-2">File</th>
                  <th className="pb-2">Period</th>
                  <th className="pb-2 text-right">Flagged</th>
                </tr>
              </thead>
              <tbody>
                {data.recentFlaggedBatches.map((b, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5 truncate max-w-[140px]">{b.fileName}</td>
                    <td className="py-1.5">{b.month}/{b.year}</td>
                    <td className="py-1.5 text-right text-red-500 font-semibold">{b.flaggedRows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
