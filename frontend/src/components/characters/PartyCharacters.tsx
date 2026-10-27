import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuChevronRight } from 'react-icons/lu'
import type { Schema } from '../../api'
import { getUserPrefs, saveUserPref } from '../../hooks/useUserPrefs'
import CharacterCard from './CharacterCard'
import { partyGroups, type CharacterSort } from './characterSort'
import { cardGrid, groupHeading } from './characterStyles'

type CharacterSummary = Schema<'CharacterSummary'>

const PREF_KEY = 'characterPartyCollapsed'

function storedCollapsed(): string[] {
  const stored = getUserPrefs()[PREF_KEY]
  return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []
}

interface Props {
  characters: CharacterSummary[]
  sort: CharacterSort
}

/**
 * The other players' characters the user can read, one group per campaign.
 *
 * Kept apart from the user's own characters: a GM of three tables can read
 * dozens of sheets, and mixed in with their own those would bury them. Each
 * campaign folds away, and stays folded, so a table they only check on now
 * and then does not have to be scrolled past every visit.
 */
export default function PartyCharacters({ characters, sort }: Props) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState<string[]>(storedCollapsed)

  const toggle = (campaignId: string) => {
    const next = collapsed.includes(campaignId)
      ? collapsed.filter((id) => id !== campaignId)
      : [...collapsed, campaignId]
    setCollapsed(next)
    saveUserPref(PREF_KEY, next)
  }

  return (
    <>
      {partyGroups(characters, sort).map((group) => {
        const open = !collapsed.includes(group.key)
        const heading = group.label || t('characters.noCampaign')
        const listId = `party-${group.key}`
        return (
          <section key={group.key} style={{ marginBottom: 20 }}>
            <h3 style={groupHeading}>
              <button
                type="button"
                onClick={() => toggle(group.key)}
                aria-expanded={open}
                aria-controls={listId}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: 0,
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  font: 'inherit',
                  cursor: 'pointer',
                }}
              >
                {open ? (
                  <LuChevronDown size={16} aria-hidden="true" />
                ) : (
                  <LuChevronRight size={16} aria-hidden="true" />
                )}
                {heading}
                <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                  ({group.characters.length})
                </span>
              </button>
            </h3>
            {open ? (
              <ul id={listId} aria-label={heading} style={cardGrid}>
                {group.characters.map((character) => (
                  <CharacterCard
                    key={character.id}
                    character={character}
                    showVersion={sort === 'sheet'}
                    hideCampaign
                  />
                ))}
              </ul>
            ) : null}
          </section>
        )
      })}
    </>
  )
}
