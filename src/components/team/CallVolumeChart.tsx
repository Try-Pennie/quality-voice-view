import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { TrendPoint } from '../../lib/team-queries'
import { ChartCard } from './ChartCard'

const PENNIE_NAVY = '#0a1f3d'
const PENNIE_BLUE_DARK = '#1e3a8a'
const PENNIE_PEACH_DARK = '#b35a3a'
const PENNIE_BEIGE = '#e8e1d4'

export function CallVolumeChart({
  points,
  loading,
}: {
  points: TrendPoint[]
  loading: boolean
}) {
  const hasData = points.some(p => p.call_count > 0)

  return (
    <ChartCard title="Call volume" subtitle="Calls + escalations" loading={loading}>
      {!hasData ? (
        <EmptyChart label="No calls in this window" />
      ) : (
        <div role="img" aria-label="Call volume and escalations over time" className="h-[240px]">
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
              <Bar
                dataKey="call_count"
                name="Calls"
                fill={PENNIE_BLUE_DARK}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="escalations"
                name="Escalations"
                fill={PENNIE_PEACH_DARK}
                radius={[4, 4, 0, 0]}
              />
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
