import { useTranslation } from 'react-i18next'

/**
 * Field-by-field diff, differing rows first.
 *
 * Sorted that way because the differences are what decide the call: a user
 * scanning this table wants "what is not the same about these two" without
 * reading past a dozen identical rows to find it.
 */
export default function DiffTable({ differences }) {
  const { t } = useTranslation()
  const rows = [...differences].sort((a, b) => Number(a.same) - Number(b.same))
  if (rows.length === 0) return null
  return (
    <div style={{ overflowX: 'auto', marginBottom: 20 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 480 }}>
        <tbody>
          {rows.map((d) => (
            <tr
              key={d.field}
              style={{
                borderTop: '1px solid var(--border)',
                background: d.same ? 'transparent' : 'rgba(212,175,55,0.06)',
              }}
            >
              <th
                scope="row"
                style={{
                  textAlign: 'left',
                  padding: '7px 10px',
                  color: 'var(--text-muted)',
                  fontWeight: 400,
                  whiteSpace: 'nowrap',
                }}
              >
                {t(`maintenance.dupes.field.${d.field}`, { defaultValue: d.field })}
              </th>
              {d.values.map((v, i) => (
                <td
                  key={i}
                  style={{
                    padding: '7px 10px',
                    wordBreak: 'break-word',
                    color: d.same ? 'var(--text-dim)' : 'var(--text)',
                  }}
                >
                  {v || '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
