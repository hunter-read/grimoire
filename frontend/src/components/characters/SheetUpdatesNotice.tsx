import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuRefreshCw } from 'react-icons/lu'
import { characters as charactersApi } from '../../api'
import type { Schema } from '../../api'
import { goldBtn } from './characterStyles'

type SheetUpdate = Schema<'SheetUpdate'>

interface Props {
  updates: SheetUpdate[]
  /** Called once the updates are installed, to reload the list. */
  onUpdated: () => Promise<void> | void
  onError: (message: string) => void
}

/**
 * Tells the player their catalogue sheets have newer versions, and installs
 * them in one click.
 *
 * Every character on a sheet follows the installed copy, so updating the
 * sheet is how a player brings their characters up to date - and until now
 * it meant spotting the new version in the catalogue for themselves.
 */
export default function SheetUpdatesNotice({ updates, onUpdated, onError }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  if (!updates.length) return null

  const updateAll = async () => {
    setBusy(true)
    try {
      // One at a time: each is a download, and a failure should say which.
      for (const update of updates) {
        await charactersApi.installSheet(update.sheet_id)
      }
      await onUpdated()
    } catch (e) {
      // Some may have landed before the failure, so the list is reloaded -
      // first, since a reload clears the page's error.
      await onUpdated()
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        background: 'var(--bg-card)',
        border: '1px solid var(--gold)',
        borderRadius: 8,
        padding: '10px 14px',
        marginBottom: 20,
        fontSize: 13,
      }}
    >
      <LuRefreshCw size={15} color="var(--gold)" aria-hidden="true" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 600 }}>
          {t('characters.sheetUpdatesTitle', { count: updates.length })}
        </div>
        <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
          {updates
            .map((update) =>
              t('characters.sheetUpdateLine', {
                name: update.name,
                from: update.installed_version,
                to: update.version,
              })
            )
            .join(' · ')}
        </div>
      </div>
      <button type="button" onClick={updateAll} disabled={busy} style={goldBtn}>
        {busy
          ? t('characters.updatingSheets')
          : t('characters.updateSheets', { count: updates.length })}
      </button>
    </div>
  )
}
