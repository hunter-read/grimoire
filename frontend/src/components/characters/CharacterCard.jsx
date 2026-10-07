import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTrash2, LuTriangleAlert, LuUsers } from 'react-icons/lu'
import { characters as charactersApi } from '../../api'
import CardLink from '../CardLink'
import LazyImg from '../LazyImg'
import { isActive, statusLabel } from './characterStatus'

/**
 * One character in the list: their art, if they have any, above their name and
 * the sheet they are built on.
 *
 * Laid out like a campaign card - a picture panel over a short body - so the
 * Characters page reads as part of the same app. Without art the panel shows
 * the character's initials, which tells characters apart better than a row of
 * identical placeholder icons.
 */
export default function CharacterCard({ character, onDelete }) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const name = character.name || t('characters.untitled')
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')
  const owned = character.owned !== false
  // A retired or fallen character stays in the list beside whoever replaced
  // them, faded so the one being played is the one that stands out.
  const inactive = !isActive(character)

  return (
    <li
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        listStyle: 'none',
        background: hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
        transition: 'all 0.15s',
        transform: hovered ? 'translateY(-1px)' : 'none',
        boxShadow: hovered ? '0 4px 16px var(--shadow)' : 'none',
      }}
    >
      <CardLink to={`/characters/${character.id}`} label={t('characters.open', { name })} />
      <div
        aria-hidden="true"
        style={{
          aspectRatio: '1 / 1',
          background: 'var(--bg-deep)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          filter: inactive ? 'grayscale(1)' : 'none',
          opacity: inactive ? 0.6 : 1,
        }}
      >
        {character.portrait_path ? (
          <LazyImg
            src={charactersApi.portraitUrl(character.id, character.portrait_version)}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <span
            style={{
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: '0.04em',
              color: 'var(--gold)',
              opacity: 0.8,
            }}
          >
            {initials || '?'}
          </span>
        )}
      </div>
      <div style={{ padding: '12px 14px 14px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            {character.schema_missing ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  color: 'var(--warning)',
                }}
              >
                <LuTriangleAlert size={13} aria-hidden="true" />
                {t('characters.schemaMissing', { schema: character.schema_ref })}
              </span>
            ) : (
              character.schema_name || character.schema_ref
            )}
          </div>
          {character.campaign_name || inactive ? (
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-dim)',
                marginTop: 4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {[character.campaign_name, inactive ? statusLabel(t, character.status) : null]
                .filter(Boolean)
                .join(' · ')}
            </div>
          ) : null}
          {!owned ? (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 6,
                fontSize: 12,
                color: 'var(--text-dim)',
              }}
            >
              <LuUsers size={12} aria-hidden="true" />
              {t('characters.partyMember')}
            </div>
          ) : null}
        </div>
        {owned ? (
          // Positioned, so it sits above the card's link overlay.
          <button
            type="button"
            onClick={() => onDelete(character)}
            aria-label={t('characters.deleteNamed', { name })}
            title={t('characters.delete')}
            style={{
              position: 'relative',
              display: 'inline-flex',
              padding: 6,
              background: 'none',
              border: 'none',
              borderRadius: 6,
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <LuTrash2 size={16} />
          </button>
        ) : null}
      </div>
    </li>
  )
}
