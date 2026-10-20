import type { ComponentType, ImgHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { characters as charactersApi } from '../../api'
import LazyImgJs from '../LazyImg'
import { isActive, statusLabel } from '../characters/characterStatus'
import { framedImageStyle } from '../characters/portraitCrop'
import type { CampaignCharacter } from './campaignCharacterGroups'

// Still JavaScript, so TypeScript would read every prop as required.
const LazyImg = LazyImgJs as ComponentType<ImgHTMLAttributes<HTMLImageElement>>

const THUMB = 40

/**
 * One character on the campaign page: a small portrait, the name, and the sheet
 * it is built on, linking to the full sheet.
 *
 * Compact on purpose - the campaign page is a dashboard, and the Characters
 * page already has the large cards. A retired or fallen character is faded and
 * labelled with how they left the story.
 */
export default function CampaignCharacterTile({ character }: { character: CampaignCharacter }) {
  const { t } = useTranslation()
  const name = character.name || t('characters.untitled')
  const inactive = !isActive(character)
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')
  const detail = inactive
    ? statusLabel(t, character.status)
    : character.schema_name || character.system || ''

  return (
    <li style={{ listStyle: 'none', minWidth: 0 }}>
      <Link
        to={`/characters/${character.id}`}
        aria-label={t('characters.open', { name })}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: 6,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-deep)',
          color: 'inherit',
          textDecoration: 'none',
          opacity: inactive ? 0.65 : 1,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: THUMB,
            height: THUMB,
            flexShrink: 0,
            borderRadius: 6,
            overflow: 'hidden',
            background: 'var(--bg-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--gold)',
            filter: inactive ? 'grayscale(1)' : 'none',
          }}
        >
          {character.portrait_path ? (
            <LazyImg
              src={charactersApi.portraitUrl(character.id, character.portrait_version)}
              alt=""
              style={framedImageStyle(character.portrait_crop)}
            />
          ) : (
            initials || '?'
          )}
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: 'block',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: 'Cinzel, serif',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textDecoration: character.status === 'dead' ? 'line-through' : 'none',
            }}
          >
            {name}
          </span>
          {detail ? (
            <span
              style={{
                display: 'block',
                fontSize: 12,
                color: 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {detail}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  )
}
