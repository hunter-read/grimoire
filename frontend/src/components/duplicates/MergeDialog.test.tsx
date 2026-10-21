import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      k === 'merge.confirm' ? `merge ${o?.count}` : k,
  }),
}))

const merge = vi.fn()
const link = vi.fn()
vi.mock('../../api', () => ({
  duplicates: {
    merge: (...a: unknown[]) => merge(...a),
    link: (...a: unknown[]) => link(...a),
  },
}))

import MergeDialog from './MergeDialog'

const items = [
  { id: 'a', filename: 'a.pdf', relative_path: 'books/a.pdf', file_size: 2048, page_count: 3 },
  { id: 'b', filename: 'b.pdf', relative_path: 'books/b.pdf', file_size: 1024, is_missing: true },
  { id: 'c', title: 'Copy C', filename: 'c.pdf', relative_path: 'books/c.pdf', file_size: 10 },
]

// The server answers a dry run with the keeper it used (its suggestion when
// none was named) and every copy's details, keeper first.
const dryRun = (body: { keep_id?: string; merge_ids: string[]; dry_run?: boolean }) => {
  const keep = body.keep_id || 'b'
  return {
    resource_type: 'book',
    keep_id: keep,
    merge_ids: body.keep_id ? body.merge_ids : body.merge_ids.filter((i) => i !== keep),
    suggested_keep_id: 'b',
    dry_run: !!body.dry_run,
    items: [...items.filter((i) => i.id === keep), ...items.filter((i) => i.id !== keep)],
    fields: [],
    references: {},
    files: [],
    warnings: [],
  }
}
const dryRuns = () => merge.mock.calls.map((c) => c[0]).filter((b) => b.dry_run)

const renderDialog = (props: Partial<Parameters<typeof MergeDialog>[0]> = {}) => {
  const onClose = vi.fn()
  const onDone = vi.fn()
  render(
    <MergeDialog
      resourceType="book"
      ids={['a', 'b', 'c']}
      onClose={onClose}
      onDone={onDone}
      {...props}
    />
  )
  return { onClose, onDone }
}

describe('MergeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    merge.mockImplementation(async (body) => dryRun(body))
    link.mockResolvedValue({ linked: ['a', 'c'], errors: [] })
  })

  it("opens on the server's suggested keeper, listing copies in selection order", async () => {
    renderDialog()
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(3))
    expect(dryRuns()[0]).toEqual({
      resource_type: 'book',
      merge_ids: ['a', 'b', 'c'],
      delete_files: false,
      dry_run: true,
    })
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => r.checked)).toEqual([false, true, false])
    expect(screen.getByText('merge.suggested')).toBeInTheDocument()
    expect(screen.getByText('merge.missingFile')).toBeInTheDocument()
    expect(screen.getByText('Copy C')).toBeInTheDocument()
    // Adopting the server's keeper does not re-run the same dry run.
    expect(dryRuns()).toHaveLength(1)
  })

  it('re-runs the dry run for another keeper, and for deleting files', async () => {
    renderDialog({ keepId: 'a' })
    await waitFor(() => expect(dryRuns()[0]).toMatchObject({ keep_id: 'a', merge_ids: ['b', 'c'] }))

    await userEvent.click(screen.getAllByRole('radio')[2])
    await waitFor(() =>
      expect(dryRuns().at(-1)).toMatchObject({ keep_id: 'c', merge_ids: ['a', 'b'] })
    )

    await userEvent.click(screen.getByRole('checkbox', { name: 'merge.deleteFiles' }))
    await waitFor(() => expect(dryRuns().at(-1)).toMatchObject({ delete_files: true }))
  })

  it('merges the others into the keeper', async () => {
    const { onDone } = renderDialog({ keepId: 'a' })
    await userEvent.click(await screen.findByRole('button', { name: /merge 2/ }))
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({
        action: 'merged',
        keepId: 'a',
        removedIds: ['b', 'c'],
      })
    )
    expect(merge).toHaveBeenLastCalledWith({
      resource_type: 'book',
      keep_id: 'a',
      merge_ids: ['b', 'c'],
      delete_files: false,
    })
  })

  it('links the others as versions instead', async () => {
    const { onDone } = renderDialog({ keepId: 'b' })
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(3))
    await userEvent.click(screen.getByRole('button', { name: /merge.linkAsVersions/ }))
    expect(link).toHaveBeenCalledWith('book', 'b', [
      { id: 'a', kind: 'version', label: '' },
      { id: 'c', kind: 'version', label: '' },
    ])
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({ action: 'linked', keepId: 'b', removedIds: ['a', 'c'] })
    )
  })

  it('reports copies the link refused and stays open', async () => {
    link.mockResolvedValue({ linked: [], errors: [{ id: 'a', detail: 'Already a variant.' }] })
    const { onDone } = renderDialog({ keepId: 'b' })
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(3))
    await userEvent.click(screen.getByRole('button', { name: /merge.linkAsVersions/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Already a variant.')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('shows a failed dry run', async () => {
    merge.mockRejectedValue(new Error('nope'))
    renderDialog()
    expect(await screen.findByRole('alert')).toHaveTextContent('nope')
    // No keeper came back, so nothing can be confirmed.
    expect(screen.getByRole('button', { name: /merge 3/ })).toBeDisabled()
  })

  it('closes on cancel and on Escape', async () => {
    const { onClose } = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
