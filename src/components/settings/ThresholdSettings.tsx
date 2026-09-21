import { useEffect, useId, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet'
import { DEFAULT_THRESHOLDS, type ThresholdSettings } from '../../types/settings'

interface Props {
  readonly isOpen: boolean
  readonly thresholds: ThresholdSettings
  readonly onClose: () => void
  readonly onSave: (thresholds: ThresholdSettings) => void
}

export function ThresholdSettingsSheet({ isOpen, thresholds, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(thresholds)

  useEffect(() => {
    if (isOpen) setDraft(thresholds)
  }, [isOpen, thresholds])

  return (
    <Sheet open={isOpen} onOpenChange={open => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden bg-pennie-white p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-8 py-5 text-left">
          <SheetTitle className="text-xl font-semibold text-pennie-navy">Threshold settings</SheetTitle>
          <p className="text-sm text-muted-foreground">Choose which AI ratings appear in the Below threshold filter.</p>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-8 py-6">
          <SelectField label="Overall score at or below" value={draft.overallScore}
            onChange={overallScore => setDraft({ ...draft, overallScore })}
            options={[
              ['excellent', 'Excellent'], ['good', 'Good'],
              ['needs_improvement', 'Needs improvement'], ['poor', 'Poor'],
            ]} />
          <SelectField label="Compliance rating" value={draft.compliance}
            onChange={compliance => setDraft({ ...draft, compliance })}
            options={[["fail", "Fail"], ["pass", "Pass"]]} />
          <SelectField label="Customer satisfaction at or below" value={draft.customerSat}
            onChange={customerSat => setDraft({ ...draft, customerSat })}
            options={[["high", "High"], ["medium", "Medium"], ["low", "Low"]]} />
        </div>

        <SheetFooter className="flex-row gap-3 border-t border-border bg-pennie-beige/40 px-8 py-4 sm:flex-row sm:justify-between">
          <button type="button" onClick={() => setDraft(DEFAULT_THRESHOLDS)} className="min-h-[44px] rounded-full border border-border px-4 py-2 text-sm font-semibold text-pennie-graphite transition-colors hover:bg-pennie-white">Reset to defaults</button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="min-h-[44px] rounded-full border border-border px-4 py-2 text-sm font-semibold text-pennie-graphite transition-colors hover:bg-pennie-white">Cancel</button>
            <button type="button" onClick={() => { onSave(draft); onClose() }} className="min-h-[44px] rounded-full bg-pennie-navy px-5 py-2 text-sm font-semibold text-pennie-white transition-colors hover:bg-pennie-navy/90 motion-safe:active:scale-[0.96]">Save settings</button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function SelectField<T extends string>({ label, value, options, onChange }: {
  readonly label: string
  readonly value: T
  readonly options: readonly (readonly [T, string])[]
  readonly onChange: (value: T) => void
}) {
  const id = useId()
  return <div>
    <label htmlFor={id} className="block text-sm font-semibold text-pennie-graphite">{label}</label>
    <select id={id} value={value} onChange={event => {
      const selected = options.find(([option]) => option === event.target.value)?.[0]
      if (selected !== undefined) onChange(selected)
    }} className="pennie-focus-ring mt-1.5 min-h-[44px] w-full rounded-lg border border-input bg-pennie-white px-3 text-base font-normal text-pennie-graphite sm:text-sm">
      {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
    </select>
  </div>
}
