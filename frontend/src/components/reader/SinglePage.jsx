import { mediaUrl } from '../../api'
import TextOverlay from './TextOverlay'
import { PAGE_WIDTH, animStyle } from './pageRender'

/**
 * Single-page view for the reader and PDF-map viewer.
 *
 * Pass `pageUrl(page, width)` to override where page images come from (defaults
 * to the book page endpoint). When `wordsCacheRef` is omitted the selectable
 * text overlay is skipped — used by maps, which render pages without text.
 *
 * `renderWidth` is the width to request the page image at; the reader raises it
 * when zoomed so text stays sharp instead of being scaled up as a bitmap.
 */
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
  pageUrl,
  renderWidth = PAGE_WIDTH,
}) {
  const urlFor = pageUrl ?? ((p, width) => mediaUrl(`/books/${bookId}/page/${p}`, { width }))
  const wd = wordsCacheRef?.current[currentPage]
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
            src={urlFor(currentPage, renderWidth)}
            alt={getAlt(currentPage)}
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              borderRadius: 4,
              boxShadow: '0 4px 20px var(--shadow)',
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
          src={urlFor(currentPage, renderWidth)}
          alt={getAlt(currentPage)}
          style={{
            maxHeight: '100%',
            maxWidth: '100%',
            width: 'auto',
            borderRadius: 4,
            boxShadow: '0 4px 20px var(--shadow)',
          }}
        />
      )}
    </div>
  )
}
