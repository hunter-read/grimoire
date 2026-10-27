import { useTranslation } from 'react-i18next'
import type { Schema } from '../../api'
import CharacterCard from './CharacterCard'
import { groupCharacters, type CharacterSort } from './characterSort'
import { cardGrid, groupHeading } from './characterStyles'

type CharacterSummary = Schema<'CharacterSummary'>

interface Props {
  /** Already in `sort` order. */
  characters: CharacterSummary[]
  sort: CharacterSort
  label: string
  onDelete: (character: CharacterSummary) => void
}

/**
 * The user's own characters as cards: one grid, or one per system or campaign
 * under its own heading when sorted that way.
 */
export default function CharacterGrid({ characters, sort, label, onDelete }: Props) {
  const { t } = useTranslation()

  if (sort === 'system' || sort === 'campaign') {
    const blank = sort === 'system' ? t('characters.noSystem') : t('characters.noCampaign')
    return (
      <>
        {groupCharacters(characters, sort).map((group) => {
          const heading = group.label || blank
          return (
            <section key={group.key} style={{ marginBottom: 28 }}>
              <h3 style={groupHeading}>{heading}</h3>
              <ul aria-label={heading} style={cardGrid}>
                {group.characters.map((character) => (
                  <CharacterCard
                    key={character.id}
                    character={character}
                    onDelete={onDelete}
                    // The heading already names it.
                    hideCampaign={sort === 'campaign'}
                  />
                ))}
              </ul>
            </section>
          )
        })}
      </>
    )
  }

  return (
    <ul aria-label={label} style={cardGrid}>
      {characters.map((character) => (
        <CharacterCard
          key={character.id}
          character={character}
          onDelete={onDelete}
          showVersion={sort === 'sheet'}
        />
      ))}
    </ul>
  )
}
