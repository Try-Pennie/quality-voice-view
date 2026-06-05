import { Inbox } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * No-data state. Visually distinct from <ErrorState> so "nothing here"
 * never reads as "it broke". Markup mirrors the existing alerts empty
 * block (AlertsPage) so adopting it is a drop-in.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  message,
}: {
  icon?: LucideIcon
  title: string
  message?: string
}) {
  return (
    <div className="p-16 text-center">
      <div className="pennie-icon-chip mx-auto mb-4 bg-pennie-beige">
        <Icon className="w-6 h-6 text-pennie-navy" aria-hidden="true" />
      </div>
      <p className="text-pennie-navy font-semibold text-lg">{title}</p>
      {message && <p className="text-sm text-muted-foreground mt-1">{message}</p>}
    </div>
  )
}
