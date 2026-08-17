import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LuUserPlus } from 'react-icons/lu'
import { campaigns } from '../../api'
import Spinner from '../Spinner'

/** Lists campaign-eligible users not yet invited, with an invite action. */
export default function InvitePanel({ campaignId, onInvited }) {
  const { t } = useTranslation()
  const [users, setUsers] = useState(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    campaigns
      .eligibleMembers(campaignId)
      .then(setUsers)
      .catch(() => setUsers([]))
  }, [campaignId])

  const invite = async (userId) => {
    setLoading(true)
    try {
      await campaigns.invite(campaignId, userId)
      onInvited()
    } catch (e) {
      alert(e.message)
    } finally {
      setLoading(false)
    }
  }

  const uninvited = useMemo(() => (users ?? []).filter((u) => !u.already_invited), [users])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return uninvited
    return uninvited.filter((u) =>
      `${u.display_name || ''} ${u.username || ''}`.toLowerCase().includes(q)
    )
  }, [uninvited, query])

  if (!users) return <Spinner size={16} />

  if (uninvited.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
        {t('members.allInvited')}
      </div>
    )
  }

  return (
    // Rendered inside an anchored popover, which supplies the padding and framing.
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
        {t('members.invitePlayer')}
      </div>

      {/* A search box only earns its space once the list is long enough to scroll. */}
      {uninvited.length > 5 && (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('members.searchUsers')}
          style={{ marginBottom: 8, fontSize: 13, padding: '5px 8px' }}
        />
      )}

      {/* ~10 rows at 33px each, and never more than the viewport can show. */}
      <div style={{ maxHeight: 'min(330px, 60vh)', overflowY: 'auto' }}>
        {matches.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '4px 0' }}>
            {t('members.noMatchingUsers')}
          </div>
        ) : (
          matches.map((u) => (
            <div
              key={u.id}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}
            >
              <span style={{ flex: 1, fontSize: 14, minWidth: 0 }}>
                {u.display_name || u.username}
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>
                  {u.role}
                </span>
                {u.campaign_access === false && (
                  <span style={{ fontSize: 12, color: 'var(--danger)', marginLeft: 6 }}>
                    {t('campaigns.memberAccessDisabled')}
                  </span>
                )}
              </span>
              <button
                onClick={() => invite(u.id)}
                disabled={loading || u.campaign_access === false}
                title={u.campaign_access === false ? t('campaigns.accessDisabledHint') : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '4px 10px',
                  background: 'var(--bg-deep)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: 'var(--text-dim)',
                  cursor: u.campaign_access === false ? 'not-allowed' : 'pointer',
                  opacity: u.campaign_access === false ? 0.5 : 1,
                  fontSize: 12,
                  flexShrink: 0,
                }}
              >
                <LuUserPlus size={12} /> {t('members.invite')}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
