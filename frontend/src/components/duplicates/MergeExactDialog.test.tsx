import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && 'count' in o ? `${k}:${o.count}` : k),
  }),
}))

const mergeBatch = vi.fn()
vi.mock('../../api', () => ({
  duplicates: { mergeBatch: (...a: unknown[]) => mergeBatch(...a) },
}))

import MergeExactDialog from './MergeExactDialog'

const member = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  filename: `${id}.pdf`,
  relative_path: `books/${id}.pdf`,
  content_hash: 'h',
  ...extra,
})
const groups = [
  {
    id: 'g1',
    resource_type: 'book',
    confidence: 1,
    members: [member('a'), member('b', { page_count: 9 })],
  },
  { id: 'g2', resource_type: 'map', confidence: 1, members: [member('c'), member('d')] },
]

const result = (keep: string) => ({
  resource_type: 'book',
  keep_id: keep,
  merge_ids: [],
  references: { favorites: { moved: 1, deduplicated: 0 } },
  files: [],
  warnings: [],
})

describe('MergeExactDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mergeBatch.mockImplementation(async (body) => ({
      results: [
        { keep_id: 'b', ok: true, result: result('b') },
        { keep_id: 'c', ok: false, detail: 'Item d was not found.' },
      ],
      merged: body.dry_run ? 0 : 1,
      failed: 1,
    }))
  })

  it('previews every group merged into its keeper, and what will be skipped', async () => {
    render(<MergeExactDialog groups={groups} onClose={vi.fn()} onDone={vi.fn()} />)
    expect(await screen.findByText('Item d was not found.')).toBeInTheDocument()
    expect(mergeBatch).toHaveBeenCalledWith({
      merges: [
        { resource_type: 'book', keep_id: 'b', merge_ids: ['a'] },
        { resource_type: 'map', keep_id: 'c', merge_ids: ['d'] },
      ],
      delete_files: false,
      dry_run: true,
    })
    expect(screen.getByText('merge.summary.ref.favorites:1')).toBeInTheDocument()
  })

  it('re-previews with file deletion, then merges', async () => {
    const onDone = vi.fn()
    render(<MergeExactDialog groups={groups} onClose={vi.fn()} onDone={onDone} />)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'merge.deleteFiles' }))
    await waitFor(() =>
      expect(mergeBatch).toHaveBeenLastCalledWith(
        expect.objectContaining({ delete_files: true, dry_run: true })
      )
    )

    await userEvent.click(
      await screen.findByRole('button', { name: /maintenance.dupes.mergeExact.confirm:1/ })
    )
    expect(mergeBatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ delete_files: true, merges: expect.any(Array) })
    )
    expect(mergeBatch.mock.calls.at(-1)?.[0].dry_run).toBeUndefined()
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ merged: 1, failed: 1 }))
  })

  it('reports a failed merge and stays open', async () => {
    const onDone = vi.fn()
    render(<MergeExactDialog groups={groups} onClose={vi.fn()} onDone={onDone} />)
    const confirm = await screen.findByRole('button', {
      name: /maintenance.dupes.mergeExact.confirm/,
    })
    mergeBatch.mockRejectedValue(new Error('down'))
    await userEvent.click(confirm)
    expect(await screen.findByRole('alert')).toHaveTextContent('down')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('closes on cancel', async () => {
    const onClose = vi.fn()
    render(<MergeExactDialog groups={groups} onClose={onClose} onDone={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(onClose).toHaveBeenCalled()
  })
})
