import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPuzzle, LuDownload, LuChevronDown, LuChevronRight } from 'react-icons/lu'
import { characters as charactersApi } from '../../api'
import type { Schema } from '../../api'
import Spinner from '../Spinner'
import { goldBtn, disabledBtn, fieldLabel, helpText } from './characterStyles'
import InstalledImporter from './InstalledImporter'
import { safeLink } from './importerLinks'

// Whether the installed list is open, remembered per browser.
const OPEN_KEY = 'grimoire:characters:importers-open'

const row = {
  display: 'flex',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
}
const list = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }
const meta = { fontSize: 12, color: 'var(--text-muted)' }
const smallGold = { ...goldBtn, padding: '4px 10px', fontSize: 12 }

// A plain render helper rather than a component: one component per file.
type AvailableImporter = Schema<'AvailableImporter'>

function renderTitle(item: { homepage?: string; name: string }) {
  const homepage = safeLink(item.homepage)
  return (
    <div style={{ fontSize: 14, fontWeight: 600 }}>
      {homepage ? (
        <a href={homepage} target="_blank" rel="noreferrer noopener">
          {item.name}
        </a>
      ) : (
        item.name
      )}
    </div>
  )
}

/**
 * The import dialog's importers: the ones this user can run, then the ones
 * the catalogue offers that they do not have yet.
 *
 * What a missing importer offers depends on who is asking, which the server
 * works out (`install_as`): a file-only YAML importer anyone may install for
 * themselves; an admin installs the rest for everyone, here or - for one that
 * runs a script and needs consent - in Settings; anyone else is told to ask.
 */
export interface ImporterListProps {
  // null while the listing loads.
  listing: Schema<'ImporterListResponse'> | null
  onChanged: () => unknown
}

export default function ImporterList({ listing, onChanged }: ImporterListProps) {
  const { t } = useTranslation()
  const [working, setWorking] = useState('')
  const [error, setError] = useState('')
  // Closed unless opened before - or one of your own importers has an update
  // waiting, whose button would otherwise be out of sight. The listing loads
  // after the first render, so that second case is an effect.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === '1'
    } catch {
      return false
    }
  })
  const updateWaiting = (listing?.importers || []).some(
    (item) =>
      item.scope === 'user' && item.available_version && listing?.downloads_enabled !== false
  )
  useEffect(() => {
    if (updateWaiting) setOpen(true)
  }, [updateWaiting])

  const toggle = () =>
    setOpen((was) => {
      try {
        localStorage.setItem(OPEN_KEY, was ? '0' : '1')
      } catch {
        // Private windows may refuse storage; the list still opens and closes.
      }
      return !was
    })

  if (listing === null) return <Spinner size={18} />

  const importers = listing.importers || []
  const available = listing.available || []
  const downloads = listing.downloads_enabled !== false

  const act = async (id: string, request: () => Promise<unknown>) => {
    setWorking(id)
    setError('')
    try {
      await request()
      await onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setWorking('')
    }
  }

  const install = (item: AvailableImporter) =>
    act(item.id, () =>
      item.install_as === 'server'
        ? charactersApi.installImporterForEveryone(item.id, item.index_url)
        : charactersApi.installImporter(item.id)
    )

  const offer = (item: AvailableImporter) => {
    if (!downloads) return null
    if (item.install_as === 'admin') {
      return <span style={meta}>{t('characters.importerAskAdmin')}</span>
    }
    if (item.install_as === 'settings') {
      return (
        <a href="/settings/addons" style={{ fontSize: 12 }}>
          {t('characters.importerInstallInSettings')}
        </a>
      )
    }
    const busy = Boolean(working)
    return (
      <button
        type="button"
        onClick={() => install(item)}
        disabled={busy}
        style={busy ? { ...disabledBtn, padding: '4px 10px', fontSize: 12 } : smallGold}
      >
        <LuDownload size={12} aria-hidden="true" />
        {item.install_as === 'server'
          ? t('characters.importerInstallForEveryone')
          : t('characters.importerInstall')}
      </button>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {error ? (
        <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      <section aria-labelledby="character-importers-heading">
        <h3
          id="character-importers-heading"
          style={{ ...fieldLabel, margin: '0 0 8px', fontWeight: 'normal' }}
        >
          {importers.length === 0 ? (
            t('characters.importersHeading')
          ) : (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-controls="character-importers-list"
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
                <LuChevronDown size={14} aria-hidden="true" />
              ) : (
                <LuChevronRight size={14} aria-hidden="true" />
              )}
              {t('characters.importersHeading')} ({importers.length})
            </button>
          )}
        </h3>
        {/* With nothing installed, say what can still be imported - never hidden. */}
        {importers.length === 0 ? (
          <p style={{ ...helpText, margin: 0 }}>{t('characters.importersNone')}</p>
        ) : !open ? null : (
          <ul id="character-importers-list" style={list}>
            {importers.map((importer) => (
              <InstalledImporter
                key={importer.id}
                importer={importer}
                downloads={downloads}
                working={Boolean(working)}
                onUpdate={() => act(importer.id, () => charactersApi.installImporter(importer.id))}
                onRemove={() => act(importer.id, () => charactersApi.removeImporter(importer.id))}
              />
            ))}
          </ul>
        )}
      </section>

      {available.length ? (
        <section aria-labelledby="character-importers-available-heading">
          <h3
            id="character-importers-available-heading"
            style={{ ...fieldLabel, margin: '0 0 8px', fontWeight: 'normal' }}
          >
            {t('characters.importersAvailableHeading')}
          </h3>
          {downloads ? null : (
            <p style={{ ...helpText, margin: '0 0 8px' }}>
              {t('characters.importersDownloadsOff')}
            </p>
          )}
          <ul style={list}>
            {available.map((item) => (
              <li key={item.id} style={row}>
                <LuPuzzle
                  size={16}
                  aria-hidden="true"
                  color="var(--text-muted)"
                  style={{ flexShrink: 0, marginTop: 2 }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  {renderTitle(item)}
                  <div style={meta}>
                    {[
                      item.version ? `v${item.version}` : '',
                      item.sheet
                        ? t('characters.importerSheet', { sheet: item.sheet_name || item.sheet })
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {item.description ? (
                    <p style={{ ...helpText, margin: '4px 0 0' }}>{item.description}</p>
                  ) : null}
                </div>
                <div style={{ flexShrink: 0, alignSelf: 'center' }}>
                  {working === item.id ? <Spinner size={14} /> : offer(item)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
