import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { renderPreview } from '../../../lib/tokenCompositor'
import useEditorPointer from './useEditorPointer'

/**
 * The live preview surface.
 *
 * Holds no pixel logic of its own: it owns a canvas, forwards the current spec
 * to the compositor, and wires input through `useEditorPointer`. That split is
 * what keeps this component testable under jsdom, where no 2D context exists —
 * the compositor is mocked and this file's own behaviour (does it redraw when
 * the spec changes? is the wheel listener non-passive?) is still asserted.
 */
export default function TokenEditorCanvas({ spec, actions, disabled = false }) {
  const { t } = useTranslation()
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const { isDragging, onMouseDown, onKeyDown, onDoubleClick } = useEditorPointer(
    containerRef,
    actions,
    { disabled }
  )

  // The preview is rendered at the size it is actually displayed at, in device
  // pixels, rather than at the export size. A 256px token stretched across a
  // 420px box — 840 backing pixels on a high-DPI screen — is a threefold upscale
  // and looks visibly soft while editing, even though the exported file is fine.
  const [displaySize, setDisplaySize] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    const measure = () => {
      const { width } = el.getBoundingClientRect()
      if (!width) return
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      setDisplaySize(Math.round(width * dpr))
    }
    measure()
    // ResizeObserver is absent in some test environments; the initial measure
    // above is enough there, and the layout is static anyway.
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    renderPreview(canvasRef.current, spec, displaySize)
  }, [spec, displaySize])

  const maskOutline =
    spec.mask === 'square' ? (
      <rect x="0.5" y="0.5" width="99" height="99" fill="none" />
    ) : spec.mask === 'circle' ? (
      <circle cx="50" cy="50" r="49.5" fill="none" />
    ) : null

  return (
    <div
      ref={containerRef}
      // tabIndex is not decoration: the keyboard handlers below are the only way
      // a keyboard-only user can position the art.
      tabIndex={disabled ? -1 : 0}
      role="application"
      aria-label={t('tokenEditor.canvasLabel')}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
      data-testid="token-editor-canvas"
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 420,
        aspectRatio: '1 / 1',
        borderRadius: 8,
        border: '1px solid var(--border)',
        overflow: 'hidden',
        cursor: disabled ? 'default' : isDragging ? 'grabbing' : 'grab',
        // Every gesture is handled here, so the browser must not also scroll,
        // pinch-zoom, or rubber-band the page underneath.
        touchAction: 'none',
        // A checkerboard, so transparency reads as transparent rather than as
        // whatever the panel behind happens to be.
        backgroundColor: 'var(--bg-deep)',
        backgroundImage:
          'linear-gradient(45deg, var(--bg-card) 25%, transparent 25%),' +
          'linear-gradient(-45deg, var(--bg-card) 25%, transparent 25%),' +
          'linear-gradient(45deg, transparent 75%, var(--bg-card) 75%),' +
          'linear-gradient(-45deg, transparent 75%, var(--bg-card) 75%)',
        backgroundSize: '16px 16px',
        backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
      }}
    >
      <canvas
        ref={canvasRef}
        data-testid="token-editor-preview"
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
      {maskOutline && (
        // The crop edge, shown even when no frame is selected — without it the
        // user cannot tell what will survive the mask.
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          stroke="var(--gold)"
          strokeWidth="0.4"
          strokeDasharray="2 2"
          opacity="0.55"
        >
          {maskOutline}
        </svg>
      )}
    </div>
  )
}
