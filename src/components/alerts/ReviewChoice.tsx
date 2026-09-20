import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type ReviewChoiceProps = {
  readonly name: string
  readonly label: ReactNode
  readonly checked: boolean
  readonly onChange: () => void
  readonly ariaLabel?: string
  readonly disabled?: boolean
  readonly pill?: boolean
}

/** Native radio styled consistently across every review workspace. */
export function ReviewChoice({ name, label, checked, onChange, ariaLabel, disabled, pill = true }: ReviewChoiceProps) {
  return <label className={cn(
    'flex min-h-[44px] cursor-pointer items-center gap-2 border px-3 py-2 text-sm font-semibold has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50',
    pill ? 'rounded-full' : 'rounded-xl',
    checked
      ? 'border-pennie-blue-deeper bg-pennie-blue-light text-pennie-navy'
      : 'border-border bg-white text-pennie-graphite hover:bg-pennie-blue-light/50',
  )}>
    <input
      type="radio"
      name={name}
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className="pennie-focus-ring h-4 w-4 shrink-0 accent-pennie-blue-deeper"
    />
    <span>{label}</span>
  </label>
}
