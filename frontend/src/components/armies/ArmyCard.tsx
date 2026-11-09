import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Schema } from '../../api'
import { card, chip, muted } from './armyStyles'
import { overLimit } from './armyText'

interface ArmyCardProps {
  army: Schema<'ArmySummary'>
}

/** One army in the list: name, game and faction, and points against the limit. */
export default function ArmyCard({ army }: ArmyCardProps) {
  const { t } = useTranslation()
  const game = army.game_system_name || army.system_name
  const over = overLimit(army)
  return (
    <Link
      to={`/armies/${army.id}`}
      style={{ ...card, display: 'block', textDecoration: 'none', color: 'inherit' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 15 }}>{army.name}</strong>
        {army.source === 'battlescribe' && <span style={chip}>{t('armies.fromRoster')}</span>}
      </div>
      <div style={{ ...muted, marginTop: 4 }}>
        {[game, army.faction?.name].filter(Boolean).join(' · ') || t('armies.noGame')}
      </div>
      <div style={{ marginTop: 10, fontSize: 14, color: over ? 'var(--danger)' : 'var(--text)' }}>
        {t('armies.points', {
          points: army.points ?? 0,
          limit: army.points_limit || '-',
          cost: army.cost_name || 'pts',
        })}
      </div>
    </Link>
  )
}
