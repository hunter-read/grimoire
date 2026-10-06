import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTrash2, LuStore, LuClipboardPaste, LuCheck } from 'react-icons/lu'
import { characters as charactersApi } from '../../api'
import {
  goldBtn,
  ghostBtn,
  iconBtn,
  card,
  fieldLabel,
  codeArea,
  helpText,
  sectionHeading,
} from './characterStyles'

/**
 * The sheets half of the manager: what is installed, and two ways to add more.
 *
 * Pasting takes three boxes rather than one. A custom sheet is a document plus
 * an HTML layout plus a stylesheet, and inlining the layout into JSON means
 * escaping every quote and newline into one unreadable line — the community
 * repo keeps them as sibling files for that reason, and pasting one should not
 * be harder than installing it. The document box accepts YAML as well as JSON,
 * since a sheet is written by hand and YAML is the kinder of the two.
 */
export default function SheetsTab({ schemas, onChanged, onBrowse, setError }) {
  const { t } = useTranslation()
  const [pasting, setPasting] = useState(false)
  const [text, setText] = useState('')
  const [layout, setLayout] = useState('')
  const [styles, setStyles] = useState('')
  const [saving, setSaving] = useState(false)
  const [installed, setInstalled] = useState('')

  const paste = async (event) => {
    event.preventDefault()
    setSaving(true)
    try {
      // Parsed server-side: it already reads JSON and YAML for add-on indexes,
      // and doing it there keeps one parser rather than two that can disagree.
      const body = await charactersApi.importSchema({ text, layout, styles })
      setText('')
      setLayout('')
      setStyles('')
      setPasting(false)
      setInstalled(body.name || body.schema_id)
      setError('')
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (schema) => {
    const name = schema.name || schema.schema_id
    if (!window.confirm(t('characters.confirmUninstall', { name }))) return
    try {
      await charactersApi.deleteSchema(schema.schema_id)
      setError('')
      onChanged?.()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button onClick={onBrowse} style={goldBtn}>
          <LuStore size={14} />
          {t('characters.browseSheets')}
        </button>
        <button onClick={() => setPasting((v) => !v)} style={ghostBtn}>
          <LuClipboardPaste size={14} />
          {t('characters.pasteSheet')}
        </button>
      </div>

      {installed ? (
        <p
          role="status"
          style={{
            ...helpText,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--success, var(--gold))',
            marginBottom: 12,
          }}
        >
          <LuCheck size={13} />
          {t('characters.sheetInstalled', { name: installed })}
        </p>
      ) : null}

      {pasting ? (
        <form onSubmit={paste} style={{ ...card, marginBottom: 20, display: 'grid', gap: 12 }}>
          <div>
            <label htmlFor="sheet-document" style={fieldLabel}>
              {t('characters.sheetDocument')}
            </label>
            <textarea
              id="sheet-document"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={10}
              required
              spellCheck={false}
              style={codeArea}
            />
            <p style={helpText}>{t('characters.sheetDocumentHelp')}</p>
          </div>

          {/* Optional, and only for a sheet that draws itself. A sheet with no
              layout is listed in plain sections, which is a fine sheet. */}
          <div>
            <label htmlFor="sheet-layout" style={fieldLabel}>
              {t('characters.sheetLayout')}
            </label>
            <textarea
              id="sheet-layout"
              value={layout}
              onChange={(event) => setLayout(event.target.value)}
              rows={6}
              spellCheck={false}
              style={codeArea}
            />
            <p style={helpText}>{t('characters.sheetLayoutHelp')}</p>
          </div>

          <div>
            <label htmlFor="sheet-styles" style={fieldLabel}>
              {t('characters.sheetStyles')}
            </label>
            <textarea
              id="sheet-styles"
              value={styles}
              onChange={(event) => setStyles(event.target.value)}
              rows={5}
              spellCheck={false}
              style={codeArea}
            />
            <p style={helpText}>{t('characters.sheetStylesHelp')}</p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={saving || !text.trim()} style={goldBtn}>
              {saving ? t('characters.installing') : t('characters.install')}
            </button>
            <button type="button" onClick={() => setPasting(false)} style={ghostBtn}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : null}

      <h3 style={sectionHeading}>{t('characters.installedSheets')}</h3>
      {schemas.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {t('characters.noSheetsInstalled')}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {schemas.map((schema) => (
            <li
              key={schema.schema_id}
              style={{
                ...card,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {schema.name || schema.schema_id}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {[
                    schema.system,
                    schema.version ? `v${schema.version}` : '',
                    // Said plainly, because it decides whether uninstalling
                    // can be undone by browsing.
                    schema.is_community
                      ? t('characters.fromCatalogue')
                      : t('characters.pastedSheet'),
                    schema.character_count
                      ? t('characters.usedByCount', { count: schema.character_count })
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <button
                onClick={() => remove(schema)}
                aria-label={t('characters.uninstallSheet', {
                  name: schema.name || schema.schema_id,
                })}
                style={iconBtn}
              >
                <LuTrash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
