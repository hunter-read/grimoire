import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LuDownload, LuExternalLink, LuLock, LuFile, LuLink2Off } from 'react-icons/lu'
import Spinner from '../components/Spinner'
import { formatSize } from '../utils'
import { formatWhen } from '../components/share/shareLinkUtils'
import type { Schema } from '../api'

type ShareMeta = Schema<'ShareMetaResponse'>
type PageStatus = 'loading' | 'ready' | 'locked' | 'missing' | 'throttled'

/** A failed request, carrying the HTTP status it failed with. */
interface HttpError extends Error {
  status?: number
}

// Plain fetch rather than the api client: this page is for people with no
// account, and the client treats a 401 as "your session expired".
async function getJson(url: string, options?: RequestInit) {
  const res = await fetch(url, { credentials: 'same-origin', ...options })
  if (!res.ok) {
    const err: HttpError = new Error(String(res.status))
    err.status = res.status
    throw err
  }
  return res.json()
}

const buttonStyle = (primary?: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 500,
  textDecoration: 'none',
  cursor: 'pointer',
  background: primary ? 'var(--gold-dim)' : 'var(--bg-card)',
  color: primary ? 'var(--bg-deep)' : 'var(--text)',
  border: `1px solid ${primary ? 'var(--gold-dim)' : 'var(--border)'}`,
})

/**
 * The public page behind a share link (issue #541): `/share/<token>`.
 *
 * No login. Shows the item - an image or video inline, an audio player, or a
 * file card - with Open and Download buttons, and asks for the password first
 * when the link has one. Every way a link can stop working (expired, revoked,
 * the item gone, sharing turned off) arrives as the same 404, and reads as the
 * same message, so the page never says which.
 */
export interface ShareViewProps {
  token: string
}

export default function ShareView({ token }: ShareViewProps) {
  const { t, i18n } = useTranslation()
  const [meta, setMeta] = useState<ShareMeta | null>(null)
  const [status, setStatus] = useState<PageStatus>('loading')
  const [password, setPassword] = useState('')
  const [unlockError, setUnlockError] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const base = `/api/share/${encodeURIComponent(token)}`

  const load = () =>
    getJson(`${base}/meta`)
      .then((data: ShareMeta) => {
        setMeta(data)
        setStatus(data.unlocked ? 'ready' : 'locked')
      })
      .catch((err: HttpError) => setStatus(err.status === 429 ? 'throttled' : 'missing'))

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    document.title = meta?.name ? `${meta.name} - Grimoire` : 'Grimoire'
  }, [meta])

  const unlock = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setUnlocking(true)
    setUnlockError('')
    try {
      await getJson(`${base}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      setPassword('')
      await load()
    } catch (err) {
      setUnlockError(
        (err as HttpError).status === 429 ? t('sharePage.throttled') : t('sharePage.wrongPassword')
      )
    } finally {
      setUnlocking(false)
    }
  }

  let body
  if (status === 'loading') {
    body = (
      <div style={{ textAlign: 'center', padding: 24 }}>
        <Spinner size={28} />
      </div>
    )
  } else if (status === 'missing' || status === 'throttled') {
    body = (
      <div style={{ textAlign: 'center' }}>
        <LuLink2Off size={32} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
        <h1 style={{ fontSize: 20, margin: '12px 0 8px' }}>{t('sharePage.missingTitle')}</h1>
        <p style={{ fontSize: 14, color: 'var(--text-dim)', margin: 0, lineHeight: 1.6 }}>
          {status === 'throttled' ? t('sharePage.throttled') : t('sharePage.missingBody')}
        </p>
      </div>
    )
  } else if (status === 'locked') {
    body = (
      <form onSubmit={unlock} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ textAlign: 'center' }}>
          <LuLock size={28} style={{ color: 'var(--gold)' }} aria-hidden="true" />
          <h1 style={{ fontSize: 20, margin: '10px 0 6px' }}>{t('sharePage.lockedTitle')}</h1>
          <p style={{ fontSize: 14, color: 'var(--text-dim)', margin: 0 }}>
            {t('sharePage.lockedBody')}
          </p>
        </div>
        <label htmlFor="share-password" style={{ fontSize: 13, fontWeight: 500 }}>
          {t('sharePage.password')}
        </label>
        <input
          id="share-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            padding: '8px 10px',
            fontSize: 14,
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg-input)',
            color: 'var(--text)',
          }}
        />
        {unlockError && (
          <p role="alert" style={{ fontSize: 13, color: 'var(--danger)', margin: 0 }}>
            {unlockError}
          </p>
        )}
        <button type="submit" disabled={!password || unlocking} style={buttonStyle(true)}>
          {t('sharePage.unlock')}
        </button>
      </form>
    )
  } else {
    // Only a loaded link reaches this branch, so the meta is there.
    const ready = meta!
    const kind = ready.media_kind
    const details = [
      t(`share.type.${ready.resource_type}`),
      ready.file_size ? formatSize(ready.file_size) : null,
      ready.expires_at
        ? t('sharePage.expires', { when: formatWhen(ready.expires_at, i18n.language) })
        : null,
    ].filter(Boolean)
    body = (
      <>
        <h1 style={{ fontSize: 20, margin: 0, overflowWrap: 'anywhere' }}>{ready.name}</h1>
        {ready.label && (
          <p style={{ fontSize: 14, color: 'var(--text-dim)', margin: '4px 0 0' }}>{ready.label}</p>
        )}
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 16px' }}>
          {details.join(' · ')}
        </p>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            background: 'var(--bg-deep)',
            borderRadius: 8,
            padding: kind === 'audio' ? 16 : 0,
            overflow: 'hidden',
          }}
        >
          {kind === 'image' && (
            <img
              src={ready.file_url ?? undefined}
              alt={ready.name ?? undefined}
              style={{ maxWidth: '100%', maxHeight: '65vh', display: 'block' }}
            />
          )}
          {kind === 'video' && (
            <video
              src={ready.file_url ?? undefined}
              controls
              style={{ maxWidth: '100%', maxHeight: '65vh', display: 'block' }}
            />
          )}
          {kind === 'audio' && (
            <audio src={ready.file_url ?? undefined} controls style={{ width: '100%' }} />
          )}
          {!['image', 'video', 'audio'].includes(kind as string) && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
              <LuFile size={40} aria-hidden="true" />
              <div style={{ fontSize: 13, marginTop: 8, overflowWrap: 'anywhere' }}>
                {ready.filename}
              </div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <a href={ready.download_url ?? undefined} download style={buttonStyle(true)}>
            <LuDownload size={14} aria-hidden="true" /> {t('sharePage.download')}
          </a>
          {['image', 'video', 'pdf'].includes(kind as string) && (
            <a
              href={ready.file_url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              style={buttonStyle()}
            >
              <LuExternalLink size={14} aria-hidden="true" /> {t('sharePage.open')}
            </a>
          )}
        </div>
      </>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-deep)',
        color: 'var(--text)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px',
        boxSizing: 'border-box',
      }}
    >
      <main
        style={{
          width:
            status === 'ready' && ['image', 'video'].includes(meta?.media_kind as string)
              ? 880
              : 440,
          maxWidth: '100%',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          boxSizing: 'border-box',
        }}
      >
        {body}
      </main>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 16 }}>
        {t('sharePage.sharedFrom')}
      </p>
    </div>
  )
}
