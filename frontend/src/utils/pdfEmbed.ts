/**
 * Whether this browser can show a PDF inside an `<iframe>` with its own viewer.
 *
 * Desktop browsers can, and the reader's PDF mode hands them the file directly.
 * Phones and tablets can't: Android's browsers have no inline viewer at all
 * (the frame shows a download button), and iOS / iPadOS Safari draws only the
 * first page as a still image. Those get the in-app pdf.js viewer instead.
 *
 * `navigator.pdfViewerEnabled` answers the question where it is honest, but
 * iOS reports `true`, so the touch platforms are named as well. iPadOS asks
 * for desktop sites by default and so calls itself a Mac: a Mac with a
 * touchscreen is an iPad.
 */
export function browserEmbedsPdf(nav: Navigator = navigator): boolean {
  if (nav.pdfViewerEnabled === false) return false
  const ua = nav.userAgent || ''
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return false
  if (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1) return false
  return true
}
