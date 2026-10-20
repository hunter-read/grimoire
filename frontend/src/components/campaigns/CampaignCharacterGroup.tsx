import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuChevronRight, LuUser } from 'react-icons/lu'
import CampaignCharacterTile from './CampaignCharacterTile'
import type { OwnerGroup } from './campaignCharacterGroups'

const GRID = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: 8,
} as const

/**
 * One player's characters in the campaign.
 *
 * The characters being played are always shown. The retired and the dead sit
 * behind a toggle that names how many there are, so a player on their tenth
 * character shows one sheet, not ten - but the GM is one click from the whole
 * history.
 */
export default function CampaignCharacterGroup({
  group,
  isViewer,
}: {
  group: OwnerGroup
  isViewer: boolean
}) {
  const { t } = useTranslation()
  const [showPast, setShowPast] = useState(false)
  const pastId = `campaign-past-characters-${group.userId}`

  return (
    <section aria-label={group.name} style={{ marginBottom: 14 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: 'var(--text-muted)',
          marginBottom: 6,
        }}
      >
        <LuUser size={11} aria-hidden="true" />
        <span style={{ fontWeight: 600, color: 'var(--text-dim)' }}>{group.name}</span>
        {group.isGm ? (
          <span
            style={{
              fontSize: 11,
              color: 'var(--gold)',
              fontWeight: 600,
              background: 'var(--bg-deep)',
              border: '1px solid var(--gold-dim)',
              borderRadius: 10,
              padding: '1px 6px',
              letterSpacing: '0.04em',
            }}
          >
            {t('members.gm')}
          </span>
        ) : null}
        {isViewer ? <span>{t('members.you')}</span> : null}
      </div>

      {group.active.length > 0 ? (
        <ul style={GRID}>
          {group.active.map((character) => (
            <CampaignCharacterTile key={character.id} character={character} />
          ))}
        </ul>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          {t('campaignCharacters.noActive')}
        </div>
      )}

      {group.inactive.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setShowPast((open) => !open)}
            aria-expanded={showPast}
            aria-controls={pastId}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              marginTop: 6,
              padding: '2px 0',
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {showPast ? (
              <LuChevronDown size={12} aria-hidden="true" />
            ) : (
              <LuChevronRight size={12} aria-hidden="true" />
            )}
            {t('campaignCharacters.pastCharacters', { count: group.inactive.length })}
          </button>
          {showPast ? (
            <ul id={pastId} style={{ ...GRID, marginTop: 6 }}>
              {group.inactive.map((character) => (
                <CampaignCharacterTile key={character.id} character={character} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
