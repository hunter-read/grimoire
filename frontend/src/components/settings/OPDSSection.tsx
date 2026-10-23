import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck, LuCopy } from 'react-icons/lu'
import { opds, type Schema } from '../../api'
import Spinner from '../Spinner'

type Status = Schema<'OpdsStatusResponse'>

export default function OPDSSection() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<Status | null>(null) // null = loading
  const [working, setWorking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // Which feed version's URL is shown. The newest is the default; v1 stays on
  // offer for readers already subscribed to it (issue #673).
  const [version, setVersion] = useState<string | null>(null)

  const feeds = status?.feed_urls ?? []
  const selected = feeds.find((f) => f.version === version) ?? feeds[0]
  const feedUrl = selected?.url ?? status?.feed_url ?? ''

  useEffect(() => {
    opds
      .getStatus()
      .then(setStatus)
      .catch(() => setStatus({ opds_enabled: false }))
  }, [])

  const handleGenerate = async () => {
    setWorking(true)
    try {
      const next = await opds.generateToken()
      setStatus(next)
      setConfirming(false)
    } finally {
      setWorking(false)
    }
  }

  const handleRevoke = async () => {
    setWorking(true)
    try {
      const next = await opds.revokeToken()
      setStatus(next)
      setConfirming(false)
    } finally {
      setWorking(false)
    }
  }

  const handleCopy = () => {
    if (feedUrl) {
      navigator.clipboard.writeText(feedUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // OPDS disabled server-side — hide the section entirely
  if (status && !status.opds_enabled) return null

  return (
    <>
      <div style={{ borderTop: '1px solid var(--border)' }} />
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
          {t('userSettings.opds.title')}
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
          {t('userSettings.opds.description')}
        </p>

        {status === null ? (
          <Spinner size={16} />
        ) : !status.has_token ? (
          <button
            onClick={handleGenerate}
            disabled={working}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 18px',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              background: 'var(--gold-dim)',
              border: 'none',
              color: 'var(--bg-deep)',
              cursor: working ? 'default' : 'pointer',
              opacity: working ? 0.6 : 1,
            }}
          >
            {working && <Spinner size={13} />}
            {working ? t('userSettings.opds.generating') : t('userSettings.opds.enable')}
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {feeds.length > 1 && (
              <div>
                <label
                  htmlFor="opds-feed-version"
                  style={{
                    display: 'block',
                    fontSize: 13,
                    color: 'var(--text-dim)',
                    marginBottom: 5,
                  }}
                >
                  {t('userSettings.opds.version')}
                </label>
                <select
                  id="opds-feed-version"
                  value={selected?.version}
                  onChange={(e) => setVersion(e.target.value)}
                  style={{
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: 13,
                  }}
                >
                  {feeds.map((f) => (
                    <option key={f.version} value={f.version}>
                      {t(`userSettings.opds.versions.${f.version}`, { defaultValue: f.version })}
                    </option>
                  ))}
                </select>
                <p
                  style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}
                >
                  {t(`userSettings.opds.versionHints.${selected?.version}`, { defaultValue: '' })}
                </p>
              </div>
            )}

            {/* Feed URL display */}
            <div>
              <label
                htmlFor="opds-feed-url"
                style={{
                  display: 'block',
                  fontSize: 13,
                  color: 'var(--text-dim)',
                  marginBottom: 5,
                }}
              >
                {t('userSettings.opds.feedUrl')}
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  id="opds-feed-url"
                  readOnly
                  value={feedUrl}
                  style={{
                    flex: 1,
                    minWidth: 200,
                    fontSize: 13,
                    padding: '7px 10px',
                    boxSizing: 'border-box',
                    color: 'var(--text-dim)',
                  }}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  onClick={handleCopy}
                  title={t('userSettings.opds.copy')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 12px',
                    borderRadius: 6,
                    fontSize: 13,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    color: copied ? 'var(--green)' : 'var(--text-dim)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {copied ? (
                    <>
                      <LuCircleCheck size={14} /> {t('userSettings.opds.copied')}
                    </>
                  ) : (
                    <>
                      <LuCopy size={14} /> {t('userSettings.opds.copy')}
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Actions */}
            {!confirming ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={handleGenerate}
                  disabled={working}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 14px',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 500,
                    background: 'var(--gold-dim)',
                    border: 'none',
                    color: 'var(--bg-deep)',
                    cursor: working ? 'default' : 'pointer',
                    opacity: working ? 0.6 : 1,
                  }}
                >
                  {working && <Spinner size={12} />}
                  {t('userSettings.opds.regenerate')}
                </button>
                <button
                  onClick={() => setConfirming(true)}
                  disabled={working}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 6,
                    fontSize: 13,
                    background: 'rgba(180,60,60,0.12)',
                    border: '1px solid rgba(180,60,60,0.4)',
                    color: 'var(--danger)',
                    cursor: 'pointer',
                  }}
                >
                  {t('userSettings.opds.disable')}
                </button>
              </div>
            ) : (
              <div
                style={{
                  padding: '14px 16px',
                  borderRadius: 8,
                  background: 'rgba(180,60,60,0.08)',
                  border: '1px solid rgba(180,60,60,0.4)',
                  maxWidth: 420,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>
                  {t('userSettings.opds.confirmRevoke')}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={handleRevoke}
                    disabled={working}
                    style={{
                      padding: '7px 14px',
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 500,
                      background: 'var(--danger-fill)',
                      border: 'none',
                      color: 'var(--on-danger)',
                      cursor: working ? 'default' : 'pointer',
                      opacity: working ? 0.6 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {working && <Spinner size={12} />}
                    {t('userSettings.opds.confirmDisable')}
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    disabled={working}
                    style={{
                      padding: '7px 14px',
                      borderRadius: 6,
                      fontSize: 13,
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-dim)',
                      cursor: 'pointer',
                    }}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
