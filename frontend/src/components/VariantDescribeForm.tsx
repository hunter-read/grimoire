import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { duplicates } from '../api'
import { kindsFor } from '../constants/variantKinds'

/**
 * Rename one version: its kind and free-text label.
 *
 * Works for either end of a family. A variant always has a kind; the main
 * version may have none, which is what "Main version" means - so its list
 * opens with that choice. Naming the main is the point of issue #556: in a map
 * pack whose main is the gridless cut, "Main version" hides the one thing the
 * family exists to tell apart.
 *
 * Admin-only by its callers, because `/duplicates/describe` is.
 *
 * @param {object} props
 * @param {object} props.option the version: `{ id, isMain, kind, label }`
 * @param {string} props.resourceType `book`, `map`, `token`, `audio` or `model`
 * @param {Function} props.onSaved called with `{ kind, label }` once stored
 * @param {Function} props.onCancel called when the user backs out
 */
export default function VariantDescribeForm({ option, resourceType, onSaved, onCancel }) {
  const { t } = useTranslation()
  const [kind, setKind] = useState(option.kind || '')
  const [label, setLabel] = useState(option.label || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const kinds = kindsFor(resourceType, option.kind || '')
  // A variant with no stored kind (very old rows) still has to submit one.
  const choices = option.isMain ? ['', ...kinds] : kinds
  const value = option.isMain || kind ? kind : 'other'

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await duplicates.describe(resourceType, option.id, { kind: value, label })
      onSaved({ kind: res?.kind ?? value, label: res?.label ?? label.trim() })
    } catch (err) {
      setError(err?.message || t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  const fieldStyle = {
    background: 'var(--bg-deep)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    borderRadius: 4,
    padding: '4px 6px',
    fontSize: 12,
  }
  const btnStyle = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    color: 'var(--text-dim)',
    borderRadius: 4,
    padding: '3px 10px',
    fontSize: 12,
    cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.6 : 1,
  }

  return (
    <form
      onSubmit={save}
      // Clicks and keys inside the form must not reach a surrounding menu, which
      // would treat them as a choice (or Escape) and close itself.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {t('variants.renameKind')}
        <select
          value={value}
          disabled={busy}
          onChange={(e) => setKind(e.target.value)}
          style={fieldStyle}
        >
          {choices.map((k) => (
            <option key={k || 'main'} value={k}>
              {k ? t(`variants.kind.${k}`, { defaultValue: k }) : t('variants.mainVersion')}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {t('variants.renameLabel')}
        <input
          type="text"
          value={label}
          maxLength={120}
          disabled={busy}
          placeholder={t('variants.labelPlaceholder')}
          onChange={(e) => setLabel(e.target.value)}
          style={fieldStyle}
        />
      </label>
      {error && (
        <div role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="submit" disabled={busy} style={btnStyle}>
          {t('common.save')}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} style={btnStyle}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
