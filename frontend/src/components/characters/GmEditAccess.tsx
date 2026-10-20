import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { characters as charactersApi } from '../../api'
import type { Schema } from '../../api'

type Character = Schema<'CharacterDetail'>

interface Props {
  character: Character
  onChanged: (updated: Character) => void
  onError: (message: string) => void
}

/**
 * The player's switch for letting their campaign's GM edit the sheet.
 *
 * Offered only to the sheet's owner, and only when the campaign has a GM other
 * than them: a character in no campaign, or in the player's own personal one,
 * has nobody to let in. Off by default; the server turns it off again when the
 * character moves to another campaign.
 */
export default function GmEditAccess({ character, onChanged, onError }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  if (character.owned === false || !character.campaign_has_gm) return null

  const toggle = async (allowed: boolean) => {
    setBusy(true)
    try {
      onChanged(await charactersApi.update(character.id, { gm_can_edit: allowed }))
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <label
      title={t('characters.gmCanEditHelp')}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
    >
      <input
        type="checkbox"
        checked={Boolean(character.gm_can_edit)}
        disabled={busy}
        onChange={(e) => toggle(e.target.checked)}
      />
      {t('characters.gmCanEdit')}
    </label>
  )
}
