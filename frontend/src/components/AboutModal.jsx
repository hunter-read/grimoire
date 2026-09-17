import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuX, LuExternalLink, LuBookOpen } from 'react-icons/lu'
import { SiGithub } from 'react-icons/si'
import api from '../api'
import ChangelogRelease from './ChangelogRelease'

const GITHUB_REPO_URL = 'https://github.com/hunter-read/grimoire'
const DOCS_URL = 'https://docs.grimoirecodex.org'

export default function AboutModal({ about, latestVersion, hasUpdate, onClose }) {
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

  const [releases, setReleases] = useState(null)
  // Which release bodies are expanded, keyed by version. Seeded from the fetch
  // rather than here: the running version is the one to open, and it is not
  // known to be present in the changelog until the list arrives.
  const [openVersions, setOpenVersions] = useState({})

  // Fetched when the dialog opens rather than with the rest of the app: the
  // changelog is comfortably the largest thing here and nothing outside this
  // dialog reads it. A failure leaves `releases` empty, which renders as no
  // changelog section — the version information above it is the point of the
  // dialog and still shows.
  useEffect(() => {
    let cancelled = false
    api
      .get('/changelog')
      .then((data) => {
        if (cancelled) return
        const list = data?.releases ?? []
        setReleases(list)
        const current = list.find((r) => r.version === about?.version)
        if (current) setOpenVersions({ [current.version]: true })
      })
      .catch(() => {
        if (!cancelled) setReleases([])
      })
    return () => {
      cancelled = true
    }
  }, [about?.version])

  const currentVersion = about?.version ?? '—'
  const commitHash = about?.commit_hash || null
  const pythonVersion = about?.python_version ?? '—'
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
        background: 'var(--scrim)',
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
          width: 560,
          maxWidth: '92vw',
          // Capped so a long changelog scrolls inside the dialog instead of
          // growing it past the viewport. Both limits apply: 86vh keeps it on
          // screen on a short one, and the absolute cap stops it stretching to
          // an awkward full-height slab on a tall one.
          maxHeight: 'min(840px, 86vh)',
          display: 'flex',
          flexDirection: 'column',
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
            flexShrink: 0,
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

        {/* Changelog. Absent entirely when the running image ships without a
            CHANGELOG.md, rather than showing an empty heading. */}
        {releases !== null && releases.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--text-muted)',
                marginBottom: 4,
                flexShrink: 0,
              }}
            >
              {t('about.changelog')}
            </div>
            <div
              style={{
                overflowY: 'auto',
                minHeight: 0,
                borderTop: '1px solid var(--border)',
              }}
            >
              {releases.map((release) => (
                <ChangelogRelease
                  key={release.version}
                  release={release}
                  isCurrent={release.version === currentVersion}
                  isOpen={!!openVersions[release.version]}
                  onToggle={() =>
                    setOpenVersions((prev) => ({
                      ...prev,
                      [release.version]: !prev[release.version],
                    }))
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
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
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            title={t('about.docs')}
            aria-label={t('about.docs')}
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
            <LuBookOpen size={16} />
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
