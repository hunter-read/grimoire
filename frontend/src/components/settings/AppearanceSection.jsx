import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuDownload, LuLink, LuPalette, LuTrash2, LuUpload } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'
import { useTheme } from '../../context/ThemeContext'
import { THEME_MODES } from '../../utils/theme'
import AuthorByline from './AuthorByline'

/**
 * Per-user appearance: light/dark/system, plus installing and picking a theme.
 *
 * Not admin-gated, unlike the add-ons panel — a theme only ever changes what
 * the person choosing it sees, so there is nothing for an admin to approve. The
 * one admin-only control here is the catalogue URL, which is server-wide.
 *
 * A theme that ships both a light and a dark palette is one row marked
 * "light & dark", not two entries: pairing them is what lets System mode work
 * with an installed theme rather than pinning the user to one side.
 */
export default function AppearanceSection() {
  const { t } = useTranslation()
  const { mode, themeId, installed, builtIn, setMode, selectTheme, reload } = useTheme()

  const [catalogue, setCatalogue] = useState(null)
  const [browsing, setBrowsing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [state, setState] = useState(null)

  const loadState = useCallback(() => {
    api
      .get('/themes')
      .then(setState)
      .catch((e) => setError(e.message))
  }, [])

  useEffect(loadState, [loadState])

  // Resolves to true on success, false on failure, so a caller can follow up
  // without having to re-inspect the error it already reported.
  const run = (promise, successMessage) => {
    setBusy(true)
    setError('')
    setNotice('')
    return promise
      .then(() => {
        if (successMessage) setNotice(successMessage)
        reload()
        loadState()
        return true
      })
      .catch((e) => {
        setError(e.message)
        return false
      })
      .finally(() => setBusy(false))
  }

  const browse = () => {
    setBusy(true)
    setError('')
    api
      .get('/themes/browse')
      .then((body) => {
        setCatalogue(body)
        setBrowsing(true)
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false))
  }

  const install = (id) =>
    run(api.post(`/themes/install/${id}`), t('appearance.installed')).then((ok) => {
      // Only re-browse on success: refreshing the catalogue clears the error
      // the user needs to read.
      if (ok && browsing) browse()
    })

  const remove = (id) => run(api.delete(`/themes/${id}`), t('appearance.removed'))

  const importPasted = () => {
    let parsed
    try {
      parsed = JSON.parse(pasted)
    } catch {
      setError(t('appearance.notJson'))
      return
    }
    run(api.post('/themes', parsed), t('appearance.installed')).then((ok) => {
      // Keep the pasted text on failure so the user can correct it rather than
      // retype it.
      if (!ok) return
      setPasted('')
      setPasting(false)
    })
  }

  const downloadsEnabled = state?.downloads_enabled !== false

  return (
    <div>
      {/* "Theme", not "Appearance" — the group heading above already says
          Appearance, and this section is specifically the theme picker. */}
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
        {t('appearance.themeTitle')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('appearance.description')}
      </p>

      {error && (
        <div role="alert" style={{ marginBottom: 12, fontSize: 13, color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      {notice && (
        <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--success)' }}>{notice}</div>
      )}

      <fieldset style={{ border: 'none', marginBottom: 28 }}>
        <legend style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>
          {t('appearance.mode')}
        </legend>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {THEME_MODES.map((m) => (
            <label
              key={m}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 14,
                background: mode === m ? 'var(--gold)' : 'var(--bg-card)',
                color: mode === m ? 'var(--on-accent)' : 'var(--text)',
                border: `1px solid ${mode === m ? 'var(--gold)' : 'var(--border)'}`,
              }}
            >
              <input
                type="radio"
                name="theme-mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                style={{ margin: 0, width: 14, height: 14 }}
              />
              {t(`appearance.modes.${m}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {/* A part of the Theme section, so it sits below its 15px heading. */}
      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
        {t('appearance.yourThemes')}
      </h4>

      <ul style={{ listStyle: 'none', marginBottom: 16 }}>
        {builtIn.map((theme) => (
          <li key={theme.id || 'default'}>
            <label style={rowStyle(themeId === theme.id)}>
              <input
                type="radio"
                name="theme"
                checked={themeId === theme.id}
                onChange={() => selectTheme(theme.id)}
                style={{ margin: 0, width: 14, height: 14 }}
              />
              <span style={{ flex: 1 }}>
                {theme.name}
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
                  {t('appearance.builtInLabel')}
                </span>
              </span>
            </label>
          </li>
        ))}
        {installed.map((theme) => (
          <li key={theme.id}>
            <label style={rowStyle(themeId === theme.id)}>
              <input
                type="radio"
                name="theme"
                checked={themeId === theme.id}
                onChange={() => selectTheme(theme.id)}
                style={{ margin: 0, width: 14, height: 14 }}
              />
              <span style={{ flex: 1 }}>
                {theme.name}
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
                  {themeCoverage(t, theme)}
                  {theme.is_community ? ` · ${t('appearance.community')}` : ''}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(theme.id)}
                disabled={busy}
                aria-label={t('appearance.remove', { name: theme.name })}
                style={{ background: 'none', color: 'var(--danger)', display: 'flex', padding: 4 }}
              >
                <LuTrash2 size={14} />
              </button>
            </label>
          </li>
        ))}
      </ul>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {downloadsEnabled && (
          <button type="button" onClick={browse} disabled={busy} style={actionStyle}>
            {busy ? <Spinner size={14} /> : <LuPalette size={14} />}
            {t('appearance.browse')}
          </button>
        )}
        <button
          type="button"
          onClick={() => setPasting((v) => !v)}
          disabled={busy}
          style={actionStyle}
        >
          <LuUpload size={14} />
          {t('appearance.import')}
        </button>
      </div>

      {!downloadsEnabled && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
          {t('appearance.downloadsDisabled')}
        </p>
      )}

      {pasting && (
        <div style={{ marginBottom: 24 }}>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={8}
            aria-label={t('appearance.pasteLabel')}
            placeholder='{"id": "my-theme", "name": "My Theme", "mode": "dark", "tokens": {...}}'
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
          />
          <button
            type="button"
            onClick={importPasted}
            disabled={busy || !pasted.trim()}
            style={{ ...actionStyle, marginTop: 8 }}
          >
            {t('appearance.importAction')}
          </button>
        </div>
      )}

      {browsing && catalogue && (
        <div>
          <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>
            {t('appearance.catalogue')}
          </h4>
          {catalogue.themes.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('appearance.empty')}</p>
          )}
          <ul style={{ listStyle: 'none' }}>
            {catalogue.themes.map((theme) => (
              <li
                key={theme.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  marginBottom: 6,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>{theme.name}</div>
                  {theme.description && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {theme.description}
                    </div>
                  )}
                  <AuthorByline author={theme.author} authorUrl={theme.author_url} />
                </div>
                {theme.installed ? (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {t('appearance.alreadyInstalled')}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => install(theme.id)}
                    disabled={busy}
                    style={actionStyle}
                  >
                    <LuDownload size={13} />
                    {t('appearance.install')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {catalogue.is_custom_url && (
            <p
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                marginTop: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <LuLink size={12} />
              {catalogue.index_url}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * How a theme describes its colour coverage in the picker.
 *
 * A theme shipping both palettes is one entry that reads "Light & dark", so it
 * is clear System mode will work with it — that is the whole reason for pairing
 * them rather than listing two themes.
 */
function themeCoverage(t, theme) {
  const modes = theme.modes?.length ? theme.modes : [theme.mode || 'dark']
  if (modes.length > 1) return t('appearance.bothModes')
  return t(`appearance.modes.${modes[0]}`)
}

const rowStyle = (active) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 8,
  marginBottom: 6,
  cursor: 'pointer',
  fontSize: 14,
  background: 'var(--bg-card)',
  border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
})

const actionStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  borderRadius: 8,
  fontSize: 13,
  background: 'var(--bg-card)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
}
