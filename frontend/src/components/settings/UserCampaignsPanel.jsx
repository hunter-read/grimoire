import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuScroll, LuChevronDown, LuChevronUp, LuTrash2, LuExternalLink } from 'react-icons/lu'
import { campaigns } from '../../api'

function DeleteWithReasonModal({ campaignName, onConfirm, onCancel }) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const handleConfirm = async () => {
    if (!reason.trim()) {
      setErr(t('users.campaigns.reasonRequired'))
      return
    }
    setSaving(true)
    setErr('')
    try {
      await onConfirm(reason.trim())
    } catch (e) {
      setErr(e?.message || t('users.campaigns.deleteFailed'))
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          width: 420,
          maxWidth: '90vw',
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          {t('users.campaigns.deleteTitle')}
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16 }}>
          {t('users.campaigns.deleteDescription', { name: campaignName })}
        </p>
        <textarea
          autoFocus
          placeholder={t('users.campaigns.reasonPlaceholder')}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            setErr('')
          }}
          rows={3}
          style={{
            width: '100%',
            background: 'var(--bg-input)',
            border: `1px solid ${err ? 'var(--red)' : 'var(--border)'}`,
            color: 'var(--text)',
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 13,
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        {err && (
          <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>{err}</p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onCancel} style={ghostBtnStyle}>
            {t('common.cancel')}
          </button>
          <button onClick={handleConfirm} disabled={saving} style={dangerBtnStyle}>
            {saving ? '…' : t('users.campaigns.confirmDelete')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function UserCampaignsPanel({ userId }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [list, setList] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  const load = async () => {
    setLoading(true)
    setErr('')
    try {
      const data = await campaigns.adminListByUser(userId)
      setList(data)
    } catch (e) {
      setErr(e?.message || t('users.campaigns.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = () => {
    if (!expanded && list === null) load()
    setExpanded((v) => !v)
  }

  const handleDelete = async (campaign, reason) => {
    await campaigns.adminSoftDelete(campaign.id, reason)
    setList((prev) => prev.filter((c) => c.id !== campaign.id))
    setDeletingId(null)
  }

  const deletingCampaign = deletingId ? list?.find((c) => c.id === deletingId) : null

  return (
    <>
      <button
        onClick={handleToggle}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 10px',
          background: 'var(--bg-deep)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          color: 'var(--text-muted)',
          fontSize: 12,
          cursor: 'pointer',
        }}
        aria-expanded={expanded}
        aria-label={t('users.campaigns.toggleLabel')}
      >
        <LuScroll size={12} />
        {t('users.campaigns.toggleLabel')}
        {expanded ? <LuChevronUp size={12} /> : <LuChevronDown size={12} />}
      </button>

      {expanded && (
        <div
          style={{
            marginTop: 8,
            padding: '10px 14px',
            background: 'var(--bg-deep)',
            border: '1px solid var(--border)',
            borderRadius: 8,
          }}
        >
          {loading && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {t('common.loading')}
            </p>
          )}
          {err && (
            <p style={{ fontSize: 13, color: 'var(--red)' }}>{err}</p>
          )}
          {!loading && list !== null && list.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {t('users.campaigns.none')}
            </p>
          )}
          {!loading && list && list.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {list.map((c) => (
                <li
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    background: 'var(--bg-card)',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                  }}
                >
                  <LuScroll size={13} color="var(--gold)" style={{ flexShrink: 0 }} />
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.name}
                  </span>
                  {c.is_gm_campaign && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: 'rgba(200,160,80,0.15)',
                        color: 'var(--gold)',
                        border: '1px solid rgba(200,160,80,0.3)',
                        flexShrink: 0,
                      }}
                    >
                      GM
                    </span>
                  )}
                  <button
                    onClick={() => navigate(`/campaigns/${c.id}`)}
                    title={t('users.campaigns.view')}
                    style={{ ...iconBtnStyle }}
                  >
                    <LuExternalLink size={13} />
                  </button>
                  <button
                    onClick={() => setDeletingId(c.id)}
                    title={t('users.campaigns.delete')}
                    style={{ ...iconBtnStyle, color: 'var(--red)' }}
                  >
                    <LuTrash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {deletingCampaign && (
        <DeleteWithReasonModal
          campaignName={deletingCampaign.name}
          onConfirm={(reason) => handleDelete(deletingCampaign, reason)}
          onCancel={() => setDeletingId(null)}
        />
      )}
    </>
  )
}

const ghostBtnStyle = {
  padding: '6px 14px',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--bg-card)',
  color: 'var(--text-dim)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
}

const dangerBtnStyle = {
  padding: '6px 14px',
  borderRadius: 6,
  fontSize: 13,
  background: 'rgba(196, 80, 64, 0.15)',
  color: 'var(--red)',
  border: '1px solid var(--red)',
  cursor: 'pointer',
}

const iconBtnStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
  alignItems: 'center',
  padding: 4,
  borderRadius: 4,
}
