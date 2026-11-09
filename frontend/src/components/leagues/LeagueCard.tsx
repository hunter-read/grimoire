import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Schema } from '../../api'
import { card, chip, muted } from '../armies/armyStyles'

interface LeagueCardProps {
  league: Schema<'LeagueSummary'>
}

/** One league in the list: its name, game, members and points limit. */
export default function LeagueCard({ league }: LeagueCardProps) {
  const { t } = useTranslation()
  return (
    <Link
      to={`/leagues/${league.id}`}
      style={{ ...card, display: 'block', textDecoration: 'none', color: 'inherit' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 15 }}>{league.name}</strong>
        {league.status === 'finished' && <span style={chip}>{t('leagues.finished')}</span>}
      </div>
      <div style={{ ...muted, marginTop: 6 }}>
        {[
          league.game_system_name,
          t('leagues.memberCount', { count: league.member_count ?? 0 }),
          league.points_limit ? t('leagues.limit', { limit: league.points_limit }) : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
    </Link>
  )
}
