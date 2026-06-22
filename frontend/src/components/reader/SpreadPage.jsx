import { mediaUrl } from '../../api'
import TextOverlay from './TextOverlay'
import { SPREAD_WIDTH, animStyle } from './pageRender'

/** Two-page spread view for the reader. */
export default function SpreadPage({
  bookId,
  currentPage,
  rightPage,
  hasRight,
  wordsCacheRef,
  getAlt,
  zoom,
  pan,
  axisRef,
  directionRef,
  activeSearchQuery,
  activeHighlight,
}) {
  return (
    <div
      key={currentPage}
      style={{
        padding: 20,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        justifyContent: 'center',
        ...animStyle(axisRef, directionRef, zoom, pan),
      }}
    >
      {[currentPage, hasRight ? rightPage : null].filter(Boolean).map((p) => {
        const wd = wordsCacheRef.current[p]
        return wd ? (
          <div
            key={p}
            style={{
              position: 'relative',
              aspectRatio: `${wd.width} / ${wd.height}`,
              maxHeight: '100%',
              maxWidth: 'calc(50% - 6px)',
              lineHeight: 0,
            }}
          >
            <img
              src={mediaUrl(`/books/${bookId}/page/${p}`, { width: SPREAD_WIDTH })}
              alt={getAlt(p)}
              draggable={false}
              style={{
                width: '100%',
                height: '100%',
                display: 'block',
                borderRadius: 4,
                boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                userSelect: 'none',
              }}
            />
            <TextOverlay
              words={wd.words}
              naturalWidth={wd.width}
              naturalHeight={wd.height}
              highlightQuery={activeSearchQuery}
              highlightText={activeHighlight}
            />
          </div>
        ) : (
          <img
            key={p}
            src={mediaUrl(`/books/${bookId}/page/${p}`, { width: SPREAD_WIDTH })}
            alt={getAlt(p)}
            style={{
              maxHeight: '100%',
              maxWidth: 'calc(50% - 6px)',
              width: 'auto',
              display: 'block',
              borderRadius: 4,
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            }}
          />
        )
      })}
    </div>
  )
}
