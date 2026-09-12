import { useTranslation } from 'react-i18next'

/**
 * The enlarged look at a frame, shown while the pointer rests on its tile.
 *
 * A picker tile is 52px, which is enough to tell a circle from a square but not
 * enough to judge a frame — the thing that decides between two ornate borders is
 * the detail in the border, and at tile size that detail is a few grey pixels.
 * Rather than make the tiles bigger (a library of several hundred frames then
 * scrolls forever), the tile stays small and hovering shows the frame at a size
 * you can actually read.
 *
 * It is positioned as a fixed overlay beside the tile rather than inside the
 * scroller, so it is never clipped by the frame list's own `overflow` and never
 * reflows the gallery under the pointer.
 */
export default function FramePreview({ frame, url, anchor, size = 176 }) {
  const { t } = useTranslation()
  if (!frame || !anchor) return null

  // Prefer the right of the tile; flip to the left when there is no room, so a
  // frame in the rightmost column of the gallery still shows its preview.
  const gap = 10
  const fitsRight = anchor.right + gap + size <= window.innerWidth
  const left = fitsRight ? anchor.right + gap : anchor.left - gap - size
  // Vertically centred on the tile, then clamped into the viewport so a frame
  // at the very top or bottom of the list is not half off-screen.
  const top = Math.min(
    Math.max(gap, anchor.top + anchor.height / 2 - size / 2),
    Math.max(gap, window.innerHeight - size - gap)
  )

  return (
    <div
      // Purely a magnifier for what the pointer is already on: the tile itself
      // carries the accessible name, and a hover-only element is unreachable by
      // keyboard or screen reader anyway, so announcing it twice helps nobody.
      aria-hidden="true"
      data-testid="frame-preview"
      style={{
        position: 'fixed',
        left,
        top,
        width: size,
        height: size,
        zIndex: 60,
        pointerEvents: 'none',
        borderRadius: 8,
        border: '1px solid var(--border)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
        backgroundColor: 'var(--bg-deep)',
        // The same checkerboard the tiles use, at twice the pitch: a frame's
        // middle is transparent, and against a flat panel an unfilled centre
        // reads as a white disc rather than a hole.
        backgroundImage:
          'linear-gradient(45deg, var(--bg-card) 25%, transparent 25%),' +
          'linear-gradient(-45deg, var(--bg-card) 25%, transparent 25%),' +
          'linear-gradient(45deg, transparent 75%, var(--bg-card) 75%),' +
          'linear-gradient(-45deg, transparent 75%, var(--bg-card) 75%)',
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <img
        src={url}
        alt=""
        style={{ flex: 1, minHeight: 0, width: '100%', objectFit: 'contain', padding: 8 }}
      />
      <span
        style={{
          padding: '4px 8px 6px',
          fontSize: 11,
          lineHeight: 1.3,
          textAlign: 'center',
          color: 'var(--text)',
          background: 'var(--bg-card)',
          borderTop: '1px solid var(--border)',
          borderRadius: '0 0 7px 7px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {frame.label || t('tokenEditor.frame')}
      </span>
    </div>
  )
}
