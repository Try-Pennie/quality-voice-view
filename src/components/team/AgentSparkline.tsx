import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts'
import type { TrendPoint } from '../../lib/team-queries'

export function AgentSparkline({
  points,
  color = 'var(--pennie-blue-dark, #1e3a8a)',
}: {
  points: TrendPoint[]
  color?: string
}) {
  const hasData = points.some(p => p.call_count > 0)
  if (!hasData) {
    return (
      <span className="block w-[120px] h-[28px] text-[10px] text-pennie-graphite/40 leading-[28px]">
        No data
      </span>
    )
  }
  return (
    <div className="w-[120px] h-[28px]" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={[0, 100]} />
          <Line
            type="monotone"
            dataKey="compliance_pass_rate"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
