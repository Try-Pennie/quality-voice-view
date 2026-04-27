import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { TrendPoint } from '../../lib/team-queries'
import { ChartCard } from './ChartCard'

const PENNIE_NAVY = '#0a1f3d'
const PENNIE_BEIGE = '#e8e1d4'
const COLORS = {
  high: '#3a7d4f', // pennie-green-dark
  medium: '#1e3a8a', // pennie-blue-dark
  low: '#b35a3a', // pennie-peach-dark
}

export function CSATDistributionChart({
  points,
  loading,
}: {
  points: TrendPoint[]
  loading: boolean
}) {
  const hasData = points.some(
    p => p.csat_high + p.csat_medium + p.csat_low > 0,
  )

  return (
    <ChartCard
      title="Customer satisfaction"
      subtitle="High / medium / low per bucket"
      loading={loading}
    >
      {!hasData ? (
        <EmptyChart label="No CSAT data in this window" />
      ) : (
        <div role="img" aria-label="Customer satisfaction distribution over time" className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={points}
              margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
            >
              <CartesianGrid stroke={PENNIE_BEIGE} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                stroke={PENNIE_NAVY}
                tick={{ fontSize: 11, fill: PENNIE_NAVY }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke={PENNIE_NAVY}
                tick={{ fontSize: 11, fill: PENNIE_NAVY }}
                tickLine={false}
                axisLine={false}
                width={28}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: 'none',
                  boxShadow: '0 4px 16px rgba(10,31,61,0.12)',
                  fontSize: 12,
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                iconType="circle"
              />
              <Bar dataKey="csat_high" name="High" stackId="csat" fill={COLORS.high} radius={[4, 4, 0, 0]} />
              <Bar dataKey="csat_medium" name="Medium" stackId="csat" fill={COLORS.medium} />
              <Bar dataKey="csat_low" name="Low" stackId="csat" fill={COLORS.low} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-[240px] flex items-center justify-center text-sm text-pennie-graphite/50">
      {label}
    </div>
  )
}
