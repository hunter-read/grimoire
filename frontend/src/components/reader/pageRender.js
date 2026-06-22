// Shared page-rendering constants and animation helper for the reader's page
// components (SinglePage / SpreadPage) and ReaderView's image preloader.

// Must match across visible images and preloader so browser cache hits.
export const PAGE_WIDTH = 1600
export const SPREAD_WIDTH = 1000

/** Page-turn entrance animation + zoom/pan transform for a page container. */
export function animStyle(axisRef, directionRef, zoom, pan) {
  const axis = axisRef.current
  const dir = directionRef.current
  return {
    animation: `${
      axis === 'y'
        ? dir >= 0
          ? 'pageEnterBottom'
          : 'pageEnterTop'
        : dir >= 0
          ? 'pageEnterRight'
          : 'pageEnterLeft'
    } 0.25s cubic-bezier(0.22,1,0.36,1)`,
    transform: zoom !== 1 ? `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)` : undefined,
    transformOrigin: 'center center',
  }
}
