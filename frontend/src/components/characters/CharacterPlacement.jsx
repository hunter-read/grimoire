import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { characters as charactersApi } from '../../api'
import useCharacterCampaigns from './useCharacterCampaigns'
import { CHARACTER_STATUSES, statusLabel } from './characterStatus'

const selectStyle = {
  fontSize: 13,
  padding: '3px 6px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-dim)',
  maxWidth: 220,
}

/**
 * Which campaign a character is played in, and where they stand in it.
 *
 * A player can have several characters in one campaign - when one falls, they
 * roll the next - so the old sheet is marked rather than deleted: "dead" or
 * "retired" keeps it readable beside its successor.
 *
 * Read-only for a party member's sheet, where it is just the two labels.
 */
export default function CharacterPlacement({ character, readOnly, onChanged, onError }) {
  const { t } = useTranslation()
  const campaigns = useCharacterCampaigns({ enabled: !readOnly })
  const [busy, setBusy] = useState(false)
  const status = character.status || 'active'

  if (readOnly) {
    return (
      <>
        {character.campaign_name ? <span>· {character.campaign_name}</span> : null}
        {status !== 'active' ? <span>· {statusLabel(t, status)}</span> : null}
      </>
    )
  }

  const save = async (patch) => {
    setBusy(true)
    try {
      onChanged(await charactersApi.update(character.id, patch))
    } catch (e) {
      onError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // The character's own campaign stays selectable even when the list does not
  // carry it (an archived campaign is left out of the list by default).
  const options = [...campaigns]
  if (character.campaign_id && !options.some((c) => c.id === character.campaign_id)) {
    options.push({ id: character.campaign_id, name: character.campaign_name || '…' })
  }

  return (
    <>
      <select
        value={character.campaign_id || ''}
        onChange={(e) => save({ campaign_id: e.target.value })}
        disabled={busy}
        aria-label={t('characters.campaign')}
        title={t('characters.campaignHelp')}
        style={selectStyle}
      >
        <option value="">{t('characters.noCampaign')}</option>
        {options.map((campaign) => (
          <option key={campaign.id} value={campaign.id}>
            {campaign.name}
          </option>
        ))}
      </select>
      <select
        value={status}
        onChange={(e) => save({ status: e.target.value })}
        disabled={busy}
        aria-label={t('characters.status')}
        title={t('characters.statusHelp')}
        style={selectStyle}
      >
        {CHARACTER_STATUSES.map((value) => (
          <option key={value} value={value}>
            {statusLabel(t, value)}
          </option>
        ))}
      </select>
    </>
  )
}
