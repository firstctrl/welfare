'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Coins, Landmark, AlertTriangle, Users } from 'lucide-react';
import { getDashboardStats } from '@/lib/reports';
import { KpiCard } from '@/components/ui/kpi-card';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { KpiSkeleton } from '@/components/ui/skeleton';
import { fmtGHS, fmtDate } from '@/lib/format';

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

export function DashboardClient() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: getDashboardStats,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return <p className="text-sm text-danger-600">Failed to load dashboard stats.</p>;
  }

  const collectionPct = data.thisMonth.collectionRate.toFixed(1);
  const collectionSentiment = data.thisMonth.collectionRate >= 80 ? 'positive' : 'negative';
  const collectionTrend = data.thisMonth.collectionRate >= 80 ? 'up' : 'down';
  const collectionMonthLabel = new Date(
    data.thisMonth.year,
    data.thisMonth.month - 1,
  ).toLocaleString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label={`Collected for ${collectionMonthLabel}`}
          value={fmtGHS(data.thisMonth.collected)}
          subtext={`of ${fmtGHS(data.thisMonth.expected)} expected`}
          trend={collectionTrend}
          trendLabel={`${collectionPct}%`}
          trendSentiment={collectionSentiment}
          icon={Coins}
          iconKind={collectionSentiment === 'positive' ? 'success' : 'warning'}
        />
        <KpiCard
          label="Active loans"
          value={String(data.loans.activeCount)}
          subtext={`${fmtGHS(data.loans.totalOutstanding)} outstanding`}
          icon={Landmark}
          iconKind="primary"
        />
        <KpiCard
          label="Overdue instalments"
          value={String(data.overdueInstalments)}
          trendSentiment={data.overdueInstalments > 0 ? 'negative' : 'neutral'}
          icon={AlertTriangle}
          iconKind={data.overdueInstalments > 0 ? 'danger' : 'success'}
        />
        <KpiCard
          label="Members in arrears"
          value={String(data.membersInArrears)}
          trendSentiment={data.membersInArrears > 0 ? 'negative' : 'neutral'}
          icon={Users}
          iconKind={data.membersInArrears > 0 ? 'warning' : 'success'}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-2">
          <CardHeader title="Monthly Contributions" subtitle="Last 12 months" />
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={data.monthlyTrend}
                margin={{ top: 0, right: 0, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                  }
                />
                <Tooltip
                  formatter={(v: number) => fmtGHS(v)}
                  contentStyle={{
                    fontSize: 12,
                    border: '1px solid var(--border-default)',
                    borderRadius: 6,
                    fontFamily: 'Nunito, sans-serif',
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, fontFamily: 'Nunito, sans-serif', paddingTop: 8 }}
                />
                <Bar
                  dataKey="expected"
                  name="Expected"
                  fill="var(--neutral-200)"
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="collected"
                  name="Collected"
                  fill="var(--chart-1)"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Loan Status" subtitle="Distribution" />
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={data.loanStatusDistribution}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  label={({ percent }: { percent: number }) => `${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {data.loanStatusDistribution.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Legend
                  iconSize={10}
                  wrapperStyle={{ fontSize: 11, fontFamily: 'Nunito, sans-serif' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Upcoming Payments" subtitle="Next 7 days" />
          <CardBody noPadding>
            {data.upcomingPayments.length === 0 ? (
              <p className="px-5 py-4 text-sm text-neutral-400">None due in the next 7 days.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    <th className="px-5 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Staff
                    </th>
                    <th className="px-5 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      No.
                    </th>
                    <th className="px-5 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Due Date
                    </th>
                    <th className="px-5 py-2 text-right text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {data.upcomingPayments.map((p, i) => (
                    <tr key={i} className="hover:bg-neutral-50">
                      <td className="px-5 py-2 text-neutral-800">{p.staffName}</td>
                      <td className="px-5 py-2 text-neutral-500">#{p.instalmentNumber}</td>
                      <td className="px-5 py-2 text-neutral-600 font-mono tabular">
                        {fmtDate(p.dueDate)}
                      </td>
                      <td className="px-5 py-2 text-right font-mono tabular text-neutral-800">
                        {fmtGHS(p.dueAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recently Flagged Imports" />
          <CardBody noPadding>
            {data.recentFlaggedBatches.length === 0 ? (
              <p className="px-5 py-4 text-sm text-neutral-400">No flagged batches recently.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    <th className="px-5 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      File
                    </th>
                    <th className="px-5 py-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Period
                    </th>
                    <th className="px-5 py-2 text-right text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                      Flagged
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {data.recentFlaggedBatches.map((b, i) => (
                    <tr key={i} className="hover:bg-neutral-50">
                      <td className="px-5 py-2 text-neutral-800 truncate max-w-[160px]">
                        {b.fileName}
                      </td>
                      <td className="px-5 py-2 text-neutral-600">
                        {b.month}/{b.year}
                      </td>
                      <td className="px-5 py-2 text-right font-semibold text-danger-600">
                        {b.flaggedRows}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
