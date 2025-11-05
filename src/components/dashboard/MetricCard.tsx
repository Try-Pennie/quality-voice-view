import { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface MetricCardProps {
  title: string
  value: string | number
  icon: ReactNode
  className?: string
  onClick?: () => void
}

export function MetricCard({ title, value, icon, className, onClick }: MetricCardProps) {
  return (
    <div
      className={cn(
        'p-6 rounded-lg shadow border bg-card text-card-foreground',
        onClick && 'cursor-pointer transition-all hover:shadow-md',
        className
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-muted-foreground">{icon}</div>
      </div>
      <div className="text-2xl font-bold mb-1">{value}</div>
      <div className="text-sm text-muted-foreground">{title}</div>
    </div>
  )
}
