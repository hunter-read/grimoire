import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuLibrary } from 'react-icons/lu'
import { campaigns } from '../api'
import { useAuth } from '../context/AuthContext'
import Spinner from './Spinner'

/**
 * Picks one of the user's campaigns and bulk-links the given resources to it.
 *
 * `items` is an array of { resource_type, resource_id }; the chosen visibility
 * is applied to all of them. Only campaigns the current user owns are offered,
 * since those are the only ones they can manage.
 */
export default function AddToCampaignModal({ items, onClose, onAdded }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [list, setList] = useState(null)
  const [campaignId, setCampaignId] = useState('')
  const [visibility, setVisibility] = useState('public')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    campaigns
      .list()
      .then((data) => {
        const mine = (data || []).filter((c) => c.owner_id === user?.id && !c.locked)
        setList(mine)
        if (mine.length) setCampaignId(mine[0].id)
      })
      .catch(() => setList([]))
  }, [user?.id])

  const submit = async () => {
    if (!campaignId || saving) return
    setSaving(true)
    setError(null)
    try {
      const payload = items.map((it) => ({ ...it, visibility }))
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
          <span style={{ fontSize: 15, fontWeight: 600 }}>{t('bulk.addToCampaign')}</span>
          <button onClick={onClose} style={closeBtn} aria-label={t('common.close')}>
            <LuX size={16} />
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18 }}>
          {t('addToCampaign.intro', { count: items.length })}
        </p>

        {list === null ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <Spinner size={20} />
          </div>
        ) : list.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0 20px' }}>
            {t('addToCampaign.noCampaigns')}
          </p>
        ) : (
          <>
            <label style={label}>{t('addToCampaign.campaignLabel')}</label>
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              style={{ ...input, appearance: 'auto', marginBottom: 16 }}
            >
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <label style={label}>{t('campaignEditor.resources.visibilityLabel')}</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              style={{ ...input, appearance: 'auto', marginBottom: 8 }}
            >
              <option value="public">{t('resources.vis_public')}</option>
              <option value="private">{t('resources.vis_private')}</option>
              <option value="gm">{t('resources.vis_gm')}</option>
            </select>
          </>
        )}

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 13, margin: '8px 0' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} style={cancelBtn}>
            {t('common.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={!campaignId || saving || (list && list.length === 0)}
            style={{
              ...goldBtn,
              opacity: !campaignId || saving || (list && list.length === 0) ? 0.5 : 1,
            }}
          >
            <LuLibrary size={14} /> {saving ? t('bulk.applying') : t('addToCampaign.add')}
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
  width: 380,
  maxWidth: '92vw',
  boxSizing: 'border-box',
}
const header = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 8,
}
const closeBtn = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
  padding: 2,
}
const label = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-muted)',
  fontWeight: 500,
  marginBottom: 6,
}
const input = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 14,
  boxSizing: 'border-box',
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
