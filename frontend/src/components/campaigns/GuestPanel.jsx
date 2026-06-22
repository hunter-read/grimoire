import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuUserPlus, LuRefreshCw, LuTrash2, LuShare2, LuCopy, LuMail } from 'react-icons/lu'
import { campaigns } from '../../api'
import Spinner from '../Spinner'

/** GM-only management of a campaign's code-based guests. */
export default function GuestPanel({ campaignId, onChanged }) {
  const { t } = useTranslation()
  const [guests, setGuests] = useState(null)
  const [nickname, setNickname] = useState('')
  const [busy, setBusy] = useState(false)
  const [share, setShare] = useState(null) // { ...template } for the share modal
  const [copied, setCopied] = useState('')

  const reload = () =>
    campaigns
      .listGuests(campaignId)
      .then(setGuests)
      .catch(() => setGuests([]))

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId])

  const create = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await campaigns.createGuest(campaignId, nickname.trim())
      setNickname('')
      await reload()
      onChanged?.()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  const regenerate = async (memberId) => {
    setBusy(true)
    try {
      await campaigns.regenerateGuestCode(campaignId, memberId)
      await reload()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (memberId) => {
    if (!window.confirm(t('guests.confirmRemove'))) return
    setBusy(true)
    try {
      await campaigns.removeGuest(campaignId, memberId)
      await reload()
      onChanged?.()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  const openShare = async (memberId) => {
    try {
      const tpl = await campaigns.guestShareTemplate(campaignId, memberId)
      setShare(tpl)
    } catch (err) {
      alert(err.message)
    }
  }

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  if (!guests) return <Spinner size={16} />

  return (
    <div style={{ marginTop: 12 }}>
      <form onSubmit={create} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder={t('guests.nicknamePlaceholder')}
          maxLength={100}
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          disabled={busy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '6px 12px',
            background: 'var(--bg-deep)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-dim)',
            cursor: busy ? 'default' : 'pointer',
            fontSize: 12,
          }}
        >
          <LuUserPlus size={12} /> {t('guests.add')}
        </button>
      </form>

      {guests.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', paddingBottom: 4 }}>
          {t('guests.none')}
        </div>
      ) : (
        guests.map((g) => (
          <div
            key={g.id}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}
          >
            <span style={{ flex: 1, fontSize: 14, minWidth: 0 }}>
              {g.nickname || t('guests.guest')}
              <code
                style={{
                  marginLeft: 8,
                  fontSize: 12,
                  color: 'var(--gold)',
                  letterSpacing: '0.1em',
                }}
              >
                {g.guest_code}
              </code>
            </span>
            <IconBtn title={t('guests.share')} onClick={() => openShare(g.id)}>
              <LuShare2 size={13} />
            </IconBtn>
            <IconBtn
              title={t('guests.regenerate')}
              onClick={() => regenerate(g.id)}
              disabled={busy}
            >
              <LuRefreshCw size={13} />
            </IconBtn>
            <IconBtn title={t('guests.remove')} onClick={() => remove(g.id)} disabled={busy}>
              <LuTrash2 size={13} />
            </IconBtn>
          </div>
        ))
      )}

      {share && (
        <div
          onClick={() => setShare(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 24,
              maxWidth: 460,
              width: '100%',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 18 }}>
              {t('guests.shareTitle')}
            </h3>
            <textarea
              readOnly
              value={share.message}
              rows={6}
              style={{ width: '100%', resize: 'vertical', fontSize: 13, marginBottom: 12 }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <ShareBtn onClick={() => copy(share.message, 'msg')}>
                <LuCopy size={13} />{' '}
                {copied === 'msg' ? t('guests.copied') : t('guests.copyMessage')}
              </ShareBtn>
              <ShareBtn onClick={() => copy(share.discord_message, 'discord')}>
                <LuCopy size={13} />{' '}
                {copied === 'discord' ? t('guests.copied') : t('guests.copyForDiscord')}
              </ShareBtn>
              <a href={share.mailto_url} style={{ textDecoration: 'none' }}>
                <ShareBtn as="span">
                  <LuMail size={13} /> {t('guests.email')}
                </ShareBtn>
              </a>
            </div>
            <button
              onClick={() => setShare(null)}
              style={{
                marginTop: 16,
                padding: '6px 14px',
                background: 'var(--bg-deep)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text-dim)',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function IconBtn({ children, title, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: 6,
        background: 'var(--bg-deep)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        color: 'var(--text-dim)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function ShareBtn({ children, onClick, as = 'button' }) {
  const Tag = as
  return (
    <Tag
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '6px 12px',
        background: 'var(--bg-deep)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        color: 'var(--text-dim)',
        cursor: 'pointer',
        fontSize: 13,
      }}
    >
      {children}
    </Tag>
  )
}
