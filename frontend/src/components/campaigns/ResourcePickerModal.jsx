import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuLibrary } from 'react-icons/lu'
import { campaigns } from '../../api'
import ResourcePicker from './ResourcePicker'

/**
 * Modal for linking additional library resources to an existing campaign.
 *
 * Wraps the shared ResourcePicker: the GM checks any number of items across
 * types/folders, sets each one's visibility, then commits them in a single
 * bulk-add. Already-linked resources are excluded from the browser, and the
 * campaign's own game system (`pinSystem`) is floated to the top of the tree.
 */
export default function ResourcePickerModal({
  campaignId,
  pinSystem,
  linkedKeys,
  onClose,
  onAdded,
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    if (selected.length === 0 || saving) return
    setSaving(true)
    setError(null)
    try {
      const payload = selected.map((r) => ({
        resource_type: r.resource_type,
        resource_id: r.resource_id,
        visibility: r.visibility,
      }))
      const added = await campaigns.bulkAddResources(campaignId, payload)
      onAdded(added)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={panel}>
        <div style={header}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{t('resources.linkTitle')}</span>
          <button onClick={onClose} style={closeBtn} aria-label={t('common.close')}>
            <LuX size={16} />
          </button>
        </div>

        {/* No system filter here: linking can pull books from any system. The
            campaign's own system is floated to the top of the tree instead. */}
        <ResourcePicker
          selected={selected}
          setSelected={setSelected}
          excludeKeys={linkedKeys}
          pinSystem={pinSystem}
        />

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 13, margin: '8px 0' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} style={cancelBtn}>
            {t('common.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={selected.length === 0 || saving}
            style={{ ...goldBtn, opacity: selected.length === 0 || saving ? 0.5 : 1 }}
          >
            <LuLibrary size={14} />{' '}
            {saving
              ? t('bulk.applying')
              : t('campaignEditor.resources.addSelected', { count: selected.length })}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlay = {
  position: 'fixed',
  inset: 0,
  zIndex: 1200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--scrim)',
  padding: 16,
}
const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 24,
  width: 560,
  maxWidth: '94vw',
  maxHeight: '90vh',
  overflowY: 'auto',
  boxSizing: 'border-box',
}
const header = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
}
const closeBtn = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
  padding: 2,
}
const cancelBtn = {
  padding: '7px 16px',
  borderRadius: 6,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text-dim)',
  fontSize: 14,
  cursor: 'pointer',
}
const goldBtn = {
  padding: '7px 18px',
  borderRadius: 6,
  background: 'var(--gold-dim)',
  border: 'none',
  color: 'var(--bg-deep)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}
