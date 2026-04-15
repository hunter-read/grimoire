import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuUserPlus, LuUserMinus, LuCheck, LuX, LuUser, LuPencil } from 'react-icons/lu'
import { campaigns } from '../../api'
import Spinner from '../Spinner'

const STATUS_COLORS = { accepted: 'var(--success, #4caf50)', invited: 'var(--gold)', declined: 'var(--danger)' }

const smallBtn = (color) => ({
  background: 'var(--bg-deep)', border: `1px solid var(--border)`, borderRadius: 6,
  color, padding: '5px', cursor: 'pointer', display: 'flex', alignItems: 'center',
})

export function MemberRow({ member, isOwner, canManage, onRemove, onUpdateStatus, onSetCharacterName, currentUserId }) {
  const { t } = useTranslation()
  const isCurrentUser = member.user_id === currentUserId
  const isMemberOwner = member.is_owner === true
  const [editingChar, setEditingChar] = useState(false)
  const [charValue, setCharValue] = useState(member.character_name ?? '')

  const displayLabel = member.display_name || member.username

  const saveCharName = async () => {
    await onSetCharacterName(member.user_id, charValue.trim())
    setEditingChar(false)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-deep)',
        border: `1px solid ${isMemberOwner ? 'var(--gold-dim)' : 'var(--border)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, fontSize: 13, fontWeight: 600,
        color: isMemberOwner ? 'var(--gold)' : 'var(--text-dim)',
      }}>
        {displayLabel?.[0]?.toUpperCase() ?? '?'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Character name — primary */}
        {isMemberOwner ? (
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--gold)', fontFamily: 'Cinzel, serif' }}>
            {member.character_name}
          </div>
        ) : editingChar ? (
          <div style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
            <input
              value={charValue}
              onChange={e => setCharValue(e.target.value)}
              placeholder={t('members.characterNamePlaceholder')}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') saveCharName(); if (e.key === 'Escape') setEditingChar(false) }}
              style={{ fontSize: 14, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)', width: 180 }}
            />
            <button onClick={saveCharName} style={{ ...smallBtn('var(--gold)'), padding: '3px 8px', fontSize: 12 }}>{t('members.save')}</button>
            <button onClick={() => setEditingChar(false)} style={{ ...smallBtn('var(--text-muted)'), padding: '3px 8px', fontSize: 12 }}>{t('members.cancel')}</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {member.character_name
              ? <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', fontFamily: 'Cinzel, serif' }}>{member.character_name}</span>
              : <span style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('members.noCharacterName')}</span>
            }
            {(canManage || isCurrentUser) && (
              <button onClick={() => { setCharValue(member.character_name ?? ''); setEditingChar(true) }} aria-label={t('members.editCharacterName')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '1px 3px', display: 'flex' }}>
                <LuPencil size={10} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        {/* Username — secondary */}
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
          <LuUser size={11} />
          {displayLabel}
          {isMemberOwner && (
            <span style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 600, background: 'var(--bg-deep)', border: '1px solid var(--gold-dim)', borderRadius: 10, padding: '1px 6px', letterSpacing: '0.04em' }}>
              {t('members.gm')}
            </span>
          )}
          {isCurrentUser && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t('members.you')}</span>}
        </div>
      </div>
      {!isMemberOwner && (
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 20, flexShrink: 0,
          background: 'var(--bg-deep)', color: STATUS_COLORS[member.status] || 'var(--text-muted)',
          border: `1px solid ${STATUS_COLORS[member.status] || 'var(--border)'}`,
          textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600,
        }}>
          {member.status}
        </span>
      )}
      {isCurrentUser && member.status === 'invited' && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => onUpdateStatus(member.user_id, 'accepted')} aria-label={t('campaigns.accept')} style={smallBtn('#4caf50')}><LuCheck size={13} aria-hidden="true" /></button>
          <button onClick={() => onUpdateStatus(member.user_id, 'declined')} aria-label={t('campaigns.decline')} style={smallBtn('var(--danger)')}><LuX size={13} aria-hidden="true" /></button>
        </div>
      )}
      {canManage && !isCurrentUser && !isMemberOwner && (
        <button onClick={() => onRemove(member.user_id)} aria-label={`Remove ${displayLabel}`} style={smallBtn('var(--text-muted)')}>
          <LuUserMinus size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

export function InvitePanel({ campaignId, onInvited }) {
  const { t } = useTranslation()
  const [users, setUsers] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    campaigns.eligibleMembers(campaignId).then(setUsers).catch(() => setUsers([]))
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

  if (!users) return <Spinner size={16} />

  const uninvited = users.filter(u => !u.already_invited)

  if (uninvited.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>{t('members.allInvited')}</div>
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>{t('members.invitePlayer')}</div>
      {uninvited.map(u => (
        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
          <span style={{ flex: 1, fontSize: 14 }}>{u.display_name || u.username}
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>{u.role}</span>
          </span>
          <button
            onClick={() => invite(u.id)}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
              background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12,
            }}
          >
            <LuUserPlus size={12} /> {t('members.invite')}
          </button>
        </div>
      ))}
    </div>
  )
}
