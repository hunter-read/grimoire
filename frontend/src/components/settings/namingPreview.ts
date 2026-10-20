import type { Schema } from '../../api'

// What the folder-naming preview rows can have done to them. Shared by the
// table, its cells and the dialog that runs the actions.

export type PreviewRow = Schema<'PreviewRow'>

export const canChangeTitle = (row: PreviewRow) => row.title_status === 'change'
export const canRename = (row: PreviewRow) => row.rename_status === 'ok'
/** Whether a row has anything either action could do to it. */
export const isActionable = (row: PreviewRow) => canChangeTitle(row) || canRename(row)
