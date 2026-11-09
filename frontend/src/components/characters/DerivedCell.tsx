import { useState } from 'react'
import FieldRenderer from './FieldRenderer'
import type { FieldDefinition } from './FieldRenderer'
import { emptyCellFor, isEmptyCell } from './expressions'

interface Props {
  name: string
  definition: FieldDefinition & { default_from?: unknown }
  /** What the row stores for this cell. */
  stored: unknown
  /** What the sheet worked the cell out to be, for a `default_from` column. */
  worked: unknown
  onChange?: (value: unknown) => void
  readOnly?: boolean
  hideLabel?: boolean
}

/**
 * One cell of a `list` row, in a table or a `<g-repeat>`.
 *
 * A column with `default_from` shows its worked-out value while the cell is
 * empty, marked as automatic; typing over it makes the cell the player's, and
 * the reset button or clearing the cell hands it back. A cell the player has
 * just emptied stays empty until they leave it, so deleting "40" to type "45"
 * doesn't bring the 40 straight back under the cursor.
 *
 * Only `stored` is ever written: every edit goes through `onChange` with the
 * cell's own value, never the derived one, which would freeze it.
 */
export default function DerivedCell({
  name,
  definition,
  stored,
  worked,
  onChange,
  readOnly = false,
  hideLabel = false,
}: Props) {
  const [cleared, setCleared] = useState(false)
  const derivable = !!definition.default_from
  const empty = isEmptyCell(stored)
  const derived = derivable && empty && !cleared
  // Offered whenever the cell is not showing its automatic value - a cell the
  // player just emptied included, where it brings the value back at once. That
  // also keeps the field's shape steady while they edit, so the input is never
  // swapped out from under the cursor.
  const reset = () => {
    setCleared(false)
    if (!empty) onChange?.(emptyCellFor(definition.type))
  }
  if (!derivable) {
    // A plain cell is drawn exactly as before, with no wrapper a sheet's
    // stylesheet would have to know about.
    return (
      <FieldRenderer
        name={name}
        definition={definition}
        value={stored}
        onChange={readOnly ? undefined : onChange}
        readOnly={readOnly}
        hideLabel={hideLabel}
      />
    )
  }
  return (
    // `display: contents` so a sheet's own grid sees the field, not this.
    <div style={{ display: 'contents' }} onBlur={() => setCleared(false)}>
      <FieldRenderer
        name={name}
        definition={definition}
        value={derived ? (worked ?? stored) : stored}
        derived={!readOnly && derived}
        onReset={readOnly || derived ? undefined : reset}
        onChange={
          readOnly || !onChange
            ? undefined
            : (value) => {
                setCleared(isEmptyCell(value))
                onChange(value)
              }
        }
        readOnly={readOnly}
        hideLabel={hideLabel}
      />
    </div>
  )
}
