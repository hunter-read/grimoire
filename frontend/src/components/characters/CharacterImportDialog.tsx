import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuFileUp, LuLink, LuRotateCw } from 'react-icons/lu'
import { characters as charactersApi } from '../../api'
import CharacterDialog from './CharacterDialog'
import ImporterList from './ImporterList'
import Spinner from '../Spinner'
import { goldBtn, ghostBtn, disabledBtn, fieldInput, fieldLabel, helpText } from './characterStyles'

/** Matches the server's cap on an uploaded export. */
const MAX_FILE_BYTES = 10 * 1024 * 1024

/** What the "Read it as" picker sends when the user has not chosen. */
const AUTO = ''
/** Grimoire's own export, which the original import endpoint reads. */
const GRIMOIRE = 'grimoire'

/** A Grimoire character export names the sheet it was built on at its top. */
function isGrimoireExport(payload) {
  return payload !== null && typeof payload === 'object' && typeof payload.schema_id === 'string'
}

function parse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Importing a character: a Grimoire export, or another tool's file or link.
 *
 * Other tools are read by character-importer add-ons an admin installs, so
 * Grimoire itself knows no tool's format. The file or link is recognised
 * automatically; the "Read it as" picker is only needed when two importers
 * both claim it, which the server says in so many words.
 *
 * An importer may declare inputs - a key for a private character, say. They
 * show once that importer is chosen, and when the server answers that one is
 * needed, the dialog chooses that importer, marks the field, and offers to try
 * the same file or link again. What is typed is sent with the import and kept
 * nowhere.
 */
