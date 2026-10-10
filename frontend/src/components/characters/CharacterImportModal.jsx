import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuFileUp, LuLink } from 'react-icons/lu'
import { characters as charactersApi } from '../../api'
import CharacterDialog from './CharacterDialog'
import { goldBtn, ghostBtn, disabledBtn, fieldInput, fieldLabel, helpText } from './characterStyles'

/**
 * Import a character from a Grimoire export file or from a sheet-declared URL
 * source (e.g. DiceCloud v1 on the D&D 5e sheet).
 */
export default function CharacterImportModal({ onImported, onClose }) {
  const { t } = useTranslation()
  const fileRef = useRef(null)
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [sources, setSources] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let cancelled = false
    charactersApi
      .listImportSources()
      .then((res) => {
        if (!cancelled) setSources(res.sources || [])
      })
      .catch(() => {
        if (!cancelled) setSources([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const runFile = useCallback(
    async (file) => {
      if (!file || busy) return
      setBusy(true)
      setError('')
      try {
        const payload = JSON.parse(await file.text())
        const created = await charactersApi.import(payload)
        onImported?.(created)
      } catch (e) {
        setError(e instanceof SyntaxError ? t('characters.importInvalidJson') : e.message)
        setBusy(false)
      }
    },
    [busy, onImported, t]
  )

  const runUrl = async (event) => {
    event.preventDefault()
    if (!url.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const created = await charactersApi.importFromUrl({
        url: url.trim(),
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      })
      onImported?.(created)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const onDrop = (event) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer?.files?.[0]
    if (file) runFile(file)
  }

  // Group sources by sheet for the help list.
  const bySheet = []
  const seen = new Map()
  for (const source of sources) {
    const key = source.schema_id
    if (!seen.has(key)) {
      const group = {
        schema_id: source.schema_id,
        schema_name: source.schema_name,
        system: source.system,
        sources: [],
      }
      seen.set(key, group)
      bySheet.push(group)
    }
    seen.get(key).sources.push(source)
  }

  const needsKey = sources.some(
    (s) => s.id === 'dicecloud-v1' && s.available && url.toLowerCase().includes('dicecloud')
  )

  return (
    <CharacterDialog
      title={t('characters.importCharacter')}
      description={t('characters.importHelp')}
      onClose={onClose}
      maxWidth={560}
      footer={
        <button type="button" onClick={onClose} style={ghostBtn} disabled={busy}>
          {t('common.cancel')}
        </button>
      }
    >
      <div style={{ display: 'grid', gap: 20 }}>
        {error ? (
          <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>
            {error}
          </div>
        ) : null}

        <section>
          <div style={{ ...fieldLabel, marginBottom: 8 }}>{t('characters.importFromFile')}</div>
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileRef.current?.click()
              }
            }}
            onClick={() => fileRef.current?.click()}
            onDragEnter={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            aria-label={t('characters.importDropHint')}
            style={{
              border: `2px dashed ${dragging ? 'var(--gold)' : 'var(--border)'}`,
              borderRadius: 12,
              padding: '28px 16px',
              textAlign: 'center',
              cursor: busy ? 'wait' : 'pointer',
              background: dragging ? 'var(--bg-card)' : 'transparent',
              color: 'var(--text-dim)',
              fontSize: 13,
            }}
          >
            <LuFileUp size={22} aria-hidden="true" style={{ marginBottom: 8, opacity: 0.7 }} />
            <div>{busy ? t('characters.importing') : t('characters.importDropHint')}</div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            aria-label={t('characters.importFromFile')}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) runFile(file)
            }}
            style={{ display: 'none' }}
          />
        </section>

        <section>
          <form onSubmit={runUrl} style={{ display: 'grid', gap: 10 }}>
            <label htmlFor="character-import-url" style={fieldLabel}>
              <LuLink size={14} aria-hidden="true" style={{ marginRight: 6, verticalAlign: -2 }} />
              {t('characters.importFromUrl')}
            </label>
            <input
              id="character-import-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('characters.importUrlPlaceholder')}
              disabled={busy}
              style={fieldInput}
            />
            {needsKey ? (
              <div>
                <label htmlFor="character-import-api-key" style={fieldLabel}>
                  {t('characters.importApiKey')}
                </label>
                <input
                  id="character-import-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t('characters.importApiKeyPlaceholder')}
                  disabled={busy}
                  autoComplete="off"
                  style={fieldInput}
                />
                <div style={helpText}>{t('characters.importApiKeyHelp')}</div>
              </div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                disabled={busy || !url.trim()}
                style={busy || !url.trim() ? disabledBtn : goldBtn}
              >
                {busy ? t('characters.importing') : t('characters.importUrlSubmit')}
              </button>
            </div>
          </form>
        </section>

        <section>
          <div style={{ ...fieldLabel, marginBottom: 8 }}>{t('characters.importSupported')}</div>
          {bySheet.length === 0 ? (
            <p style={{ ...helpText, margin: 0 }}>{t('characters.importSupportedEmpty')}</p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'grid',
                gap: 12,
              }}
            >
              {bySheet.map((sheet) => (
                <li
                  key={sheet.schema_id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: '12px 14px',
                    background: 'var(--bg-card)',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                    {sheet.schema_name}
                  </div>
                  {sheet.system ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                      {sheet.system}
                    </div>
                  ) : null}
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-dim)' }}>
                    {sheet.sources.map((source) => (
                      <li key={`${sheet.schema_id}:${source.id}`} style={{ marginBottom: 4 }}>
                        <strong style={{ color: 'var(--text)' }}>{source.name}</strong>
                        {!source.available ? (
                          <span style={{ color: 'var(--text-muted)' }}>
                            {' '}
                            ({t('characters.importSourceUnavailable')})
                          </span>
                        ) : null}
                        <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>
                          {source.url_patterns.join(', ')}
                        </div>
                        {source.example_url ? (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {t('characters.importExample')}: {source.example_url}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <p style={{ ...helpText, marginTop: 12, marginBottom: 0 }}>
            {t('characters.importFileAlways')}
          </p>
        </section>
      </div>
    </CharacterDialog>
  )
}
