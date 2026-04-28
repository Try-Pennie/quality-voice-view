import { useEffect, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet'
import { ThresholdSettings, DEFAULT_THRESHOLDS } from '../../types/settings'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { HelpHint } from '../ui/help-hint'
import type { HelpId } from '../../lib/help-content'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSave: (thresholds: ThresholdSettings) => void
}

export function ThresholdSettingsSheet({ isOpen, onClose, onSave }: Props) {
  const [thresholds, setThresholds] = useState<ThresholdSettings>(DEFAULT_THRESHOLDS)

  useEffect(() => {
    const saved = localStorage.getItem('thresholdSettings')
    if (saved) {
      try {
        setThresholds(JSON.parse(saved))
      } catch (e) {
        console.error('Failed to parse threshold settings', e)
      }
    }
  }, [])

  const handleSave = () => {
    localStorage.setItem('thresholdSettings', JSON.stringify(thresholds))
    onSave(thresholds)
    onClose()
  }

  const handleReset = () => {
    setThresholds(DEFAULT_THRESHOLDS)
  }

  return (
    <Sheet open={isOpen} onOpenChange={open => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col gap-0 p-0 overflow-hidden bg-pennie-white"
      >
        <SheetHeader className="px-8 py-5 border-b border-border text-left">
          <SheetTitle className="text-xl font-semibold text-pennie-navy">
            Threshold settings
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            Set the bands that mark calls as needing attention.
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-7">
          <FieldGroup
            title="Talk time"
            unit="seconds"
            helpId="setting.talk_time"
          >
            <NumberField
              id="talk-min"
              label="Minimum"
              value={thresholds.talkTime.min}
              onChange={n =>
                setThresholds({
                  ...thresholds,
                  talkTime: { ...thresholds.talkTime, min: n },
                })
              }
            />
            <NumberField
              id="talk-max"
              label="Maximum"
              value={thresholds.talkTime.max}
              onChange={n =>
                setThresholds({
                  ...thresholds,
                  talkTime: { ...thresholds.talkTime, max: n },
                })
              }
            />
          </FieldGroup>

          <FieldGroup title="Handle time" unit="seconds" helpId="setting.handle_time">
            <NumberField
              id="handle-min"
              label="Minimum"
              value={thresholds.handleTime.min}
              onChange={n =>
                setThresholds({
                  ...thresholds,
                  handleTime: { ...thresholds.handleTime, min: n },
                })
              }
            />
            <NumberField
              id="handle-max"
              label="Maximum"
              value={thresholds.handleTime.max}
              onChange={n =>
                setThresholds({
                  ...thresholds,
                  handleTime: { ...thresholds.handleTime, max: n },
                })
              }
            />
          </FieldGroup>

          <FieldGroup
            title="Compliance pass rate"
            unit="%"
            helpId="setting.compliance_threshold"
          >
            <NumberField
              id="compliance-min"
              label="Minimum acceptable rate"
              min={0}
              max={100}
              value={thresholds.complianceRate.min}
              onChange={n =>
                setThresholds({
                  ...thresholds,
                  complianceRate: { min: n },
                })
              }
              className="col-span-2"
            />
          </FieldGroup>

          <FieldGroup title="Customer satisfaction" unit="%" helpId="setting.csat_thresholds">
            <NumberField
              id="csat-high"
              label="High threshold"
              hint='Above this = "High"'
              min={0}
              max={100}
              value={thresholds.customerSatisfaction.highThreshold}
              onChange={n =>
                setThresholds({
                  ...thresholds,
                  customerSatisfaction: {
                    ...thresholds.customerSatisfaction,
                    highThreshold: n,
                  },
                })
              }
            />
            <NumberField
              id="csat-low"
              label="Low threshold"
              hint='Below this = "Low"'
              min={0}
              max={100}
              value={thresholds.customerSatisfaction.lowThreshold}
              onChange={n =>
                setThresholds({
                  ...thresholds,
                  customerSatisfaction: {
                    ...thresholds.customerSatisfaction,
                    lowThreshold: n,
                  },
                })
              }
            />
          </FieldGroup>
        </div>

        <SheetFooter className="border-t border-border bg-pennie-beige/40 px-8 py-4 flex-row sm:flex-row sm:justify-between gap-3">
          <button
            type="button"
            onClick={handleReset}
            className="min-h-[40px] px-4 py-2 rounded-full text-sm font-semibold text-pennie-graphite hover:bg-pennie-white border border-border transition-colors"
          >
            Reset to defaults
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] px-4 py-2 rounded-full text-sm font-semibold text-pennie-graphite hover:bg-pennie-white border border-border transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="min-h-[40px] px-5 py-2 rounded-full bg-pennie-navy text-pennie-white text-sm font-semibold hover:bg-pennie-navy/90 transition-colors"
            >
              Save settings
            </button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function FieldGroup({
  title,
  unit,
  helpId,
  children,
}: {
  title: string
  unit?: string
  helpId?: HelpId
  children: React.ReactNode
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="flex items-baseline gap-2">
        <span className="text-base font-semibold text-pennie-navy inline-flex items-baseline gap-1.5">
          {title}
          {helpId && <HelpHint id={helpId} />}
        </span>
        {unit && (
          <span className="text-xs text-muted-foreground">({unit})</span>
        )}
      </legend>
      <div className="grid grid-cols-2 gap-4">{children}</div>
    </fieldset>
  )
}

function NumberField({
  id,
  label,
  value,
  onChange,
  hint,
  min,
  max,
  className,
}: {
  id: string
  label: string
  value: number
  onChange: (n: number) => void
  hint?: string
  min?: number
  max?: number
  className?: string
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="text-sm font-semibold text-pennie-graphite">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(parseInt(e.target.value) || 0)}
        className="mt-1.5"
      />
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  )
}
