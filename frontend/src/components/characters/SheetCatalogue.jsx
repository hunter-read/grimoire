import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuCheck, LuDownload, LuExternalLink, LuSearch } from 'react-icons/lu'
import { characters as charactersApi } from '../../api'
import Spinner from '../Spinner'
import AuthorByline from '../settings/AuthorByline'
import { goldBtn, ghostBtn, iconBtn, fieldInput, card } from './characterStyles'

/**
 * Browse the community catalogue of character sheets and install one.
 *
 * Any account may install: a sheet lives in one user's account and changes
 * nothing for anyone else, so there is no admin step — the same rule themes
 * follow. The catalogue itself comes from whichever add-on index the admin
 * configured, so pointing the server at a branch points this at it too.
 */
export default function SheetCatalogue({ onInstalled, onClose }) {
  const { t } = useTranslation()
  const [sheets, setSheets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [installing, setInstalling] = useState('')
  const [indexUrl, setIndexUrl] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await charactersApi.browseSheets()
      setSheets(result.sheets || [])
      setIndexUrl(result.index_url || '')
      setError('')
    } catch (e) {
      setError(e.message || t('characters.catalogueFailed'))
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

  const install = async (sheet) => {
    setInstalling(sheet.id)
    try {
      await charactersApi.installSheet(sheet.id)
      setSheets((prev) =>
        prev.map((row) => (row.id === sheet.id ? { ...row, installed: true } : row))
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
    ? sheets.filter((sheet) =>
        [sheet.name, sheet.system, sheet.description].some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(term)
        )
      )
    : sheets

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('characters.browseSheets')}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--scrim-strong)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
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
          <h2 style={{ margin: 0, fontSize: 16, flex: 1 }}>{t('characters.browseSheets')}</h2>
          <button onClick={onClose} aria-label={t('common.close')} style={iconBtn}>
            <LuX size={18} />
          </button>
        </header>

        <div style={{ display: 'flex', gap: 8, padding: '12px 20px', alignItems: 'center' }}>
          <LuSearch size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('characters.searchSheets')}
            aria-label={t('characters.searchSheets')}
            style={{ ...fieldInput, flex: 1 }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 16px' }}>
          {error ? (
            <p role="alert" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          ) : loading ? (
            <Spinner />
          ) : shown.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>{t('characters.noSheetsFound')}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {shown.map((sheet) => (
                <li key={`${sheet.index_url}:${sheet.id}`} style={card}>
                  <div
                    style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}
                  >
                    <strong>{sheet.name}</strong>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {sheet.version ? `v${sheet.version}` : null}
                      {sheet.system ? ` · ${sheet.system}` : ''}
                      {sheet.custom_layout ? ` · ${t('characters.customLayout')}` : ''}
                    </span>
                    <span style={{ flex: 1 }} />
                    {sheet.installed ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 12,
                          color: 'var(--text-muted)',
                        }}
                      >
                        <LuCheck size={13} />
                        {t('characters.installed')}
                      </span>
                    ) : (
                      <button
                        onClick={() => install(sheet)}
                        disabled={installing === sheet.id}
                        style={{ ...goldBtn, padding: '6px 12px', fontSize: 12 }}
                      >
                        <LuDownload size={13} />
                        {installing === sheet.id
                          ? t('characters.installing')
                          : t('characters.install')}
                      </button>
                    )}
                  </div>

                  {sheet.description ? (
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>
                      {sheet.description}
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
                    {sheet.author ? (
                      <AuthorByline author={sheet.author} authorUrl={sheet.author_url} />
                    ) : null}
                    {sheet.license ? (
                      sheet.license_url ? (
                        <a
                          href={sheet.license_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--gold)' }}
                        >
                          {sheet.license}
                          <LuExternalLink size={10} style={{ marginLeft: 3 }} />
                        </a>
                      ) : (
                        <span>{sheet.license}</span>
                      )
                    ) : null}
                  </div>

                  {/* Rendered verbatim: several open licences mandate the exact
                      wording, and it should be visible before installing. */}
                  {sheet.attribution ? (
                    <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                      {sheet.attribution}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {indexUrl ? (
          <footer
            style={{
              padding: '10px 20px',
              borderTop: '1px solid var(--border)',
              fontSize: 11,
              color: 'var(--text-muted)',
              wordBreak: 'break-all',
            }}
          >
            {t('characters.catalogueSource', { url: indexUrl })}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
