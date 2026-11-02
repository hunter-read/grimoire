import { useEffect } from 'react'

export const APP_TITLE = 'Grimoire'

/**
 * Name the browser tab after the page: "Dungeon World - Grimoire".
 *
 * The title is the first thing a screen reader says about a page, and what
 * RouteAnnouncer reads out after an in-app navigation, so a view sets it once
 * it knows what it is showing. Pass null while that is still loading. On
 * unmount the plain app name comes back, so a page that sets no title of its
 * own never inherits the last one's.
 */
export default function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return undefined
    document.title = `${title} - ${APP_TITLE}`
    return () => {
      document.title = APP_TITLE
    }
  }, [title])
}
