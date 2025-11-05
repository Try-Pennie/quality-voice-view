import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'

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
  onEndDateChange
}: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-foreground">Date Range:</label>
      <DatePicker
        selected={startDate}
        onChange={(date: Date | null) => date && onStartDateChange(date)}
        maxDate={new Date()}
        className="px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        dateFormat="MM/dd/yyyy"
      />
      <span className="text-muted-foreground">to</span>
      <DatePicker
        selected={endDate}
        onChange={(date: Date | null) => date && onEndDateChange(date)}
        minDate={startDate}
        maxDate={new Date()}
        className="px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        dateFormat="MM/dd/yyyy"
      />
    </div>
  )
}
