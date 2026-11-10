import { useEffect, useState } from 'react'
import { campaigns, type Schema } from '../../api'

type Title = Schema<'WikiPageTitleOut'>

/** The campaign's note titles: for picking a note to pin, and for its links. */
export default function useWikiTitles(campaignId: string): Title[] {
  const [titles, setTitles] = useState<Title[]>([])
  useEffect(() => {
    let cancelled = false
    campaigns
      .wikiTitles(campaignId)
      .then((rows) => {
        if (!cancelled) setTitles(rows)
      })
      .catch(() => {
        if (!cancelled) setTitles([])
      })
    return () => {
      cancelled = true
    }
  }, [campaignId])
  return titles
}