export default function CharacterImportDialog({ onImported, onClose }) {
  const { t } = useTranslation()
  const fileRef = useRef(null)
  // `{importers, available, downloads_enabled}`, or null while it loads.
  const [listing, setListing] = useState(null)
  const importers = listing ? listing.importers || [] : null
  const [choice, setChoice] = useState(AUTO)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  // Answers to the chosen importer's inputs, the keys the server asked for,
  // and the last file or link sent, so asking for a key can end in a retry.
  const [answers, setAnswers] = useState({})
  const [asked, setAsked] = useState([])
  const [lastRequest, setLastRequest] = useState(null)

  const load = useCallback(
    () =>
      charactersApi
        .listImporters()
        .then(setListing)
        // Without the list, Grimoire's own files still import.
        .catch(() => setListing({ importers: [], available: [] })),
    []
  )

  useEffect(() => {
    load()
  }, [load])

  const linkImporters = (importers || []).filter((importer) => importer.accepts_url)
  const chosen = (importers || []).find((importer) => importer.id === choice)
  const acceptsLinks = chosen ? chosen.accepts_url : linkImporters.length > 0

  const inputs = chosen?.inputs || []

  const run = async (request) => {
    setBusy(true)
    setError('')
    try {
      const created = await request()
      onImported(created)
    } catch (err) {
      const detail = err.body?.detail
      if (Array.isArray(detail?.needs_input) && detail.needs_input.length) {
        // The importer wants something typed - choose it, so its fields show.
        setChoice(detail.importer_id || choice)
        setAsked(detail.needs_input)
      }
      setError(err.message)
      setBusy(false)
    }
  }

  // Another tool's file or link. `importer` is who reads it, when known.
  const importExternal = (request, importer = choice) => {
    setLastRequest(request)
    const declared = (importers || []).find((item) => item.id === importer)?.inputs || []
    const given = Object.fromEntries(
      declared
        .map((item) => [item.key, (answers[item.key] || '').trim()])
        .filter(([, value]) => value)
    )
    return run(() =>
      charactersApi.importExternal({
        ...request,
        ...(importer && importer !== GRIMOIRE ? { importer_id: importer } : {}),
        ...(Object.keys(given).length ? { inputs: given } : {}),
      })
    )
  }

  const importFile = async (file) => {
    if (!file || busy) return
    if (fileRef.current) fileRef.current.value = ''
    if (file.size > MAX_FILE_BYTES) {
      setError(t('characters.importTooLarge'))
      return
    }
    const text = await file.text()
    const payload = parse(text)
    // With no importers installed, only Grimoire's own files can be read.
    const grimoireOnly = choice === AUTO && importers !== null && importers.length === 0
    if (choice === GRIMOIRE || grimoireOnly || (choice === AUTO && isGrimoireExport(payload))) {
      if (payload === undefined) {
        setError(t('characters.importInvalidJson'))
        return
      }
      await run(() => charactersApi.import(payload))
      return
    }
    await importExternal({ text, filename: file.name })
  }

  const importLink = async (event) => {
    event.preventDefault()
    if (!url.trim() || busy) return
    await importExternal({ url: url.trim() })
  }

  const onDrop = (event) => {
    event.preventDefault()
    setDragging(false)
    importFile(event.dataTransfer.files?.[0])
  }

  const canLink = acceptsLinks && url.trim() && !busy

  return (
    <CharacterDialog
      title={t('characters.importCharacter')}
      description={t('characters.importHelp')}
      onClose={onClose}
      maxWidth={600}
      footer={
        <button type="button" onClick={onClose} style={ghostBtn}>
          {t('common.cancel')}
        </button>
      }
    >
      <div style={{ display: 'grid', gap: 18 }}>
        {error ? (
          <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>
            {error}
          </div>
        ) : null}

        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-testid="import-drop-zone"
          style={{
            display: 'grid',
            justifyItems: 'center',
            gap: 10,
            padding: '24px 16px',
            borderRadius: 10,
            border: `1px dashed ${dragging ? 'var(--gold)' : 'var(--border)'}`,
            background: dragging ? 'var(--bg-deep)' : 'var(--bg-card)',
            textAlign: 'center',
          }}
        >
          {busy ? (
            <>
              <Spinner size={22} />
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                {t('characters.importing')}
              </span>
            </>
          ) : (
            <>
              <LuFileUp size={26} aria-hidden="true" color="var(--text-muted)" />
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                {t('characters.importDropHere')}
              </span>
              <button type="button" onClick={() => fileRef.current?.click()} style={goldBtn}>
                {t('characters.importChooseFile')}
              </button>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            aria-label={t('characters.importChooseFile')}
            onChange={(event) => importFile(event.target.files?.[0])}
            style={{ display: 'none' }}
          />
        </div>

        {acceptsLinks ? (
          <form onSubmit={importLink}>
            <label htmlFor="character-import-url" style={fieldLabel}>
              {t('characters.importLink')}
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="character-import-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={
                  (chosen || linkImporters[0])?.url_hint || t('characters.importLinkPlaceholder')
                }
                disabled={busy}
                style={{ ...fieldInput, fontSize: 14, padding: '9px 12px', flex: 1, minWidth: 0 }}
              />
              <button type="submit" disabled={!canLink} style={canLink ? goldBtn : disabledBtn}>
                <LuLink size={14} aria-hidden="true" />
                {t('characters.importLinkButton')}
              </button>
            </div>
          </form>
        ) : null}

        {inputs.length ? (
          <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            <legend style={{ ...fieldLabel, padding: 0 }}>
              {t('characters.importInputsFor', { name: chosen.name })}
            </legend>
            {inputs.map((input) => {
              const id = `character-import-input-${input.key}`
              const missing = asked.includes(input.key)
              return (
                <div key={input.key}>
                  <label htmlFor={id} style={{ ...fieldLabel, textTransform: 'none' }}>
                    {input.label}
                    {input.required ? ' *' : ''}
                  </label>
                  <input
                    id={id}
                    type={input.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={answers[input.key] || ''}
                    onChange={(event) =>
                      setAnswers((prev) => ({ ...prev, [input.key]: event.target.value }))
                    }
                    aria-invalid={missing || undefined}
                    disabled={busy}
                    style={{
                      ...fieldInput,
                      fontSize: 14,
                      padding: '9px 12px',
                      ...(missing ? { borderColor: 'var(--danger)' } : {}),
                    }}
                  />
                  <p style={helpText}>
                    {[
                      input.help,
                      input.when === 'link' ? t('characters.importInputForLinks') : '',
                      input.when === 'file' ? t('characters.importInputForFiles') : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  </p>
                </div>
              )
            })}
            <p style={{ ...helpText, margin: 0 }}>{t('characters.importInputsNotKept')}</p>
            {asked.length && lastRequest ? (
              <div>
                <button
                  type="button"
                  onClick={() => importExternal(lastRequest)}
                  disabled={busy}
                  style={busy ? disabledBtn : goldBtn}
                >
                  <LuRotateCw size={14} aria-hidden="true" />
                  {t('characters.importTryAgain')}
                </button>
              </div>
            ) : null}
          </fieldset>
        ) : null}

        <div>
          <label htmlFor="character-import-as" style={fieldLabel}>
            {t('characters.importAs')}
          </label>
          <select
            id="character-import-as"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            disabled={busy}
            style={{ ...fieldInput, fontSize: 14, padding: '9px 12px' }}
          >
            <option value={AUTO}>{t('characters.importAuto')}</option>
            <option value={GRIMOIRE}>{t('characters.importGrimoire')}</option>
            {(importers || []).map((importer) => (
              <option key={importer.id} value={importer.id}>
                {importer.name}
              </option>
            ))}
          </select>
          <p style={helpText}>{t('characters.importAsHelp')}</p>
        </div>

        <ImporterList listing={listing} onChanged={load} />
      </div>
    </CharacterDialog>
  )
}
