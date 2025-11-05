import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { ThresholdSettings, DEFAULT_THRESHOLDS } from '../../types/settings'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSave: (thresholds: ThresholdSettings) => void
}

export function ThresholdSettingsModal({ isOpen, onClose, onSave }: Props) {
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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      <div className="relative bg-card rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto border border-border">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-semibold text-foreground">Threshold Settings</h2>
          <Button
            onClick={onClose}
            variant="ghost"
            size="icon"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-foreground">Talk Time (seconds)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="talk-min">Minimum</Label>
                <Input
                  id="talk-min"
                  type="number"
                  value={thresholds.talkTime.min}
                  onChange={(e) => setThresholds({
                    ...thresholds,
                    talkTime: { ...thresholds.talkTime, min: parseInt(e.target.value) || 0 }
                  })}
                />
              </div>
              <div>
                <Label htmlFor="talk-max">Maximum</Label>
                <Input
                  id="talk-max"
                  type="number"
                  value={thresholds.talkTime.max}
                  onChange={(e) => setThresholds({
                    ...thresholds,
                    talkTime: { ...thresholds.talkTime, max: parseInt(e.target.value) || 0 }
                  })}
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Calls outside this range will be flagged for attention
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-foreground">Handle Time (seconds)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="handle-min">Minimum</Label>
                <Input
                  id="handle-min"
                  type="number"
                  value={thresholds.handleTime.min}
                  onChange={(e) => setThresholds({
                    ...thresholds,
                    handleTime: { ...thresholds.handleTime, min: parseInt(e.target.value) || 0 }
                  })}
                />
              </div>
              <div>
                <Label htmlFor="handle-max">Maximum</Label>
                <Input
                  id="handle-max"
                  type="number"
                  value={thresholds.handleTime.max}
                  onChange={(e) => setThresholds({
                    ...thresholds,
                    handleTime: { ...thresholds.handleTime, max: parseInt(e.target.value) || 0 }
                  })}
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-foreground">Compliance Pass Rate (%)</h3>
            <div>
              <Label htmlFor="compliance-min">Minimum Acceptable Rate</Label>
              <Input
                id="compliance-min"
                type="number"
                min="0"
                max="100"
                value={thresholds.complianceRate.min}
                onChange={(e) => setThresholds({
                  ...thresholds,
                  complianceRate: { min: parseInt(e.target.value) || 0 }
                })}
              />
              <p className="text-sm text-muted-foreground mt-1">
                Alert when team compliance rate falls below this threshold
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-foreground">Customer Satisfaction (%)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="csat-high">High Threshold</Label>
                <Input
                  id="csat-high"
                  type="number"
                  min="0"
                  max="100"
                  value={thresholds.customerSatisfaction.highThreshold}
                  onChange={(e) => setThresholds({
                    ...thresholds,
                    customerSatisfaction: {
                      ...thresholds.customerSatisfaction,
                      highThreshold: parseInt(e.target.value) || 0
                    }
                  })}
                />
                <p className="text-xs text-muted-foreground mt-1">Above this = "High"</p>
              </div>
              <div>
                <Label htmlFor="csat-low">Low Threshold</Label>
                <Input
                  id="csat-low"
                  type="number"
                  min="0"
                  max="100"
                  value={thresholds.customerSatisfaction.lowThreshold}
                  onChange={(e) => setThresholds({
                    ...thresholds,
                    customerSatisfaction: {
                      ...thresholds.customerSatisfaction,
                      lowThreshold: parseInt(e.target.value) || 0
                    }
                  })}
                />
                <p className="text-xs text-muted-foreground mt-1">Below this = "Low"</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between p-6 border-t border-border">
          <Button
            onClick={handleReset}
            variant="outline"
          >
            Reset to Defaults
          </Button>

          <div className="flex gap-3">
            <Button
              onClick={onClose}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
            >
              Save Settings
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
