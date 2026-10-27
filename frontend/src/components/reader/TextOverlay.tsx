// Renders an invisible but selectable text layer over a rasterized page image.
// Word positions come from the backend /words endpoint (PDF point coordinates).
// Span positions are percentage-based so the overlay works at any rendered size
// without needing JavaScript dimension tracking.
//
// Props:
//   words          — [{x0, y0, x1, y1, text}] in PDF point space
//   naturalWidth   — PDF page width in points
//   naturalHeight  — PDF page height in points
//   highlightQuery — search terms to highlight in gold
//   highlightText  — bookmark text to highlight in teal

function parseTerms(str) {
  if (!str) return []
  return str
    .replace(/["*]/g, '')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !['and', 'or', 'not'].includes(t.toLowerCase()))
}

export default function TextOverlay({
  words,
  naturalWidth,
  naturalHeight,
  highlightQuery,
  highlightText,
}) {
  if (!words.length || !naturalWidth) return null

  const searchTerms = parseTerms(highlightQuery)
  const bookmarkTerms = parseTerms(highlightText)

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        containerType: 'size',
      }}
    >
      {words.map((w, i) => {
        const wl = w.text.toLowerCase()
        const isSearch =
          searchTerms.length > 0 && searchTerms.some((t) => wl.includes(t.toLowerCase()))
        const isBookmark =
          bookmarkTerms.length > 0 && bookmarkTerms.some((t) => wl.includes(t.toLowerCase()))
        const bg = isSearch
          ? 'rgba(201,168,76,0.4)'
          : isBookmark
            ? 'rgba(76,168,154,0.4)'
            : undefined
        return (
          <span
            key={i}
            data-selectable="true"
            style={{
              position: 'absolute',
              left: `${(w.x0 / naturalWidth) * 100}%`,
              top: `${(w.y0 / naturalHeight) * 100}%`,
              width: `${((w.x1 - w.x0) / naturalWidth) * 100}%`,
              height: `${((w.y1 - w.y0) / naturalHeight) * 100}%`,
              fontSize: `${((w.y1 - w.y0) / naturalHeight) * 70}cqh`,
              lineHeight: 1,
              overflow: 'hidden',
              color: 'transparent',
              backgroundColor: bg,
              borderRadius: bg ? 2 : undefined,
              whiteSpace: 'pre',
              cursor: 'text',
              pointerEvents: 'auto',
              userSelect: 'text',
              WebkitUserSelect: 'text',
            }}
          >
            {w.text}{' '}
          </span>
        )
      })}
    </div>
  )
}
