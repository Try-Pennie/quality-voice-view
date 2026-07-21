import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

/**
 * Sortable table header cell in the Pennie table vocabulary (uppercase 11px
 * bold label). Renders `aria-sort` and a direction arrow when active.
 */
export function SortableTh({
  label,
  active,
  desc,
  onClick,
  className = 'px-4 sm:px-6 py-3',
}: {
  label: string
  active: boolean
  desc: boolean
  onClick: () => void
  className?: string
}) {
  const Icon = active ? (desc ? ArrowDown : ArrowUp) : ArrowUpDown
  return (
    <th
      className={`${className} text-left`}
      aria-sort={active ? (desc ? 'descending' : 'ascending') : undefined}
    >
      <button
        type="button"
        onClick={onClick}
        className={`pennie-focus-ring inline-flex items-center gap-1 rounded-full text-[11px] font-bold uppercase tracking-[0.06em] transition-colors ${
          active
            ? 'text-pennie-navy'
            : 'text-pennie-graphite/70 hover:text-pennie-navy'
        }`}
      >
        {label}
        <Icon
          className={`w-3 h-3 ${active ? '' : 'opacity-50'}`}
          aria-hidden="true"
        />
      </button>
    </th>
  )
}
