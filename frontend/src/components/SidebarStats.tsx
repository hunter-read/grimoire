import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChartColumn } from 'react-icons/lu'
import type { Schema } from '../api'
import { formatStat, STAT_LABEL_KEYS, type StatId } from '../lib/sidebarStats'
import StatsModal from './StatsModal'

export interface SidebarStatsProps {
  stats: Schema<'StatsResponse'>
  layout: StatId[]
}

const statValueStyle = { margin: 0, color: 'var(--text-dim)' }

/**
 * The sidebar's stats footer: the stats in the layout, in order. Clicking it -
 * or the "All stats" button, the keyboard's way in - opens every stat. Which
 * ones show here is chosen in Settings.
 */
export default function SidebarStats({ stats, layout }: SidebarStatsProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      {layout.length > 0 && (
        // A description list, so each figure is read with its name ("Systems,
        // 42") rather than as a loose run of words and numbers. The click is a
        // convenience for the pointer; the button below is the accessible way.
        <dl
          aria-label={t('a11y.libraryStats')}
          onClick={() => setOpen(true)}
          title={t('stats.showAll')}
          style={{
            padding: '16px 20px 8px',
            margin: 0,
            fontSize: 14,
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          {layout.map((id, index) => (
            <div
              key={id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: index === layout.length - 1 ? 0 : 4,
              }}
            >
              <dt>{t(STAT_LABEL_KEYS[id])}</dt>
              <dd style={statValueStyle}>{formatStat(t, stats, id)}</dd>
            </div>
          ))}
        </dl>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          background: 'none',
          border: 'none',
          color: 'var(--text-dim)',
          cursor: 'pointer',
          padding: layout.length > 0 ? '4px 20px 10px' : '10px 20px',
          fontSize: 12,
        }}
      >
        <LuChartColumn size={13} aria-hidden="true" />
        {t('stats.showAll')}
      </button>
      {open && <StatsModal stats={stats} onClose={() => setOpen(false)} />}
    </div>
  )
}
