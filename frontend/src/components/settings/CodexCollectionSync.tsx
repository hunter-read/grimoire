import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../api'
import type { Schema } from '../../api'
import Spinner from '../Spinner'
import SettingToggle from './SettingToggle'

type Settings = Schema<'CodexSettingsResponse'>

interface SyncState {
  busy?: boolean
  result?: Schema<'CodexCollectionSyncResponse'>
  error?: string
}

interface Props {
  values: Settings
  saving: boolean
  /** Saves the setting; resolves to the saved settings, or null when the save failed. */
  onSave: (patch: Schema<'CodexSettingsUpdate'>) => Promise<Settings | null>
}

/**
 * The collection sync setting in the Grimoire Codex DB settings: marks the linked books
 * and systems as owned in the token account's Grimoire Codex DB collection. Switching it
 * on runs a first sync at once; "Sync collection now" replaces every mark Grimoire made.
 */
export default function CodexCollectionSync({ values, saving, onSave }: Props) {
  const { t } = useTranslation()
  const [sync, setSync] = useState<SyncState | null>(null)
  const locked = values.locked.includes('sync_collection')

  const runSync = () => {
    setSync({ busy: true })
    api
      .post('/codex/collection/sync')
      .then((r) => setSync({ result: r }))
      .catch((e: Error) => setSync({ error: e.message }))
  }

  const toggle = (on: boolean) => {
    setSync(null)
    onSave({ sync_collection: on }).then((saved) => {
      if (on && saved?.sync_collection) runSync()
    })
  }

  const result = sync?.result
  const unknown = result ? result.unknown.books.length + result.unknown.systems.length : 0

  return (
    <div>
      <SettingToggle
        id="codex-sync-collection"
        checked={values.sync_collection}
        disabled={saving || locked}
        onChange={toggle}
        label={t('codex.settings.syncCollection')}
        hint={
          locked
            ? t('codex.settings.lockedBy', { name: 'GRIMOIRE_CODEX_DB_SYNC_COLLECTION' })
            : t('codex.settings.syncCollectionHint')
        }
      />
      {values.sync_collection && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            marginTop: 10,
            paddingLeft: 28,
          }}
        >
          <button type="button" onClick={runSync} disabled={sync?.busy} style={button}>
            {t('codex.settings.syncNow')}
          </button>
          {sync?.busy && <Spinner size={14} />}
          {result && (
            <span role="status" style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              {t('codex.settings.syncResult', { books: result.books, systems: result.systems })}
              {unknown > 0 && ` ${t('codex.settings.syncUnknown', { count: unknown })}`}
            </span>
          )}
          {sync?.error && (
            <span role="alert" style={{ fontSize: 13, color: 'var(--danger)' }}>
              {sync.error}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

const button = {
  padding: '7px 14px',
  borderRadius: 6,
  background: 'none',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: 13,
  cursor: 'pointer',
}
