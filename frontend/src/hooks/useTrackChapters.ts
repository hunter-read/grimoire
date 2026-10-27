import { useEffect, useState } from 'react'
import type { Translate } from '../i18n'
import api, { type Schema } from '../api'

export type TrackChapter = Schema<'AudioChapterOut'>

// Chapters are fixed by the file, so each track's list is fetched once per page
// load and reused when the queue comes back round to it.
const cache = new Map<string, TrackChapter[]>()

const EMPTY: TrackChapter[] = []

/**
 * The chapter markers embedded in an audio track - audiobooks (.m4b) mostly -
 * as `[{ start, title }]` ordered by start in seconds (issue #564). Empty while
 * loading, for a track without chapters, or when the request fails.
 */
export default function useTrackChapters(trackId: string | null | undefined): TrackChapter[] {
  // The cache holds the data; this only re-renders once a fetch lands.
  const [, setFetched] = useState(0)

  useEffect(() => {
    if (!trackId || cache.has(trackId)) return
    let cancelled = false
    api
      .get(`/audio/${trackId}/chapters`)
      .then((raw) => {
        const r = raw as Partial<Schema<'AudioChaptersResponse'>> | null | undefined
        cache.set(trackId, Array.isArray(r?.chapters) ? r.chapters : EMPTY)
        if (!cancelled) setFetched((n) => n + 1)
      })
      // Not cached, so the next time the track loads it asks again.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [trackId])

  return (trackId && cache.get(trackId)) || EMPTY
}

/** Index of the chapter playing at `time` seconds, or -1 before the first. */
export function chapterIndexAt(chapters: readonly TrackChapter[], time: number): number {
  let index = -1
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].start <= time) index = i
    else break
  }
  return index
}

/** A chapter's title, or its 1-based number when the file names none. */
export function chapterLabel(
  t: Translate,
  chapters: readonly TrackChapter[],
  index: number
): string {
  return chapters[index]?.title || t('audio.player.chapterNumber', { n: index + 1 })
}

// Tests share module state across cases; this resets the per-track cache.
export function _clearChapterCache(): void {
  cache.clear()
}
