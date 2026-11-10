import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { characters as charactersApi } from '../../../api'
import LazyImg from '../../LazyImg'
import { framedImageStyle } from '../../characters/portraitCrop'
import { useGmScreenContext } from '../gmScreenContext'
import { partyConfig } from '../types'
import type { PanelBodyProps } from './panelProps'
import PartyStatView from './PartyStatView'

/**
 * One card per character in the campaign, with the stats the GM chose: Hit
 * Points, Stress and Hope at a glance instead of a tab per sheet.
 *
 * A stat can be changed here where the player has let the GM edit their sheet;
 * everywhere else it only reads, as the sheet itself would.
 */
export default function PartyPanel({ panel }: PanelBodyProps) {
  const { t } = useTranslation()
  const { party, setCharacterValue } = useGmScreenContext()
  const config = partyConfig(panel.config)
  const fields = new Map(party.fields.map((field) => [field.name, field]))
  const shown = party.characters.filter(
    (character) => config.include_inactive || character.status === 'active'
  )

  if (!shown.length) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        {t('gmScreen.party.empty')}
      </p>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {!config.stats.length && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
          {t('gmScreen.party.noStats')}
        </p>
      )}
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        }}
      >
        {shown.map((character) => (
          <li
            key={character.id}
            style={{
              display: 'grid',
              gap: 6,
              alignContent: 'start',
              padding: 8,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg-panel)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 36,
                  height: 36,
                  flexShrink: 0,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  background: 'var(--bg-deep)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--gold)',
                  fontWeight: 700,
                }}
              >
                {character.portrait_path ? (
                  <LazyImg
                    src={charactersApi.portraitUrl(character.id, character.portrait_version)}
                    alt=""
                    style={framedImageStyle(character.portrait_crop)}
                  />
                ) : (
                  (character.name || '?').charAt(0).toUpperCase()
                )}
              </span>
              <span style={{ minWidth: 0 }}>
                <Link
                  to={`/characters/${character.id}`}
                  style={{ display: 'block', fontWeight: 600, color: 'inherit' }}
                >
                  {character.name || t('gmScreen.party.unnamed')}
                </Link>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>
                  {character.owner_name}
                </span>
              </span>
            </div>
            {config.stats.map((stat) => (
              <PartyStatView
                key={`${stat.value}-${stat.label}`}
                character={character}
                stat={stat}
                editable={character.editable && fields.get(stat.value)?.source === 'field'}
                onChange={(value) => setCharacterValue(character.id, stat.value, value)}
              />
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}
