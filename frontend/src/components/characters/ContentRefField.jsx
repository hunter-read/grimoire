import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuSearch, LuX } from 'react-icons/lu'
import ContentBrowser from './ContentBrowser'
import { ghostBtn, iconBtn, fieldLabel } from './characterStyles'

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

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div
          style={{
            flex: 1,
            padding: '6px 9px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--bg-deep)',
            color: display ? 'var(--text)' : 'var(--text-muted)',
            fontSize: 13,
            minHeight: 18,
          }}
        >
          {display || '—'}
          {missing ? (
            <span style={{ color: 'var(--warning)', fontSize: 11, marginLeft: 6 }}>
              {t('characters.entryMissing')}
            </span>
          ) : null}
        </div>

        {readOnly ? null : (
          <>
            <button
              type="button"
              onClick={() => setBrowsing(true)}
              aria-label={t('characters.browseCatalog')}
              title={t('characters.browseCatalog')}
              style={{ ...ghostBtn, padding: '6px 10px' }}
            >
              <LuSearch size={14} />
            </button>
            {ref ? (
              <button
                type="button"
                onClick={() => onChange?.(null)}
                aria-label={t('characters.clearChoice')}
                title={t('characters.clearChoice')}
                style={iconBtn}
              >
                <LuX size={14} />
              </button>
            ) : null}
          </>
        )}
      </div>

      {browsing ? (
        <ContentBrowser
          schemaId={schemaId}
          contentType={definition.content_type}
          typeDefinition={typeDefinition}
          chosen={ref ? [ref] : []}
          onChoose={(picked) => onChange?.(picked)}
          onClose={() => setBrowsing(false)}
        />
      ) : null}
    </div>
  )
}
