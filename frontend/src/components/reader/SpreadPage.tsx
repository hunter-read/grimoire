import { mediaUrl } from '../../api'
import JoinedSpread from './JoinedSpread'
import TextOverlay from './TextOverlay'
import { SPREAD_WIDTH, animStyle } from './pageRender'

/**
 * Two-page spread view for the reader and PDF-map viewer.
 *
 * Pass `pageUrl(page, width)` to override where page images come from (defaults
 * to the book page endpoint). When `wordsCacheRef` is omitted the selectable
 * text overlay is skipped — used by maps, which render pages without text.
 *
 * `joined` draws a two-page spread as one image, without the gap between the
 * pages (issue #588; see JoinedSpread). A page shown on its own - the cover,
 * or a last odd page - looks the same either way.
 *
 * `renderTiles(page, words)` adds the reader's zoom tiles, as on SinglePage,
 * joined or not.
 */
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
  pageUrl,
  renderWidth = SPREAD_WIDTH,
  joined = false,
  renderTiles,
}) {
  const urlFor = pageUrl ?? ((p, width) => mediaUrl(`/books/${bookId}/page/${p}`, { width }))
  const pages = [currentPage, hasRight ? rightPage : null].filter(Boolean)
  const joinPair = joined && pages.length === 2
  return (
    <div
      key={currentPage}
      style={{
        padding: 20,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        gap: joinPair ? 0 : 12,
        alignItems: 'center',
        justifyContent: 'center',
        // JoinedSpread sizes the pair from this box with container-query units.
        ...(joinPair ? { containerType: 'size' } : null),
        ...animStyle(axisRef, directionRef, zoom, pan),
      }}
    >
      {joinPair ? (
        <JoinedSpread
          pages={pages}
          urlFor={urlFor}
          renderWidth={renderWidth}
          getAlt={getAlt}
          wordsCacheRef={wordsCacheRef}
          activeSearchQuery={activeSearchQuery}
          activeHighlight={activeHighlight}
          renderTiles={renderTiles}
        />
      ) : (
        pages.map((p) => {
          const wd = wordsCacheRef?.current[p]
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
                src={urlFor(p, renderWidth)}
                data-page-image
                alt={getAlt(p)}
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
              {renderTiles?.(p, wd)}
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
              src={urlFor(p, renderWidth)}
              data-page-image
              alt={getAlt(p)}
              style={{
                maxHeight: '100%',
                maxWidth: 'calc(50% - 6px)',
                width: 'auto',
                display: 'block',
                borderRadius: 4,
                boxShadow: '0 4px 20px var(--shadow)',
              }}
            />
          )
        })
      )}
    </div>
  )
}
