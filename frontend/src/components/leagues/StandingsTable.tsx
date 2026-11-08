import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { Schema } from '../../api'
import { card, muted, sectionTitle } from '../armies/armyStyles'

const COLUMNS = ['played', 'won', 'drawn', 'lost', 'score_for', 'score_against', 'points'] as const

interface StandingsTableProps {
  rows: Schema<'StandingRow'>[]
}

/** The league table: members ranked by league points, then score difference. */
export default function StandingsTable({ rows }: StandingsTableProps) {
  const { t } = useTranslation()
  return (
    <section style={card}>
      <h2 style={sectionTitle}>{t('leagues.standings')}</h2>
      {rows.length === 0 ? (
        <p style={muted}>{t('leagues.noMembers')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>#</th>
                <th style={{ ...th, textAlign: 'left' }}>{t('leagues.player')}</th>
                {COLUMNS.map((c) => (
                  <th key={c} style={th}>
                    <abbr title={t(`leagues.columns.${c}`)} style={{ textDecoration: 'none' }}>
                      {t(`leagues.columnsShort.${c}`)}
                    </abbr>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.user_id}>
                  <td style={td}>{i + 1}</td>
                  <td style={{ ...td, textAlign: 'left' }}>{row.name}</td>
                  {COLUMNS.map((c) => (
                    <td key={c} style={{ ...td, fontWeight: c === 'points' ? 600 : 400 }}>
                      {row[c]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const th: CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text-muted)',
  fontWeight: 500,
  textAlign: 'center',
}
const td: CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid var(--border)',
  textAlign: 'center',
}
