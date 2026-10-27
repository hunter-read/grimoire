import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { LuChevronDown, LuPencilRuler } from 'react-icons/lu'

import { editTargets } from './editTargets'

/**
 * The detail page's entry into the Universal VTT editor.
 *
 * One target is a plain button — the overwhelmingly common case, and it should
 * not cost a menu. Two targets is a map paired with a `.uvtt`, and there the
 * choice is genuine: editing the picture authors fresh geometry over it, while
 * editing the linked file changes walls that already exist. Picking one for the
 * user would silently send half of them to the wrong document, so both are
 * named and the label says which is which.
 *
 * Renders nothing when the map has no raster to draw on (PDF, video, archive).
 */
export default function EditVttButton({ map, compact }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  const targets = editTargets(map)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (targets.length === 0) return null

  const baseStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 10px',
    fontSize: 13,
    borderRadius: 4,
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
    color: 'var(--text-dim)',
    cursor: 'pointer',
  }

  const go = (target) => {
    setOpen(false)
    navigate(`/maps/${target.id}/vtt-editor`)
  }

  if (targets.length === 1) {
    return (
      <button
        type="button"
        onClick={() => go(targets[0])}
        title={t('maps.vtt.editHint')}
        style={baseStyle}
      >
        <LuPencilRuler size={13} aria-hidden="true" />
        {!compact && t('maps.vtt.edit')}
      </button>
    )
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={t('maps.vtt.editHint')}
        style={baseStyle}
      >
        <LuPencilRuler size={13} aria-hidden="true" />
        {!compact && t('maps.vtt.edit')}
        <LuChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            zIndex: 2000,
            minWidth: 220,
            maxWidth: 360,
            padding: '4px 0',
            borderRadius: 8,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            boxShadow: '0 6px 20px var(--shadow)',
          }}
        >
          {targets.map((target) => (
            <button
              key={target.id}
              type="button"
              role="menuitem"
              onClick={() => go(target)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 12px',
                fontSize: 13,
                color: 'var(--text)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {t(`maps.vtt.target.${target.kind}`)}
              <span
                style={{
                  display: 'block',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginTop: 1,
                  overflowWrap: 'anywhere',
                }}
              >
                {t(`maps.vtt.target.${target.kind}Hint`)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
