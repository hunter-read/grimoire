import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCalendar, LuCopy, LuCheck, LuRefreshCw, LuTrash2, LuX } from 'react-icons/lu'
import { campaigns } from '../../api'

/**
 * The calendar subscription URL, in a modal opened from CalendarMenu.
 *
 * The URL is personal: it carries a revocable per-user token, so each member
 * copies a different link and sees their own availability reflected in the
 * events. It is deliberately never shown unless the server knows its own public
 * address (BASE_URL), because a link built from the localhost default would not
 * resolve from the calendar app that has to poll it.
 *
 * `campaign` is optional — omitted, this is the global "all my campaigns"
 * variant and only the aggregate feed is offered.
 */
export default function CalendarSubscribeDialog({ campaign, onClose }) {
  const { t } = useTranslation()
  const [sub, setSub] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    campaigns
      .getCalendarSubscription(campaign?.id)
      .then((data) => {
        if (!cancelled) setSub(data)
      })
      .catch(() => {
        if (!cancelled) setSub({ has_token: false, base_url_configured: false })
      })
    return () => {
      cancelled = true
    }
  }, [campaign?.id])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      setSub(await fn())
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (value, key) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // Clipboard unavailable (insecure origin or denied permission); the input
      // stays selectable so the user can copy by hand.
    }
  }

  const btn = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 13px',
    background: 'var(--bg-deep)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text-muted)',
    cursor: busy ? 'wait' : 'pointer',
    fontSize: 12,
  }

  const urlRow = (label, value, key) => (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          readOnly
          value={value}
          onFocus={(e) => e.target.select()}
          aria-label={label}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '7px 10px',
            background: 'var(--bg-deep)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            color: 'var(--text)',
            fontSize: 12,
            fontFamily: 'monospace',
          }}
        />
        <button onClick={() => copy(value, key)} style={btn} title={t('calendar.copy')}>
          {copied === key ? <LuCheck size={13} /> : <LuCopy size={13} />}
        </button>
      </div>
    </div>
  )

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--scrim-strong)',
        zIndex: 2100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('calendar.subscribeTitle')}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '20px 22px',
          width: 'min(560px, 100%)',
          maxHeight: '85vh',
          overflowY: 'auto',
          boxShadow: '0 10px 30px var(--shadow)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 6,
          }}
        >
          <div
            style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <LuCalendar size={15} /> {t('calendar.subscribeTitle')}
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <LuX size={16} />
          </button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
          {t('calendar.subscribeBody')}
        </div>

        {!sub ? null : !sub.base_url_configured ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('calendar.baseUrlRequired')}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                onClick={() => run(() => campaigns.generateCalendarToken(campaign?.id))}
                disabled={busy}
                style={btn}
              >
                <LuRefreshCw size={13} />
                {sub.has_token ? t('calendar.regenerate') : t('calendar.getLink')}
              </button>
              {sub.has_token && (
                <button
                  onClick={() => run(() => campaigns.revokeCalendarToken())}
                  disabled={busy}
                  style={btn}
                >
                  <LuTrash2 size={13} /> {t('calendar.revoke')}
                </button>
              )}
            </div>

            {sub.has_token && sub.feed_url && (
              <>
                {sub.campaign_feed_url &&
                  urlRow(t('calendar.campaignFeed'), sub.campaign_feed_url, 'campaign')}
                {urlRow(t('calendar.allFeed'), sub.feed_url, 'all')}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
                  {t('calendar.privateUrlWarning')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                  {t('calendar.rsvpNote')}
                </div>
              </>
            )}
          </>
        )}

        {error && (
          <div style={{ fontSize: 12, color: 'var(--danger, #e5484d)', marginTop: 12 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
