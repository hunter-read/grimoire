import type { CSSProperties } from 'react'
import type { ExprContext } from './expressions'
import type { PromptDocument, PromptStep } from './sheetPrompts'

type Values = Record<string, unknown>

/** Reads the catalog for an `entry` step: one page of one content type. */
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
  browse?: BrowseEntries
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
