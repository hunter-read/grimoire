import { mediaUrl } from '../../api'
import TextOverlay from './TextOverlay'
import { PAGE_WIDTH, animStyle } from './pageRender'

/** Single-page view for the reader. */
export default function SinglePage({
  bookId,
  currentPage,
  wordsCacheRef,
  getAlt,
  zoom,
  pan,
  axisRef,
  directionRef,
  activeSearchQuery,
  activeHighlight,
}) {
  const wd = wordsCacheRef.current[currentPage]
  return (
    <div
      key={currentPage}
      style={{
        padding: 20,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...animStyle(axisRef, directionRef, zoom, pan),
      }}
    >
      {wd ? (
        <div
          style={{
            position: 'relative',
            aspectRatio: `${wd.width} / ${wd.height}`,
            maxHeight: '100%',
            maxWidth: '100%',
            lineHeight: 0,
          }}
        >
          <img
            src={mediaUrl(`/books/${bookId}/page/${currentPage}`, { width: PAGE_WIDTH })}
            alt={getAlt(currentPage)}
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
          src={mediaUrl(`/books/${bookId}/page/${currentPage}`, { width: PAGE_WIDTH })}
          alt={getAlt(currentPage)}
          style={{
            maxHeight: '100%',
            maxWidth: '100%',
            width: 'auto',
            borderRadius: 4,
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}
        />
      )}
    </div>
  )
}
