import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuSearch, LuX } from 'react-icons/lu'
import ContentBrowser from './ContentBrowser'
import { iconBtn, fieldLabel } from './characterStyles'

/**
 * A single pick from the catalog — a class, an ancestry, a kit.
 *
 * Stores `{_ref, _source}`, never a copy of the entry, so an erratum or a
 * ruleset edit reaches every character that chose it. The entry's own values
 * come from `entries`, which the sheet resolves in one request.
 */
export default function ContentRefField({
  name,
  definition = {},
  value,
  entries = {},
  schemaId,
  typeDefinition = {},
  onChange,
  readOnly = false,
  hideLabel = false,
}) {
  const { t } = useTranslation()
  const [browsing, setBrowsing] = useState(false)

  const ref = value && typeof value === 'object' ? value : null
  const entry = ref?._ref ? entries[ref._ref] : null
  // A reference whose entry is not installed still shows what was chosen: the
  // id is what the player picked, and hiding it would look like data loss.
  const display = entry?.name || ref?._ref || ''
  const missing = !!ref?._ref && !entry

  return (
    <div className="gc-field">
      {hideLabel ? null : <div style={fieldLabel}>{definition.label || name}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {/* The box itself opens the picker. A separate search button beside it
            cost ~40px, and in a row of pickers that squeezed each name until it
            wrapped - "Dragonborn" over two lines. It stays on one line now, and
            the full name is in the tooltip if it has to be cut short. */}
        <button
          type="button"
          onClick={readOnly ? undefined : () => setBrowsing(true)}
          disabled={readOnly}
          aria-label={
            readOnly
              ? display || definition.label || name
              : t('characters.chooseEntry', { label: definition.label || name })
          }
          title={display || undefined}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 9px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--bg-deep)',
            color: display ? 'var(--text)' : 'var(--text-muted)',
            fontSize: 13,
            minHeight: 32,
            textAlign: 'left',
            cursor: readOnly ? 'default' : 'pointer',
            font: 'inherit',
          }}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {display || '—'}
          </span>
          {missing ? (
            <span style={{ color: 'var(--warning)', fontSize: 11, whiteSpace: 'nowrap' }}>
              {t('characters.entryMissing')}
            </span>
          ) : null}
          {readOnly ? null : <LuSearch size={13} style={{ flexShrink: 0, opacity: 0.6 }} />}
        </button>

        {readOnly || !ref ? null : (
          <button
            type="button"
            onClick={() => onChange?.(null, { entry: null })}
            aria-label={t('characters.clearChoice')}
            title={t('characters.clearChoice')}
            style={{ ...iconBtn, padding: 3 }}
          >
            <LuX size={14} />
          </button>
        )}
      </div>

      {browsing ? (
        <ContentBrowser
          schemaId={schemaId}
          contentType={definition.content_type}
          typeDefinition={typeDefinition}
          chosen={ref ? [ref] : []}
          onChoose={(picked, entry) => onChange?.(picked, { entry })}
          onClose={() => setBrowsing(false)}
        />
      ) : null}
    </div>
  )
}
