import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuUpload, LuLibrary, LuClipboardPaste, LuTrash2 } from 'react-icons/lu'
import ImageSourceBrowser from './ImageSourceBrowser'
import useClipboardImage, { ACCEPTED_IMAGE_TYPES, imageFromDataTransfer } from './useClipboardImage'

const ACCEPT = ACCEPTED_IMAGE_TYPES.join(',')

/**
 * Shared "set an image" dialog: upload from the device, paste from the
 * clipboard, or choose one Grimoire already holds (issue #286).
 *
 * One component drives the campaign banner, system covers, and audio covers, so
 * the three stay consistent and the browse UI exists once. The caller supplies
 * the handlers and decides what the preview looks like:
 *
 *   onUpload(file)                     – device upload or clipboard paste
 *   onPickSource({source_type, source_id}) – an image already on the server
 *   onRemove()                         – optional; omit to hide the remove button
 *   renderPreview({ src, file })       – optional; a plain preview is used otherwise
 *   campaignImages                     – optional campaign-scoped images to lead with
 *
 * A paste anywhere in the document lands here while the dialog is open, which
 * is how people actually paste into a dialog (nothing paste-able is focused),
 * and dropping a file on the panel does the same thing.
 */
export default function ImagePickerModal({
  title,
  hasImage,
  previewSrc,
  aspectRatio = '2 / 1',
  helpText,
  formatsText,
  campaignImages = null,
  onUpload,
  onPickSource,
  onRemove,
  onClose,
  renderPreview,
  busy = false,
}) {
  const { t } = useTranslation()
  const inputRef = useRef(null)
  const [mode, setMode] = useState('upload')
  const [localBusy, setLocalBusy] = useState(false)
  const [error, setError] = useState('')
  // A staged device/clipboard file, previewed before it is committed.
  const [pending, setPending] = useState(null)
  const [pendingUrl, setPendingUrl] = useState(null)
  const [picked, setPicked] = useState(null)
  const [dragging, setDragging] = useState(false)

  const working = busy || localBusy

  // Object URLs are a real allocation; release the previous one whenever the
  // staged file changes and the last one on unmount.
  useEffect(() => {
    if (!pending) {
      setPendingUrl(null)
      return undefined
    }
    const url = URL.createObjectURL(pending)
    setPendingUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pending])

  const stageFile = useCallback((file) => {
    setError('')
    setPicked(null)
    setPending(file)
    setMode('upload')
  }, [])

  // Paste is only claimed while the dialog is idle — during a save the staged
  // image is already on its way and swapping it underneath would be confusing.
  useClipboardImage(stageFile, !working)

  const onFileInput = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) stageFile(file)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const file = imageFromDataTransfer(e.dataTransfer)
    if (file) stageFile(file)
  }

  const confirm = async () => {
    if (working) return
    if (!pending && !picked) return
    setLocalBusy(true)
    setError('')
    try {
      if (pending) await onUpload(pending)
      else await onPickSource({ source_type: picked.source_type, source_id: picked.source_id })
      onClose()
    } catch (err) {
      setError(err?.message || t('imagePicker.failed'))
      setLocalBusy(false)
    }
  }

  const remove = async () => {
    setLocalBusy(true)
    setError('')
    try {
      await onRemove()
      onClose()
    } catch (err) {
      setError(err?.message || t('imagePicker.failed'))
      setLocalBusy(false)
    }
  }

  // What the preview shows, in priority order: a staged file, a browsed pick,
  // then whatever is already set.
  const shownSrc = pendingUrl || picked?.preview || previewSrc || null
  const canConfirm = Boolean(pending || picked) && !working

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--scrim-strong)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        data-testid="image-picker-panel"
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          background: 'var(--bg-panel)',
          border: `1px solid ${dragging ? 'var(--gold)' : 'var(--border)'}`,
          borderRadius: 16,
          padding: 24,
          width: '100%',
          maxWidth: 560,
          maxHeight: '90vh',
          overflowY: 'auto',
          position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
          }}
        >
          <LuX size={18} />
        </button>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px' }}>{title}</h3>

        {/* Preview. The caller may render its own (the banner shows a live
            reposition control here) but always gets a sensible default. */}
        {renderPreview ? (
          renderPreview({ src: shownSrc, file: pending })
        ) : shownSrc ? (
          <div
            style={{
              width: '100%',
              aspectRatio,
              borderRadius: 10,
              overflow: 'hidden',
              background: 'var(--bg-deep)',
              border: '1px solid var(--border)',
              marginBottom: 16,
            }}
          >
            <img
              src={shownSrc}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {['upload', 'browse'].map((m) => {
            const active = mode === m
            const Icon = m === 'upload' ? LuUpload : LuLibrary
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={active}
                style={{
                  flex: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: 'pointer',
                  background: active ? 'var(--bg-card)' : 'transparent',
                  border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
                  color: active ? 'var(--text)' : 'var(--text-dim)',
                }}
              >
                <Icon size={13} /> {t(`imagePicker.mode.${m}`)}
              </button>
            )
          })}
        </div>

        {mode === 'upload' ? (
          <div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={working}
              style={{
                width: '100%',
                padding: '18px 12px',
                borderRadius: 10,
                border: '1px dashed var(--border)',
                background: 'var(--bg-deep)',
                color: 'var(--text-dim)',
                fontSize: 13,
                cursor: working ? 'default' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <LuUpload size={18} style={{ opacity: 0.6 }} />
              {pending ? pending.name : t('imagePicker.chooseFile')}
            </button>
            <p
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                fontSize: 12,
                color: 'var(--text-muted)',
                margin: '10px 0 0',
              }}
            >
              <LuClipboardPaste size={12} /> {t('imagePicker.pasteHint')}
            </p>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              onChange={onFileInput}
              style={{ display: 'none' }}
              data-testid="image-picker-input"
            />
          </div>
        ) : (
          <ImageSourceBrowser
            campaignImages={campaignImages}
            value={picked}
            onChange={(v) => {
              setPending(null)
              setPicked(v)
              setError('')
            }}
          />
        )}

        {helpText && (
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-dim)',
              margin: '14px 0 4px',
              lineHeight: 1.6,
            }}
          >
            {helpText}
          </p>
        )}
        {formatsText && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 4px' }}>
            {formatsText}
          </p>
        )}

        {error && (
          <div style={{ fontSize: 13, color: 'var(--danger)', marginTop: 10 }} role="alert">
            {error}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            marginTop: 18,
            flexWrap: 'wrap',
          }}
        >
          {hasImage && onRemove && (
            <button onClick={remove} disabled={working} style={dangerBtn}>
              <LuTrash2 size={14} /> {t('imagePicker.remove')}
            </button>
          )}
          <button onClick={onClose} disabled={working} style={cancelBtn}>
            {t('common.cancel')}
          </button>
          <button
            onClick={confirm}
            disabled={!canConfirm}
            style={{ ...goldBtn, opacity: canConfirm ? 1 : 0.5 }}
          >
            {working ? t('imagePicker.saving') : t('imagePicker.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

const goldBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 16px',
  background: 'var(--gold)',
  border: 'none',
  borderRadius: 8,
  color: 'var(--on-accent)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}
const cancelBtn = {
  padding: '9px 16px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  fontSize: 13,
}
const dangerBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 16px',
  background: 'var(--bg-card)',
  border: '1px solid var(--danger)',
  borderRadius: 8,
  color: 'var(--danger)',
  cursor: 'pointer',
  fontSize: 13,
  marginRight: 'auto',
}
