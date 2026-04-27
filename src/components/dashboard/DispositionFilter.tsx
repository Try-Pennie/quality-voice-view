interface DispositionFilterProps {
  available: string[]
  selected: string[]
  onSelectionChange: (dispositions: string[]) => void
}

export function DispositionFilter({
  available,
  selected,
  onSelectionChange,
}: DispositionFilterProps) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    if (value === '') {
      onSelectionChange([])
      return
    }
    if (selected.includes(value)) {
      onSelectionChange(selected.filter(d => d !== value))
    } else {
      onSelectionChange([...selected, value])
    }
  }

  return (
    <div className="relative inline-block">
      <label className="text-sm font-medium text-foreground mr-2">
        Disposition:
      </label>
      <select
        value={selected.length === 0 ? '' : selected[0]}
        onChange={handleChange}
        className="px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring min-w-[200px]"
      >
        <option value="">All dispositions</option>
        {available.map(d => (
          <option key={d} value={d}>
            {prettify(d)}
          </option>
        ))}
      </select>
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {selected.map(d => (
            <span
              key={d}
              className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary text-xs rounded"
            >
              {prettify(d)}
              <button
                onClick={() => onSelectionChange(selected.filter(x => x !== d))}
                className="hover:text-primary/80"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function prettify(s: string): string {
  return s
    .split(/[_\s]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}
