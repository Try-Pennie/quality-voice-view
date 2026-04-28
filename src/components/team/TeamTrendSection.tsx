import type { TrendPoint } from '../../lib/team-queries'
import { ScoreTrendChart } from './ScoreTrendChart'
import { CSATDistributionChart } from './CSATDistributionChart'
import { CallVolumeChart } from './CallVolumeChart'

export function TeamTrendSection({
  points,
  loading,
}: {
  points: TrendPoint[]
  loading: boolean
}) {
  return (
    <section aria-label="Team performance trends" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <ScoreTrendChart points={points} loading={loading} />
      <CSATDistributionChart points={points} loading={loading} />
      <CallVolumeChart points={points} loading={loading} />
    </section>
  )
}
