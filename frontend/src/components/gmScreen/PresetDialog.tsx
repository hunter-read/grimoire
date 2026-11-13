import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { gmScreen, type Schema } from '../../api'
import Spinner from '../Spinner'
import { ghostBtn, helpText } from '../characters/characterStyles'
import GmDialog from './GmDialog'
import ReplaceChoice from './ReplaceChoice'
import type { Panel } from './types'

type Catalogue = Schema<'GmPresetListOut'>

interface PresetDialogProps {
  campaignId: string
  hasPanels: boolean
  onApplied: (board: { panels: Panel[] }) => void
  onClose: () => void
}

/**
 * Ready-made boards from the community add-on catalogue - a game's usual
 * trackers already placed. A preset is only ever built-in tools, set up.
 */
export default function PresetDialog({
  campaignId,
  hasPanels,
  onApplied,
  onClose,
}: PresetDialogProps) {
  const { t } = useTranslation()
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [replace, setReplace] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    gmScreen
      .presets(campaignId)
      .then(setCatalogue)
      .catch((e: Error) => setError(e.message))
  }, [campaignId])

  const apply = async (preset: Schema<'GmPreset'>) => {
    setBusy(preset.id)
    setError('')
    try {
      onApplied(await gmScreen.applyPreset(campaignId, preset.id, preset.index_url, replace))
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <GmDialog title={t('gmScreen.presets.title')} onClose={onClose}>
      {!catalogue && !error && <Spinner size={20} />}
      {catalogue && (
        <div style={{ display: 'grid', gap: 14 }}>
          <ReplaceChoice replace={replace} onChange={setReplace} hasPanels={hasPanels} />
          {catalogue.presets.length === 0 && <p style={helpText}>{t('gmScreen.presets.none')}</p>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {catalogue.presets.map((preset) => (
              <li
                key={`${preset.index_url}-${preset.id}`}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'start',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{preset.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {[
                      preset.system,
                      preset.author && t('gmScreen.presets.by', { author: preset.author }),
                      t('gmScreen.board.panelCount', { count: preset.panel_count }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {preset.description && (
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>
                      {preset.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => apply(preset)}
                  aria-label={t('gmScreen.presets.applyNamed', { name: preset.name })}
                  style={ghostBtn}
                >
                  {busy === preset.id ? <Spinner size={14} /> : t('gmScreen.presets.apply')}
                </button>
              </li>
            ))}
          </ul>
          {catalogue.errors.map((failure, i) => (
            <p key={`${failure.url}-${i}`} style={{ ...helpText, color: 'var(--danger)' }}>
              {/* Which source failed, and why, is shown to an admin only. */}
              {failure.url
                ? t('gmScreen.presets.sourceError', { url: failure.url, error: failure.error })
                : t('gmScreen.presets.sourceUnreadable')}
            </p>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </p>
      )}
    </GmDialog>
  )
}
