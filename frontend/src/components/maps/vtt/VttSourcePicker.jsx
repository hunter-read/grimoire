import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuImagePlus, LuUpload } from 'react-icons/lu'

import { UVTT_EXTENSIONS, isUvttName } from '../../../lib/uvtt'

// What the editor can start from. An image is a blank slate to draw walls over;
// a .uvtt already carries walls, and opening one means continuing that drawing
// rather than starting again. Videos and PDFs are deliberately absent: neither
// is a single raster to calibrate a grid against.
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/**
 * True when a dropped or chosen file is something the editor can open.
 *
 * A `.uvtt` is matched by name, not type: browsers report JSON files
 * inconsistently (often `application/json`, frequently an empty string for an
 * unknown extension), so the type is not a reliable signal for this format.
 */
export const isAcceptedSource = (file) =>
  !!file && (ACCEPTED_IMAGE_TYPES.includes(file.type) || isUvttName(file.name))

/**
 * Choosing what to edit: a map image, or a Universal VTT file.
 *
 * Deliberately not shared with the token editor's picker. That one takes images
 * only and offers a library tab, because framing a character portrait is a
 * different job from tracing a dungeon; folding both into one component would
 * mean a props matrix describing which of its tabs and formats apply where.
 */
export default function VttSourcePicker({ onFile, error }) {
  const { t } = useTranslation()
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const file = Array.from(e.dataTransfer?.files || []).find(isAcceptedSource)
    if (file) onFile(file)
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 20px', width: '100%' }}>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        data-testid="vtt-source-dropzone"
        style={{
          padding: '44px 20px',
          textAlign: 'center',
          borderRadius: 10,
          border: `1px dashed ${dragging ? 'var(--gold)' : 'var(--border)'}`,
          background: dragging ? 'var(--gold-dim)' : 'var(--bg-card)',
        }}
      >
        <LuImagePlus size={28} aria-hidden="true" style={{ color: 'var(--text-dim)' }} />
        <p style={{ fontSize: 14, color: 'var(--text)', margin: '12px 0 4px' }}>
          {t('maps.vtt.source.dropHint')}
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px' }}>
          {t('maps.vtt.source.formats')}
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            fontSize: 13,
            borderRadius: 5,
            cursor: 'pointer',
            background: 'var(--bg-panel)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
          }}
        >
          <LuUpload size={14} aria-hidden="true" />
          {t('maps.vtt.source.chooseFile')}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={[...ACCEPTED_IMAGE_TYPES, ...UVTT_EXTENSIONS].join(',')}
          data-testid="vtt-source-input"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) onFile(file)
          }}
          style={{ display: 'none' }}
        />
      </div>

      {error && (
        <p role="alert" style={{ marginTop: 14, fontSize: 13, color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      <p
        style={{
          marginTop: 18,
          fontSize: 12,
          color: 'var(--text-muted)',
          lineHeight: 1.6,
          textAlign: 'center',
        }}
      >
        {t('maps.vtt.source.privacyNote')}
      </p>
    </div>
  )
}
