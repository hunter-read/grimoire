import Pips from '../../characters/Pips'
import type { PartyCharacter, PartyStat } from '../types'
import Stepper from './Stepper'

interface PartyStatViewProps {
  character: PartyCharacter
  stat: PartyStat
  /** The GM may change it: an editable sheet, and a field rather than a formula. */
  editable: boolean
  onChange: (value: number) => void
}

const numeric = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** One stat on a party card: a number, or a track of boxes. */
export default function PartyStatView({ character, stat, editable, onChange }: PartyStatViewProps) {
  const raw = character.values[stat.value]
  const value = numeric(raw)
  const max = typeof stat.max === 'string' ? numeric(character.values[stat.max]) : numeric(stat.max)
  const label = `${character.name}: ${stat.label}`

  let shown
  if (stat.style === 'pips' && max !== null) {
    shown = (
      <Pips
        count={max}
        used={value ?? 0}
        label={label}
        disabled={!editable}
        onChange={(used) => onChange(used)}
      />
    )
  } else if (editable && (value !== null || raw === undefined)) {
    shown = <Stepper value={value ?? 0} label={label} max={max} onChange={onChange} />
  } else {
    const text = raw === undefined || raw === null || raw === '' ? '—' : String(raw)
    shown = (
      <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {text}
        {max !== null && stat.style !== 'pips' && (
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> / {max}</span>
        )}
      </span>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      <span style={{ color: 'var(--text-dim)', minWidth: 60 }}>{stat.label}</span>
      {shown}
    </div>
  )
}
