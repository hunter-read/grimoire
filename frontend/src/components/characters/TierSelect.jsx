/**
 * One value's rung on a ladder of lists - `<g-tier>` in a layout.
 *
 * A skill is not proficient, proficient, or has expertise: three states kept in
 * two lists (proficiencies, expertise), which the pick rules grant into. This
 * shows the state as one dropdown instead of two boxes to reason about.
 *
 * Closed, it shows the short label - "—", "Prof", "Exp" - so a column of skills
 * stays narrow; opened, the list shows the full names. That is a native select
 * with its own text made transparent and the short label laid over it in the
 * same grid cell, so it keeps the platform's keyboard and screen-reader
 * behaviour, which reads the full name.
 *
 * Choosing a rung puts the value in every list up to it and takes it out of
 * every list above: expertise implies proficiency, and dropping to proficient
 * removes the expertise.
 */
export default function TierSelect({ level, labels, titles, label, disabled, onChange }) {
  return (
    <span className="gc-tier" style={{ display: 'inline-grid', alignItems: 'center' }}>
      <select
        value={level}
        disabled={disabled}
        aria-label={label}
        title={titles[level] || labels[level]}
        onChange={(event) => onChange?.(Number(event.target.value))}
        style={{
          gridArea: '1 / 1',
          width: '100%',
          minWidth: 0,
          padding: '2px 4px',
          font: 'inherit',
          fontSize: 11,
          color: 'transparent',
          background: 'var(--bg-deep)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        {labels.map((short, index) => (
          <option key={index} value={index} style={{ color: 'var(--text)' }}>
            {titles[index] || short}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        style={{
          gridArea: '1 / 1',
          pointerEvents: 'none',
          padding: '0 6px',
          fontSize: 11,
          fontWeight: level ? 700 : 400,
          color: level ? 'var(--gold)' : 'var(--text-muted)',
          whiteSpace: 'nowrap',
        }}
      >
        {labels[level]}
      </span>
    </span>
  )
}
