import { iconBtnStyle, inputStyle } from './ui'

/**
 * A number input flanked by decrement/increment buttons.
 *
 * The buttons matter more than they look. Landing a grid that is *almost* right
 * means nudging the offset a pixel at a time while watching the overlay move,
 * and doing that by retyping a number for each step is unusable.
 */
export default function NumberNudge({ value, onChange, step = 1, label, width = 78 }) {
  const nudge = (delta) => onChange(Math.round((Number(value) + delta) * 10000) / 10000)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <button
        type="button"
        onClick={() => nudge(-step)}
        style={iconBtnStyle}
        aria-label={`${label} -${step}`}
      >
        −
      </button>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        aria-label={label}
        style={{ ...inputStyle, width }}
      />
      <button
        type="button"
        onClick={() => nudge(step)}
        style={iconBtnStyle}
        aria-label={`${label} +${step}`}
      >
        +
      </button>
    </span>
  )
}
