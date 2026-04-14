import { useState, useEffect, useRef } from 'react'
import { LuX, LuDownload } from 'react-icons/lu'
import { mediaUrl } from '../api'

const FORMATS = [
  {
    id: 'zip',
    label: 'ZIP',
    ext: '.zip',
    description: 'Compatible with all platforms. Best for sharing.',
  },
  {
    id: 'tar',
    label: 'TAR',
    ext: '.tar',
    description: 'Uncompressed archive. Preserves Unix permissions.',
  },
  {
    id: 'tar.gz',
    label: 'TAR.GZ',
    ext: '.tar.gz',
    description: 'Gzip-compressed tar. Standard on Linux / macOS.',
  },
  {
    id: 'tar.bz2',
    label: 'TAR.BZ2',
    ext: '.tar.bz2',
    description: 'Bzip2-compressed tar. Slightly better compression than gzip.',
  },
]

export default function DownloadArchiveModal({ title, params, onClose }) {
  const [fmt, setFmt] = useState('zip')
  const firstRef = useRef(null)

  useEffect(() => {
    firstRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const downloadUrl = mediaUrl('/downloads/archive', { ...params, fmt })

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = ''
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dl-modal-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg-panel)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 24, width: 360, maxWidth: '92vw',
        boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span id="dl-modal-title" style={{ fontSize: 15, fontWeight: 600 }}>
            Download Archive
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 2 }}
            aria-label="Close"
          >
            <LuX size={16} />
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
          {title}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {FORMATS.map((f, i) => {
            const selected = fmt === f.id
            return (
              <label
                key={f.id}
                ref={i === 0 ? firstRef : null}
                tabIndex={0}
                onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') setFmt(f.id) }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${selected ? 'var(--gold-dim)' : 'var(--border)'}`,
                  background: selected ? 'rgba(201,168,76,0.07)' : 'var(--bg-card)',
                  userSelect: 'none',
                }}
              >
                <input
                  type="radio"
                  name="archive-fmt"
                  value={f.id}
                  checked={selected}
                  onChange={() => setFmt(f.id)}
                  style={{ marginTop: 2, accentColor: 'var(--gold)', flexShrink: 0 }}
                />
                <div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: selected ? 'var(--gold)' : 'var(--text)', fontFamily: 'monospace' }}>
                    {f.label}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>
                    {f.ext}
                  </span>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                    {f.description}
                  </div>
                </div>
              </label>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '7px 16px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-dim)', fontSize: 14, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleDownload}
            style={{ padding: '7px 18px', borderRadius: 6, background: 'var(--gold-dim)', border: 'none', color: 'var(--bg-deep)', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <LuDownload size={14} /> Download
          </button>
        </div>
      </div>
    </div>
  )
}
