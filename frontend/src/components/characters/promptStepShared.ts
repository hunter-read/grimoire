import type { CSSProperties } from 'react'
import type { ExprContext } from './expressions'
import type { EntryAnswer, PromptDocument, PromptStep } from './sheetPrompts'

type Values = Record<string, unknown>

/** Reads the catalog for an `entry` or `entries` step: one page of one content type. */
export type BrowseEntries = (
  contentType: string,
  filters: Record<string, string | number>,
  page: number,
  pageSize: number
) => Promise<{
  entries?: { entry_id: string; source?: string; name?: string; data?: unknown }[]
  total?: number
}>

/** What each step's control of a prompt is handed. */
export interface StepControlProps {
  step: PromptStep
  value: unknown
  context: ExprContext
  document: PromptDocument | null | undefined
  data: Values | null | undefined
  // A catalog step's entries, its `filter` worked out for the answers as they
  // stand; undefined while the catalog is read. `failed` says why it could not be.
  options?: EntryAnswer[]
  failed?: string
  onAnswer: (value: unknown) => void
}

export const optionLabel = (disabled: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: disabled ? 'var(--text-muted)' : 'var(--text)',
  cursor: disabled ? 'default' : 'pointer',
})

export const optionList: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'grid',
  gap: 6,
}
