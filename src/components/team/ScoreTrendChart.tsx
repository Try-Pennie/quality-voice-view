import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import type { TrendPoint } from '../../lib/team-queries'
import { ChartCard } from './ChartCard'

const PENNIE_NAVY = '#0a1f3d'
const PENNIE_BLUE_DARK = '#1e3a8a'
const PENNIE_BEIGE = '#e8e1d4'

export function ScoreTrendChart({
  points,
  loading,
}: {
  points: TrendPoint[]
  loading: boolean
}) {
  const hasData = points.some(p => p.call_count > 0)

  return (
    <ChartCard
      title="Compliance trend"
      subtitle="Pass-rate over time"
      loading={loading}
    >
      {!hasData ? (
        <EmptyChart label="No QA data in this window" />
      ) : (
        <div role="img" aria-label="Compliance pass rate over time" className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
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
                domain={[0, 100]}
                stroke={PENNIE_NAVY}
                tick={{ fontSize: 11, fill: PENNIE_NAVY }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => `${v}%`}
                width={36}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: 'none',
                  boxShadow: '0 4px 16px rgba(10,31,61,0.12)',
                  fontSize: 12,
                }}
                formatter={(v: number) => [`${v}%`, 'Compliance']}
              />
              <ReferenceLine
                y={80}
                stroke={PENNIE_BEIGE}
                strokeDasharray="4 4"
                label={{ value: 'Target 80%', fill: PENNIE_NAVY, fontSize: 10, position: 'right' }}
              />
              <Line
                type="monotone"
                dataKey="compliance_pass_rate"
                stroke={PENNIE_BLUE_DARK}
                strokeWidth={2.5}
                dot={{ r: 3, fill: PENNIE_BLUE_DARK }}
                activeDot={{ r: 5 }}
                isAnimationActive
              />
            </LineChart>
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
