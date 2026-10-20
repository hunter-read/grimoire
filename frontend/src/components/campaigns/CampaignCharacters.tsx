import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType, CSSProperties, ReactNode, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPlus, LuSwords } from 'react-icons/lu'
import { characters as charactersApi } from '../../api'
import Spinner from '../Spinner'
import AnchoredPopoverJs from './AnchoredPopover'
import AttachCharacterPicker from './AttachCharacterPicker'
import CampaignCharacterGroup from './CampaignCharacterGroup'
import { groupByOwner } from './campaignCharacterGroups'
import type { CampaignCharacter } from './campaignCharacterGroups'

// Still JavaScript, so TypeScript would read every prop as required.
const AnchoredPopover = AnchoredPopoverJs as ComponentType<{
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  width?: number
  children: ReactNode
}>

interface Props {
  campaignId: string
  /** The campaign's owner - its GM, or the player of a personal campaign. */
  ownerId?: string | null
  viewerId?: string | null
  /** Whether the viewer may bring one of their own characters to the table. */
  canAdd: boolean
  /** The card's frame, so the page lays it out like its other cards. */
  style?: CSSProperties
}

/**
 * The characters played in a campaign, grouped under their players (issue #562).
 *
 * A character joins a campaign from its own sheet, or from here. The GM's own
 * sheets - NPCs, or a solo game's party - sit with everyone else's, so a
 * GM-only campaign has somewhere to keep them. Each player's retired and fallen
 * characters fold away under the one they play now.
 *
 * Nothing renders for a viewer who has no characters to see and none to add.
 */
export default function CampaignCharacters({
  campaignId,
  ownerId,
  viewerId,
  canAdd,
  style,
}: Props) {
  const { t } = useTranslation()
  const [characters, setCharacters] = useState<CampaignCharacter[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const addBtnRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(() => {
    charactersApi
      .list({ campaign_id: campaignId })
      .then((result) => {
        setCharacters(result.characters || [])
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [campaignId])

  useEffect(() => {
    load()
  }, [load])

  const closePicker = useCallback(() => setAdding(false), [])

  if (characters === null && !error) {
    return canAdd ? (
      <div style={{ ...style, display: 'flex', justifyContent: 'center' }}>
        <Spinner size={20} />
      </div>
    ) : null
  }
  if (!error && characters?.length === 0 && !canAdd) return null

  const groups = groupByOwner(characters || [], { gmId: ownerId, viewerId })

  return (
    <div style={style}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <h3
          style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <LuSwords size={15} aria-hidden="true" /> {t('campaignCharacters.title')}
        </h3>
        {canAdd ? (
          <button
            ref={addBtnRef}
            type="button"
            onClick={() => setAdding((open) => !open)}
            aria-haspopup="dialog"
            aria-expanded={adding}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 10px',
              background: 'var(--bg-deep)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            <LuPlus size={12} aria-hidden="true" /> {t('campaignCharacters.add')}
          </button>
        ) : null}
      </div>

      {adding ? (
        <AnchoredPopover anchorRef={addBtnRef} onClose={closePicker}>
          <AttachCharacterPicker
            campaignId={campaignId}
            onAttached={() => {
              setAdding(false)
              load()
            }}
          />
        </AnchoredPopover>
      ) : null}

      {error ? (
        <div role="alert" style={{ fontSize: 13, color: 'var(--danger)' }}>
          {error}
        </div>
      ) : groups.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {t('campaignCharacters.empty')}
        </div>
      ) : (
        groups.map((group) => (
          <CampaignCharacterGroup
            key={group.userId}
            group={group}
            isViewer={!!viewerId && group.userId === viewerId}
          />
        ))
      )}
    </div>
  )
}
