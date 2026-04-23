import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuX, LuExternalLink } from 'react-icons/lu'
import { SiGithub } from 'react-icons/si'

const GITHUB_REPO_URL = 'https://github.com/hunter-read/grimoire'

export default function AboutModal({ stats, latestVersion, hasUpdate, onClose }) {
  const { t } = useTranslation()
  const closeRef = useRef(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const currentVersion = stats?.version ?? '—'
  const commitHash = stats?.commit_hash || null
  const pythonVersion = stats?.python_version ?? '—'
  const releaseUrl = `${GITHUB_REPO_URL}/releases/tag/v${currentVersion}`

  const rowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
    marginBottom: 10,
  }
  const labelStyle = { fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }
  const valueStyle = {
    fontSize: 13,
    color: 'var(--text)',
    fontFamily: 'monospace',
    textAlign: 'right',
  }
  const dotStyle = { flex: 1, borderBottom: '1px dotted var(--border)', minWidth: 16 }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 24,
          width: 380,
          maxWidth: '92vw',
          boxSizing: 'border-box',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 4,
          }}
        >
          <span id="about-modal-title" style={{ fontSize: 15, fontWeight: 600 }}>
            {t('about.title')}
          </span>
          <button
            ref={closeRef}
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              padding: 2,
            }}
            aria-label={t('common.close')}
          >
            <LuX size={16} />
          </button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
          {t('about.subtitle')}
        </p>

        {/* Info table */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '14px 16px',
            marginBottom: 16,
          }}
        >
          <div style={rowStyle}>
            <span style={labelStyle}>{t('about.version')}</span>
            <span style={dotStyle} />
            <span style={valueStyle}>v{currentVersion}</span>
          </div>
          {commitHash && (
            <div style={rowStyle}>
              <span style={labelStyle}>{t('about.commitHash')}</span>
              <span style={dotStyle} />
              <span style={{ ...valueStyle, fontSize: 12 }}>{commitHash.slice(0, 12)}</span>
            </div>
          )}
          <div style={rowStyle}>
            <span style={labelStyle}>{t('about.pythonVersion')}</span>
            <span style={dotStyle} />
            <span style={valueStyle}>{pythonVersion}</span>
          </div>
          <div style={{ ...rowStyle, marginBottom: hasUpdate ? 10 : 0 }}>
            <span style={labelStyle}>{t('about.reactVersion')}</span>
            <span style={dotStyle} />
            <span style={valueStyle}>{__REACT_VERSION__}</span>
          </div>

          {hasUpdate && (
            <div
              style={{
                ...rowStyle,
                marginBottom: 0,
                paddingTop: 10,
                borderTop: '1px solid var(--border)',
              }}
            >
              <span style={{ ...labelStyle, color: 'var(--gold)' }}>
                {t('about.updateAvailable')}
              </span>
              <span style={dotStyle} />
              <a
                href={`${GITHUB_REPO_URL}/releases/tag/v${latestVersion}`}
                target="_blank"
                rel="noreferrer"
                style={{ ...valueStyle, color: 'var(--gold)', textDecoration: 'none' }}
              >
                v{latestVersion}
              </a>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a
            href={releaseUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              flex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              background: 'var(--gold-dim)',
              border: 'none',
              color: 'var(--bg-deep)',
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            <LuExternalLink size={13} /> {t('about.viewRelease')}
          </a>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            title={t('about.github')}
            aria-label={t('about.github')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '7px 10px',
              borderRadius: 6,
              fontSize: 13,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text-dim)',
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            <SiGithub size={16} />
          </a>
        </div>
      </div>
    </div>,
    document.body
  )
}
