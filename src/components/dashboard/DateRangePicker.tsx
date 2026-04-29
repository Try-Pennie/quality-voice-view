import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { BUSINESS_TIMEZONE_LABEL } from '../../lib/time-zone'

interface DateRangePickerProps {
  startDate: Date
  endDate: Date
  onStartDateChange: (date: Date) => void
  onEndDateChange: (date: Date) => void
}

export function DateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: DateRangePickerProps) {
  const today = new Date()

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-foreground">Date Range:</label>
      <DatePicker
        selected={startDate}
        onChange={(date: Date | null) => date && onStartDateChange(date)}
        maxDate={today}
        className="px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        dateFormat="MM/dd/yyyy"
      />
      <span className="text-muted-foreground">to</span>
      <DatePicker
        selected={endDate}
        onChange={(date: Date | null) => date && onEndDateChange(date)}
        minDate={startDate}
        maxDate={today}
        className="px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        dateFormat="MM/dd/yyyy"
      />
      <span
        className="text-xs font-medium text-pennie-graphite/60 ml-1 px-2 py-0.5 rounded-full bg-pennie-beige/60"
        title="All dates and chart buckets are in Eastern Time"
      >
        {BUSINESS_TIMEZONE_LABEL}
      </span>
    </div>
  )
}
