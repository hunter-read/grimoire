import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { characters as charactersApi } from '../../api'
import type { Schema } from '../../api'

type Character = Schema<'CharacterDetail'>

interface Props {
  character: Pick<Character, 'id' | 'name' | 'transfer_candidates'>
  onTransferred: (updated: Character) => void
  onError: (message: string) => void
}

/**
 * Hands a character the GM prepared to one of their players (issue #726).
 *
 * The server offers it only to the character's owner, and only at a table they
 * run, so the list of players doubles as whether to show it at all. The GM
 * keeps edit access afterwards; the player can take that back like any other.
 */
export default function GiveToPlayer({ character, onTransferred, onError }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const players = character.transfer_candidates || []

  if (!players.length) return null

  const give = async (userId: string) => {
    const player = players.find((p) => p.user_id === userId)
    if (!player) return
    const name = character.name || t('characters.untitled')
    if (!window.confirm(t('characters.confirmGive', { name, player: player.name }))) return
    setBusy(true)
    try {
      onTransferred(await charactersApi.transfer(character.id, userId))
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <select
      // Always shows the prompt: picking a player acts at once, after a confirm.
      value=""
      onChange={(e) => give(e.target.value)}
      disabled={busy}
      aria-label={t('characters.giveToPlayer')}
      title={t('characters.giveToPlayerHelp')}
      style={{
        fontSize: 13,
        padding: '3px 6px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        color: 'var(--text-dim)',
        maxWidth: 220,
      }}
    >
      <option value="">{t('characters.giveToPlayer')}</option>
      {players.map((player) => (
        <option key={player.user_id} value={player.user_id}>
          {player.name}
        </option>
      ))}
    </select>
  )
}
