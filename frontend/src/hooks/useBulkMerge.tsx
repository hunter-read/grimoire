import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { DuplicateType } from '../api'
import MergeDialog, { type MergeOutcome } from '../components/duplicates/MergeDialog'
import { useAuth } from '../context/AuthContext'

// The collections a merge can act on - the duplicates API's ResourceType.
const MERGEABLE: readonly string[] = ['book', 'map', 'token', 'audio', 'model']

// The keeper plus the server's MAX_MERGE copies merged into it.
const MAX_SELECTED = 21

export interface SelectedItem {
  type: string
  id: string
}

/**
 * Merge for a multi-selection (issue #589): the BulkActionBar props and the
 * dialog, for any view that can select library items.
 *
 * Admin-only, as the duplicates API is; for anyone else `barProps` is empty
 * and the bar shows no Merge button at all. Enabled for two or more items of
 * one collection - a map is never a copy of a book - with a hint saying which
 * rule a disabled button is waiting on.
 *
 * `onMerged` gets the outcome so the view can drop the merged copies from what
 * it shows.
 */
export default function useBulkMerge(
  selected: SelectedItem[],
  onMerged: (outcome: MergeOutcome, type: DuplicateType) => void
) {
  const { t } = useTranslation()
  const auth = useAuth()
  const isAdmin = auth?.user?.role === 'admin'
  const [open, setOpen] = useState<{ type: DuplicateType; ids: string[] } | null>(null)

  const types = new Set(selected.map((s) => s.type))
  const [type] = types
  let hint = ''
  if (types.size > 1) hint = t('merge.sameTypeHint')
  else if (selected.length < 2) hint = t('merge.selectTwoHint')
  else if (selected.length > MAX_SELECTED) hint = t('merge.tooManyHint', { count: MAX_SELECTED })
  else if (!MERGEABLE.includes(type)) hint = t('merge.notMergeableHint')
  const canMerge = !hint

  const barProps = isAdmin
    ? {
        onMerge: () =>
          canMerge && setOpen({ type: type as DuplicateType, ids: selected.map((s) => s.id) }),
        canMerge,
        mergeHint: hint,
      }
    : {}

  const dialog = open ? (
    <MergeDialog
      resourceType={open.type}
      ids={open.ids}
      onClose={() => setOpen(null)}
      onDone={(outcome) => {
        setOpen(null)
        onMerged(outcome, open.type)
      }}
    />
  ) : null

  return { barProps, dialog }
}
