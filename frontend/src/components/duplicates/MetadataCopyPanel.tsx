import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCopy } from 'react-icons/lu'

import Spinner from '../Spinner'

/**
 * Copy chosen metadata fields from one copy onto the other.
 *
 * Keeping the better *file* should not mean keeping the worse *record*: a
 * pristine scan often arrives with nothing but a filename, while the copy you
 * are about to discard has the title, publisher, and tags you curated. Fields
 * are picked explicitly rather than copied wholesale, because a blanket copy is
 * how the good record's title gets overwritten by the bad one's.
 *
 * Only fields that actually differ are offered — copying a value onto an
 * identical one is a no-op the user should not have to reason about.
 */
export default function MetadataCopyPanel({ fields, differences, source, target, onCopy, busy }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState([])

  const differing = new Set((differences || []).filter((d) => !d.same).map((d) => d.field))
  const offered = (fields || []).filter((f) => differing.has(f))
  if (offered.length === 0 || !source || !target) return null

  const toggle = (field) =>
    setSelected((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    )

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 16,
        background: 'var(--bg-card)',
        marginBottom: 16,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
        {t('maintenance.dupes.copyMetadata')}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>
        {t('maintenance.dupes.copyExplainer', {
          source: source.filename,
          target: target.filename,
        })}
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 16px',
          marginBottom: 14,
        }}
      >
        {offered.map((field) => (
          <label
            key={field}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
          >
            <input
              type="checkbox"
              checked={selected.includes(field)}
              onChange={() => toggle(field)}
            />
            {t(`maintenance.dupes.field.${field}`, { defaultValue: field })}
          </label>
        ))}
      </div>

      <button
        type="button"
        disabled={busy || selected.length === 0}
        onClick={() => onCopy(selected)}
        style={{
          background: 'var(--bg-deep)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          borderRadius: 6,
          padding: '7px 16px',
          cursor: selected.length === 0 ? 'default' : 'pointer',
          fontSize: 13,
          opacity: busy || selected.length === 0 ? 0.5 : 1,
        }}
      >
        {busy ? <Spinner size={13} /> : <LuCopy size={13} aria-hidden="true" />}{' '}
        {t('maintenance.dupes.copySelected', { count: selected.length })}
      </button>
    </div>
  )
}
