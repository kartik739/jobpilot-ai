'use client'

// ─── Preset options ────────────────────────────────────────────────────────────

const PRESETS: { label: string; days: number }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
  { label: '365d', days: 365 },
]

// ─── Component ─────────────────────────────────────────────────────────────────

interface DateRangePickerProps {
  value: number
  onChange: (days: number) => void
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  return (
    <div
      role="group"
      aria-label="Date range filter"
      className="flex items-center gap-1 bg-gray-100 rounded-lg p-1"
    >
      {PRESETS.map((preset) => (
        <button
          key={preset.days}
          type="button"
          onClick={() => onChange(preset.days)}
          aria-pressed={value === preset.days}
          aria-label={`Show last ${preset.label}`}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            value === preset.days
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  )
}
