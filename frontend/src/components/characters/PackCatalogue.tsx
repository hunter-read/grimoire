import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuX,
  LuCheck,
  LuDownload,
  LuExternalLink,
  LuSearch,
  LuRefreshCw,
  LuTrash2,
} from 'react-icons/lu'
import { rulesets as rulesetsApi } from '../../api'
import Spinner from '../Spinner'
import { goldBtn, ghostBtn, iconBtn, fieldInput, card, scrim, helpText } from './characterStyles'

/**
 * Browse the community catalogue of content packs and install one.
 *
 * A pack is bulk rules content, so unlike a sheet it is **server-wide** and
 * installing needs an admin. Anyone may browse: a GM should be able to see what
 * the SRD would give their table before asking for it, which is why the install
 * button is withheld rather than the whole dialog.
 */
export default function PackCatalogue({ onInstalled, onClose }) {
  const { t } = useTranslation()
  const [packs, setPacks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [installing, setInstalling] = useState('')
  const [canInstall, setCanInstall] = useState(false)
  const [sources, setSources] = useState([])
  const [sourceErrors, setSourceErrors] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await rulesetsApi.browsePacks()
      setPacks(result.packs || [])
      setCanInstall(Boolean(result.can_install))
      setSources(result.sources || [])
      // Shown rather than dropped: with several sources configured, a missing
      // one otherwise just looks like a smaller catalogue.
      setSourceErrors(result.errors || [])
      setError('')
    } catch (e) {
      setError(e.message || t('contentPacks.catalogueFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Also how a pack is reinstalled or updated: installing replaces whatever
  // copy is there, so an installed pack is never stuck at the version it has.
  const install = async (pack) => {
    setInstalling(pack.id)
    try {
      await rulesetsApi.installPack(pack.id)
      setPacks((prev) =>
        prev.map((row) =>
          row.id === pack.id
            ? { ...row, installed: true, installed_version: row.version, update_available: false }
            : row
        )
      )
      onInstalled?.()
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setInstalling('')
    }
  }

  const uninstall = async (pack) => {
    if (!window.confirm(t('contentPacks.confirmUninstall', { name: pack.name }))) return
    setInstalling(pack.id)
    try {
      await rulesetsApi.uninstallPack(pack.pack_id)
      setPacks((prev) =>
        prev.map((row) =>
          row.pack_id === pack.pack_id
            ? { ...row, installed: false, installed_version: '', update_available: false }
            : row
        )
      )
      onInstalled?.()
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setInstalling('')
    }
  }

  const term = search.trim().toLowerCase()
  const shown = term
    ? packs.filter((pack) =>
        [pack.name, pack.schema_id, pack.description].some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(term)
        )
      )
    : packs

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('contentPacks.browse')}
      style={{ ...scrim, zIndex: 1200 }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          width: '100%',
          maxWidth: 780,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, flex: 1 }}>{t('contentPacks.browse')}</h2>
          <button onClick={onClose} aria-label={t('common.close')} style={iconBtn}>
            <LuX size={18} />
          </button>
        </header>

        <div style={{ display: 'flex', gap: 8, padding: '12px 20px', alignItems: 'center' }}>
          <LuSearch size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('contentPacks.search')}
            aria-label={t('contentPacks.search')}
            style={{ ...fieldInput, flex: 1 }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 16px' }}>
          {/* Said up front, so a GM is not left wondering why the button is
              missing rather than failing. */}
          {!loading && !canInstall && shown.length ? (
            <p role="status" style={{ ...helpText, marginBottom: 12 }}>
              {t('contentPacks.adminOnly')}
            </p>
          ) : null}

          {sourceErrors.length ? (
            <ul
              aria-label={t('characters.sourceProblems')}
              style={{ listStyle: 'none', padding: 0, margin: '0 0 12px', display: 'grid', gap: 6 }}
            >
              {sourceErrors.map((problem) => (
                <li
                  key={problem.url}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--warning)',
                    background: 'var(--bg-card)',
                    fontSize: 12,
                    color: 'var(--text-dim)',
                  }}
                >
                  <span role="status">
                    {t('characters.sourceUnreachable', { url: problem.url })}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {error ? (
            <p role="alert" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          ) : loading ? (
            <Spinner />
          ) : shown.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>{t('contentPacks.noneFound')}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {shown.map((pack) => (
                <li key={pack.id} style={card}>
                  <div
                    style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}
                  >
                    <strong>{pack.name}</strong>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {pack.version ? `v${pack.version}` : null}
                      {pack.schema_id ? ` · ${pack.schema_id}` : ''}
                      {pack.entry_count
                        ? ` · ${t('contentPacks.entries', { count: pack.entry_count })}`
                        : ''}
                    </span>
                    <span style={{ flex: 1 }} />
                    {pack.installed ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12,
                          color: 'var(--text-muted)',
                        }}
                      >
                        <LuCheck size={13} />
                        {pack.installed_version
                          ? t('contentPacks.installedVersion', { version: pack.installed_version })
                          : t('characters.installed')}
                        {canInstall ? (
                          <>
                            <button
                              onClick={() => install(pack)}
                              disabled={installing === pack.id}
                              style={{
                                ...(pack.update_available ? goldBtn : ghostBtn),
                                padding: '4px 10px',
                                fontSize: 12,
                              }}
                            >
                              {pack.update_available ? (
                                <LuDownload size={13} />
                              ) : (
                                <LuRefreshCw size={13} />
                              )}
                              {installing === pack.id
                                ? t('characters.installing')
                                : pack.update_available
                                  ? t('contentPacks.update', { version: pack.version })
                                  : t('contentPacks.reinstall')}
                            </button>
                            <button
                              onClick={() => uninstall(pack)}
                              disabled={installing === pack.id}
                              aria-label={t('contentPacks.uninstall', { name: pack.name })}
                              title={t('contentPacks.uninstall', { name: pack.name })}
                              style={iconBtn}
                            >
                              <LuTrash2 size={14} />
                            </button>
                          </>
                        ) : null}
                      </span>
                    ) : canInstall ? (
                      <button
                        onClick={() => install(pack)}
                        disabled={installing === pack.id}
                        style={{ ...goldBtn, padding: '6px 12px', fontSize: 12 }}
                      >
                        <LuDownload size={13} />
                        {installing === pack.id
                          ? t('characters.installing')
                          : t('characters.install')}
                      </button>
                    ) : null}
                  </div>

                  {pack.description ? (
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>
                      {pack.description}
                    </p>
                  ) : null}

                  {/* What is actually in it, so "109 entries" is not the only
                      thing to go on. */}
                  {pack.content_types?.length ? (
                    <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                      {pack.content_types.join(' · ')}
                    </p>
                  ) : null}

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      marginTop: 8,
                      flexWrap: 'wrap',
                      fontSize: 11,
                      color: 'var(--text-muted)',
                    }}
                  >
                    {pack.license ? (
                      pack.license_url ? (
                        <a
                          href={pack.license_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--gold)' }}
                        >
                          {pack.license}
                          <LuExternalLink size={10} style={{ marginLeft: 3 }} />
                        </a>
                      ) : (
                        <span>{pack.license}</span>
                      )
                    ) : null}
                  </div>

                  {/* Rendered verbatim: several open licences mandate the exact
                      wording, and it should be visible before installing. */}
                  {pack.attribution ? (
                    <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                      {pack.attribution}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {sources.length ? (
          <footer
            style={{
              padding: '10px 20px',
              borderTop: '1px solid var(--border)',
              fontSize: 11,
              color: 'var(--text-muted)',
              wordBreak: 'break-all',
            }}
          >
            {sources.length === 1
              ? t('characters.catalogueSource', { url: sources[0] })
              : t('characters.catalogueSources', { count: sources.length })}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
