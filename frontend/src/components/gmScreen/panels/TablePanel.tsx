import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuDices } from 'react-icons/lu'
import { ghostBtn, goldBtn } from '../../characters/characterStyles'
import { tableConfig, tableRolls, type TableColumn } from '../types'
import type { PanelBodyProps } from './panelProps'

/** A fair roll of 1 to `size`. */
export function rollDie(size: number): number {
  const limit = Math.floor(0x100000000 / size) * size
  const value = new Uint32Array(1)
  do crypto.getRandomValues(value)
  while (value[0] >= limit)
  return (value[0] % size) + 1
}

const cell: CSSProperties = { padding: '2px 6px', verticalAlign: 'top', textAlign: 'left' }

/**
 * A random table: roll, and the result shows above the table with its row
 * marked. Columns are rolled together - a name's start, middle and end, or a
 * trait and a quirk - each on its own die, the number of entries it has.
 */
export default function TablePanel({ panel, onState }: PanelBodyProps) {
  const { t } = useTranslation()
  const config = tableConfig(panel.config)
  const rolls = tableRolls(panel.state, config)
  const { columns } = config

  if (columns.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        {t('gmScreen.table.empty')}
      </p>
    )
  }

  const dice = columns.map((column) => t('gmScreen.table.die', { size: column.entries.length }))
  const picks = rolls.map((roll, index) => columns[index].entries[roll - 1])
  const labelOf = (column: TableColumn, index: number) =>
    column.label || t('gmScreen.table.column', { number: index + 1 })
  const rows = Math.max(...columns.map((column) => column.entries.length))

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          type="button"
          onClick={() =>
            onState({ rolls: columns.map((column) => rollDie(column.entries.length)) })
          }
          style={{ ...goldBtn, padding: '5px 12px' }}
        >
          <LuDices size={14} aria-hidden="true" />{' '}
          {t('gmScreen.table.roll', { dice: dice.join(' + ') })}
        </button>
        {rolls.length > 0 && (
          <button
            type="button"
            onClick={() => onState({ rolls: [] })}
            style={{ ...ghostBtn, padding: '5px 10px' }}
          >
            {t('gmScreen.table.clear')}
          </button>
        )}
      </div>
      <div aria-live="polite" data-testid="table-result">
        {rolls.length > 0 &&
          (config.mode === 'join' ? (
            <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              {picks.join('')}{' '}
              <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>
                ({rolls.join(', ')})
              </span>
            </p>
          ) : (
            <dl style={{ margin: 0, display: 'grid', gap: 2, fontSize: 14 }}>
              {columns.map((column, index) => (
                <div key={column.id} style={{ display: 'flex', gap: 6 }}>
                  {columns.length > 1 && (
                    <dt style={{ color: 'var(--text-muted)' }}>{labelOf(column, index)}:</dt>
                  )}
                  <dd style={{ margin: 0, fontWeight: 600 }}>
                    {picks[index]}{' '}
                    <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                      ({rolls[index]})
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          ))}
      </div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%' }}>
        <thead>
          <tr style={{ color: 'var(--text-muted)' }}>
            <th scope="col" style={cell}>
              {columns.length === 1 ? dice[0] : '#'}
            </th>
            {columns.map((column, index) => (
              <th key={column.id} scope="col" style={cell}>
                {columns.length === 1 ? column.label : `${labelOf(column, index)} (${dice[index]})`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ ...cell, color: 'var(--text-muted)' }}>{row + 1}</td>
              {columns.map((column, index) => {
                const rolled = rolls[index] === row + 1
                return (
                  <td
                    key={column.id}
                    aria-current={rolled ? 'true' : undefined}
                    style={{
                      ...cell,
                      fontWeight: rolled ? 600 : undefined,
                      background: rolled ? 'var(--bg-card-hover)' : undefined,
                    }}
                  >
                    {column.entries[row] ?? ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
