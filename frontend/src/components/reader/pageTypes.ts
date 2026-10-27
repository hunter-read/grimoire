// Shapes shared by the reader's page components (SinglePage, SpreadPage,
// JoinedSpread) and the PDF-map viewer that reuses them.
import type { ReactNode } from 'react'
import type { Schema } from '../../api'

/** One page's size and word boxes, as GET /books/{id}/page/{n}/words returns them. */
export type PageWords = Schema<'PageWordsResponse'>

/** The reader's cache of page words, by page number; null for a page without any. */
export interface WordsCacheRef {
  current: Record<number, PageWords | null | undefined>
}

/** Where page `page`'s image is, rendered `width` pixels wide. */
export type PageUrlFor = (page: number, width: number) => string

/** Lays the zoom tiles over a page; `joined` when it is half of a joined spread. */
export type RenderTiles = (page: number, words: PageWords, opts?: { joined?: boolean }) => ReactNode
