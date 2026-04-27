import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'

interface DateRangePickerProps {
  startDate: Date
  endDate: Date
  onStartDateChange: (date: Date) => void
  onEndDateChange: (date: Date) => void
  maxRangeDays?: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function DateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  maxRangeDays,
}: DateRangePickerProps) {
  const today = new Date()
  const endMaxDate =
    maxRangeDays !== undefined
      ? new Date(
          Math.min(
            today.getTime(),
            startDate.getTime() + maxRangeDays * MS_PER_DAY,
          ),
        )
      : today

  const handleStartChange = (date: Date | null) => {
    if (!date) return
    onStartDateChange(date)
    if (maxRangeDays !== undefined) {
      const cap = date.getTime() + maxRangeDays * MS_PER_DAY
      if (endDate.getTime() > cap) {
        const snapped = new Date(Math.min(today.getTime(), cap))
        snapped.setHours(23, 59, 59, 999)
        onEndDateChange(snapped)
      }
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-foreground">Date Range:</label>
      <DatePicker
        selected={startDate}
        onChange={handleStartChange}
        maxDate={today}
        className="px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        dateFormat="MM/dd/yyyy"
      />
      <span className="text-muted-foreground">to</span>
      <DatePicker
        selected={endDate}
        onChange={(date: Date | null) => date && onEndDateChange(date)}
        minDate={startDate}
        maxDate={endMaxDate}
        className="px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        dateFormat="MM/dd/yyyy"
      />
      {maxRangeDays !== undefined && (
        <span className="text-xs text-muted-foreground ml-1">
          Max {maxRangeDays} days
        </span>
      )}
    </div>
  )
}
