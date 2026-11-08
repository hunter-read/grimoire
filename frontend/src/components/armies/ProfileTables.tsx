import type { CSSProperties } from 'react'
import type { Schema } from '../../api'

type Profile = Schema<'RosterProfile'>

interface ProfileTablesProps {
  profiles?: Profile[]
}

// Stat lines grouped by profile type ("Unit", "Ranged Weapons"), one table each.
function byType(profiles: Profile[]): [string, Profile[]][] {
  const groups = new Map<string, Profile[]>()
  for (const profile of profiles) {
    const key = profile.type || ''
    const group = groups.get(key)
    if (group) group.push(profile)
    else groups.set(key, [profile])
  }
  return [...groups.entries()]
}

/** A unit's stat lines, as the roster gave them: one table per profile type. */
export default function ProfileTables({ profiles = [] }: ProfileTablesProps) {
  return (
    <>
      {byType(profiles).map(([type, rows]) => (
        <div key={type} style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={th}>{type}</th>
                {(rows[0]?.characteristics ?? []).map((c) => (
                  <th key={c.name} style={th}>
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.name}-${i}`}>
                  <td style={td}>{row.name}</td>
                  {(row.characteristics ?? []).map((c) => (
                    <td key={c.name} style={td}>
                      {c.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  )
}

const th: CSSProperties = {
  textAlign: 'left',
  padding: '4px 8px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text-muted)',
  fontWeight: 500,
}
const td: CSSProperties = { padding: '4px 8px', borderBottom: '1px solid var(--border)' }
