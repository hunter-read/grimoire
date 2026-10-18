import { useState } from 'react'
import TextOverlay from './TextOverlay'

const SHADOW = '0 4px 20px var(--shadow)'

/**
 * Two facing pages drawn as one image, the way a printed spread looks (issue
 * #588): no gap, square inner corners, and one shadow around the pair instead
 * of one per page.
 *
 * Both pages are scaled to a shared height, so the gutter edge stays straight
 * even when the two differ slightly in size - the same way page export joins a
 * spread. Each page's width is its share of the pair's combined aspect ratio.
 * The pair is fitted to its container with container-query units, so the
 * parent must set `containerType: 'size'`.
 *
 * A page's aspect ratio comes from its word geometry when the reader has it
 * (PDF books) and otherwise from the image once it has loaded (PDF maps). Until
 * both are known the pages sit side by side at their natural size.
 */
export default function JoinedSpread({
  pages,
  urlFor,
  renderWidth,
  getAlt,
  wordsCacheRef,
  activeSearchQuery,
  activeHighlight,
}) {
  const [loaded, setLoaded] = useState({})
  const aspects = pages.map((p) => {
    const wd = wordsCacheRef?.current[p]
    if (wd?.width > 0 && wd?.height > 0) return wd.width / wd.height
    const size = loaded[p]
    return size ? size.width / size.height : null
  })
  const fitted = aspects.every(Boolean)
  const total = fitted ? aspects.reduce((sum, a) => sum + a, 0) : null

  const remember = (p) => (e) => {
    const { naturalWidth: width, naturalHeight: height } = e.currentTarget
    if (width > 0 && height > 0) setLoaded((prev) => ({ ...prev, [p]: { width, height } }))
  }

  return (
    <div
      data-joined-spread
      // The pair's combined aspect ratio, once known (also read by tests: jsdom
      // drops the aspect-ratio and min() styles it does not understand).
      data-aspect={fitted ? total.toFixed(4) : undefined}
      style={{
        display: 'flex',
        lineHeight: 0,
        borderRadius: 4,
        overflow: 'hidden',
        boxShadow: SHADOW,
        ...(fitted
          ? {
              aspectRatio: `${total}`,
              // The largest width that fits both ways: the full width, or the
              // full height times the pair's aspect ratio, whichever is smaller.
              width: `min(100cqw, calc(100cqh * ${total}))`,
            }
          : { maxWidth: '100%', maxHeight: '100%' }),
      }}
    >
      {pages.map((p, i) => {
        const wd = wordsCacheRef?.current[p]
        return (
          <div
            key={p}
            style={{
              position: 'relative',
              minWidth: 0,
              ...(fitted
                ? { flexGrow: aspects[i], flexShrink: 1, flexBasis: 0, height: '100%' }
                : { maxWidth: '50%' }),
            }}
          >
            <img
              src={urlFor(p, renderWidth)}
              alt={getAlt(p)}
              draggable={false}
              onLoad={remember(p)}
              style={{
                display: 'block',
                userSelect: 'none',
                ...(fitted
                  ? { width: '100%', height: '100%' }
                  : { maxWidth: '100%', maxHeight: '100cqh', width: 'auto' }),
              }}
            />
            {wd && (
              <TextOverlay
                words={wd.words}
                naturalWidth={wd.width}
                naturalHeight={wd.height}
                highlightQuery={activeSearchQuery}
                highlightText={activeHighlight}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
