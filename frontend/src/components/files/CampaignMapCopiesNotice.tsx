import { useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuMap } from 'react-icons/lu'
import { files as filesApi, type Schema } from '../../api'

type Copy = Schema<'CampaignMapCopyOut'>

/**
 * Which campaigns use a map the delete would take out of the library, and
 * whether each keeps its own copy (issue #578).
 *
 * Removing a map through the app copies it into every campaign whose map pages,
 * notes or resources use it, within that campaign's upload limits. Whatever
 * can't be copied leaves the campaign's map pages showing a placeholder, and
 * the person deleting should know that before they confirm. Renders nothing for
 * a path holding no maps a campaign uses, or while the answer is loading.
 */
export default function CampaignMapCopiesNotice({ path }: { path: string }) {
  const { t } = useTranslation()
  const [copies, setCopies] = useState<Copy[]>([])

  useEffect(() => {
    // Only the maps collection holds maps.
    if (!/^maps\//.test(path)) return
    let active = true
    // Inside the promise chain, so a failure of any kind - even the call
    // itself - only means no notice; the delete dialog never depends on it.
    Promise.resolve()
      .then(() => filesApi.campaignMapCopies(path))
      .then((res) => active && setCopies(res.campaigns || []))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [path])

  if (copies.length === 0) return null
  return (
    <div style={box} data-testid="campaign-map-copies">
      <p style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <LuMap size={13} aria-hidden="true" /> {t('files.campaignMapsUsed')}
      </p>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {copies.map((c) => (
          <li key={`${c.campaign_id}:${c.map_id}`}>
            <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{c.campaign_name}</strong>
            {copies.some((o) => o.map_id !== c.map_id) ? ` (${c.map_name})` : ''} -{' '}
            {t(OUTCOME_KEYS[c.outcome] ?? 'files.campaignMapLost')}
          </li>
        ))}
      </ul>
    </div>
  )
}

// What each outcome means for the campaign, from `services/campaigns/map_copies`.
const OUTCOME_KEYS: Record<string, string> = {
  copy: 'files.campaignMapKept',
  too_large: 'files.campaignMapTooLarge',
  uploads_disabled: 'files.campaignMapUploadsOff',
  not_image: 'files.campaignMapNotImage',
}

const box: CSSProperties = {
  marginTop: 12,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--text-dim)',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 10px',
}
