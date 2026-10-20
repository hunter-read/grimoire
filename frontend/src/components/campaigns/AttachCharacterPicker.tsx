import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { characters as charactersApi } from '../../api'
import Spinner from '../Spinner'
import { statusLabel, isActive } from '../characters/characterStatus'
import type { CampaignCharacter } from './campaignCharacterGroups'

/**
 * The viewer's own characters that are not in this campaign yet, to bring one
 * to the table.
 *
 * Only their own: a character is placed by the player who owns it, which is
 * also what the server allows. A character already in another campaign is
 * moved, so the list says where each one is now.
 */
export default function AttachCharacterPicker({
  campaignId,
  onAttached,
}: {
  campaignId: string
  onAttached: () => void
}) {
  const { t } = useTranslation()
  const [options, setOptions] = useState<CampaignCharacter[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    charactersApi
      .list()
      .then((result) => {
        if (!live) return
        const mine = (result.characters || []).filter(
          (c) => c.owned !== false && c.campaign_id !== campaignId
        )
        setOptions([...mine.filter(isActive), ...mine.filter((c) => !isActive(c))])
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [campaignId])

  const attach = async (character: CampaignCharacter) => {
    setBusy(true)
    setError(null)
    try {
      await charactersApi.update(character.id, { campaign_id: campaignId })
      onAttached()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
        {t('campaignCharacters.addTitle')}
      </div>
      {error ? (
        <div role="alert" style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>
          {error}
        </div>
      ) : null}
      {options === null && !error ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
          <Spinner size={18} />
        </div>
      ) : options && options.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {t('campaignCharacters.noneToAdd')}{' '}
          <Link to="/characters" style={{ color: 'var(--gold)' }}>
            {t('campaignCharacters.goToCharacters')}
          </Link>
        </div>
      ) : (
        <ul
          aria-label={t('campaignCharacters.addTitle')}
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {(options || []).map((character) => {
            const name = character.name || t('characters.untitled')
            const where = [
              character.campaign_name,
              isActive(character) ? null : statusLabel(t, character.status),
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <li key={character.id}>
                <button
                  type="button"
                  onClick={() => attach(character)}
                  disabled={busy}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 8px',
                    background: 'none',
                    border: 'none',
                    borderRadius: 6,
                    color: 'var(--text)',
                    cursor: busy ? 'default' : 'pointer',
                    fontSize: 13,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-deep)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{ fontWeight: 600 }}>{name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>
                    {[character.schema_name || character.schema_ref, where]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
