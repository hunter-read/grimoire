import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuImagePlus, LuLibraryBig, LuUpload } from 'react-icons/lu'

import ImageSourceBrowser from '../../images/ImageSourceBrowser'
import useClipboardImage, { ACCEPTED_IMAGE_TYPES } from '../../images/useClipboardImage'

/**
 * Choosing the art to frame: from the device, the clipboard, a drop, or the
 * library Grimoire already holds.
 *
 * The library route hands back a `{source_type, source_id}` pair rather than
 * bytes. The editor turns that into an ordinary same-origin image URL, which is
 * what keeps the canvas untainted — see the note in `lib/tokenCompositor`.
 */
export default function TokenSourcePicker({ onFile, onPickSource, active = true }) {
  const { t } = useTranslation()
  const inputRef = useRef(null)
  const [tab, setTab] = useState('upload')
  const [dragging, setDragging] = useState(false)
  const [source, setSource] = useState(null)

  useClipboardImage(onFile, active)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const file = Array.from(e.dataTransfer?.files || []).find((f) =>
      ACCEPTED_IMAGE_TYPES.includes(f.type)
    )
    if (file) onFile(file)
  }

  const pick = (next) => {
    setSource(next)
    if (next) onPickSource(next)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {['upload', 'library'].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
            style={{
              flex: 1,
              padding: '7px 10px',
              fontSize: 12,
              borderRadius: 5,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              background: tab === value ? 'var(--gold-dim)' : 'var(--bg-card)',
              color: tab === value ? 'var(--gold)' : 'var(--text-dim)',
              border: `1px solid ${tab === value ? 'var(--gold)' : 'var(--border)'}`,
            }}
          >
            {value === 'upload' ? (
              <LuUpload size={14} aria-hidden="true" />
            ) : (
              <LuLibraryBig size={14} aria-hidden="true" />
            )}
            {t(`tokenEditor.source.${value}`)}
          </button>
        ))}
      </div>

      {tab === 'upload' ? (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          data-testid="token-source-dropzone"
          style={{
            padding: '28px 16px',
            textAlign: 'center',
            borderRadius: 8,
            border: `1px dashed ${dragging ? 'var(--gold)' : 'var(--border)'}`,
            background: dragging ? 'var(--gold-dim)' : 'var(--bg-card)',
          }}
        >
          <LuImagePlus size={22} aria-hidden="true" style={{ color: 'var(--text-dim)' }} />
          <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '8px 0 12px' }}>
            {t('tokenEditor.dropHint')}
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            style={{
              padding: '7px 14px',
              fontSize: 12,
              borderRadius: 5,
              cursor: 'pointer',
              background: 'var(--bg-panel)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
            }}
          >
            {t('tokenEditor.chooseFile')}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            data-testid="token-source-input"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) onFile(file)
            }}
            style={{ display: 'none' }}
          />
        </div>
      ) : (
        <ImageSourceBrowser value={source} onChange={pick} />
      )}
    </div>
  )
}
