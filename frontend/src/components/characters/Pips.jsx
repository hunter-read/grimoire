/**
 * A count drawn as boxes, ticked off as it is used - `<g-pips>` in a layout.
 *
 * Four level 1 spell slots are four boxes; casting a spell ticks one. The same
 * shape serves anything a sheet counts down and recovers: stress, hit dice, a
 * feature's uses. `used` is the number ticked, stored as an ordinary number.
 *
 * Ticking an empty box ticks everything up to it; unticking a ticked one clears
 * it and everything after, so the boxes always read left to right.
 */
export default function Pips({ count, used, label, disabled, onChange }) {
  const total = Math.max(0, Math.min(Number(count) || 0, 30))
  const ticked = Math.max(0, Math.min(Number(used) || 0, total))
  if (!total) return <span className="gc-pips gc-pips-empty">—</span>

  return (
    <span className="gc-pips" style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
      {Array.from({ length: total }, (_, index) => (
        <input
          key={index}
          type="checkbox"
          checked={index < ticked}
          disabled={disabled}
          aria-label={`${label} ${index + 1}`}
          onChange={() => onChange?.(index < ticked ? index : index + 1)}
          style={{ width: 14, height: 14, margin: 0, accentColor: 'var(--gold)' }}
        />
      ))}
    </span>
  )
}
