import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { gmScreen, type Schema } from '../../api'
import Spinner from '../Spinner'
import { goldBtn, helpText } from '../characters/characterStyles'
import GmDialog from './GmDialog'
import ReplaceChoice from './ReplaceChoice'
import type { Panel } from './types'

interface CopyBoardDialogProps {
  campaignId: string
  hasPanels: boolean
  onCopied: (board: { panels: Panel[] }) => void
  onClose: () => void
}

/**
 * Copy the GM screen of another campaign this GM runs. The setup comes across;
 * the numbers stay behind, since this table's game has not happened yet.
 */
export default function CopyBoardDialog({
  campaignId,
  hasPanels,
  onCopied,
  onClose,
}: CopyBoardDialogProps) {
  const { t } = useTranslation()
  const [sources, setSources] = useState<Schema<'GmSourceCampaign'>[] | null>(null)
  const [chosen, setChosen] = useState('')
  const [replace, setReplace] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    gmScreen
      .sources(campaignId)
      .then((body) => {
        setSources(body.campaigns)
        setChosen(body.campaigns[0]?.id ?? '')
      })
      .catch((e: Error) => setError(e.message))
  }, [campaignId])

  const copy = async () => {
    setBusy(true)
    setError('')
    try {
      onCopied(await gmScreen.copy(campaignId, chosen, replace))
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <GmDialog title={t('gmScreen.copy.title')} onClose={onClose}>
      {sources === null && !error && <Spinner size={20} />}
      {sources?.length === 0 && <p style={helpText}>{t('gmScreen.copy.none')}</p>}
      {sources && sources.length > 0 && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void copy()
          }}
          style={{ display: 'grid', gap: 14 }}
        >
          <p style={{ ...helpText, margin: 0 }}>{t('gmScreen.copy.help')}</p>
          <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              {t('gmScreen.copy.from')}
            </legend>
            {sources.map((source) => (
              <label
                key={source.id}
                style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}
              >
                <input
                  type="radio"
                  name="gm-copy-source"
                  checked={chosen === source.id}
                  onChange={() => setChosen(source.id)}
                />
                {source.name}
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {t('gmScreen.board.panelCount', { count: source.panel_count })}
                </span>
              </label>
            ))}
          </fieldset>
          <ReplaceChoice replace={replace} onChange={setReplace} hasPanels={hasPanels} />
          <button
            type="submit"
            disabled={busy || !chosen}
            style={{ ...goldBtn, justifySelf: 'end' }}
          >
            {t('gmScreen.copy.action')}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </p>
      )}
    </GmDialog>
  )
}
