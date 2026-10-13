import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuArrowUp, LuChevronDown, LuChevronRight, LuPuzzle, LuTrash2 } from 'react-icons/lu'
import { ghostBtn, helpText } from './characterStyles'
import { safeLink } from './importerLinks'

const meta = { fontSize: 12, color: 'var(--text-muted)' }
const small = { ...ghostBtn, padding: '4px 10px', fontSize: 12 }
const link = { color: 'var(--gold)', wordBreak: 'break-all' }

/**
 * One installed importer in the import dialog: its name and what it reads on
 * one line, with the rest - what it is, who made the source, an example of
 * the links it takes, its website - a click away.
 */
export default function InstalledImporter({ importer, downloads, working, onUpdate, onRemove }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const example = importer.accepts_url ? safeLink(importer.url_hint) : null
  const website = safeLink(importer.homepage)

  const summary = [
    importer.extensions.join(' '),
    importer.accepts_url ? t('characters.importerTakesLinks') : '',
    importer.sheet_installed
      ? t('characters.importerSheet', { sheet: importer.sheet_name })
      : t('characters.importerSheetMissing', { sheet: importer.sheet }),
    importer.scope === 'user' ? t('characters.importerYours') : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li
      style={{
        padding: '8px 12px',
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          aria-controls={detailsId}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flex: 1,
            minWidth: 0,
            padding: 0,
            background: 'none',
            border: 'none',
            color: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          {open ? (
            <LuChevronDown size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
          ) : (
            <LuChevronRight size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
          )}
          <LuPuzzle
            size={16}
            aria-hidden="true"
            color="var(--text-muted)"
            style={{ flexShrink: 0 }}
          />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{importer.name}</span>
            <span
              style={{
                ...meta,
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {summary}
            </span>
          </span>
        </button>
        {importer.scope === 'user' ? (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {importer.available_version && downloads ? (
              <button type="button" onClick={onUpdate} disabled={working} style={small}>
                <LuArrowUp size={12} aria-hidden="true" />
                {t('characters.importerUpdate', { version: importer.available_version })}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onRemove}
              disabled={working}
              aria-label={t('characters.importerRemove', { name: importer.name })}
              style={small}
            >
              <LuTrash2 size={12} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      {open ? (
        <div id={detailsId} style={{ margin: '8px 0 2px 22px', display: 'grid', gap: 4 }}>
          {importer.description ? (
            <p style={{ ...helpText, margin: 0 }}>{importer.description}</p>
          ) : null}
          {importer.attribution ? (
            <p style={{ ...helpText, margin: 0, fontStyle: 'italic' }}>{importer.attribution}</p>
          ) : null}
          {example ? (
            <p style={{ ...meta, margin: 0 }}>
              {t('characters.importerLinkExample')}{' '}
              <a href={example} target="_blank" rel="noreferrer noopener" style={link}>
                {example}
              </a>
            </p>
          ) : null}
          {website ? (
            <p style={{ ...meta, margin: 0 }}>
              {t('characters.importerWebsite')}:{' '}
              <a href={website} target="_blank" rel="noreferrer noopener" style={link}>
                {website}
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
