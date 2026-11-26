import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PromptDialog from './PromptDialog'
import type { SheetPrompt } from './sheetPrompts'

// The `entries` step, and catalog steps whose `filter` follows the answers.
const DOCUMENT = { fields: { level: { type: 'number' } } }
const confirm = () => screen.getByRole('button', { name: 'Confirm' })
const NO_PAGES_SKIPPED = { later: [], skipped: [] }

const catalog = (rows: { id: string; name: string; data?: Record<string, unknown> }[]) =>
  vi.fn(async () => ({
    entries: rows.map((row) => ({
      entry_id: row.id,
      name: row.name,
      source: 'phb',
      data: row.data || {},
    })),
    total: rows.length,
  }))

describe('PromptDialog - entries', () => {
  it('chooses as many entries as asked, then no more', async () => {
    const prompt: SheetPrompt = {
      label: 'Spells',
      steps: [{ key: 'spells', type: 'entries', content_type: 'spell', count: 'level - 2' }],
      apply: [],
    }
    const browse = catalog([
      { id: 'bolt', name: 'Bolt' },
      { id: 'ward', name: 'Ward' },
      { id: 'mist', name: 'Mist' },
    ])
    const onConfirm = vi.fn()
    render(
      <PromptDialog
        prompt={prompt}
        document={DOCUMENT}
        data={{}}
        context={{ level: 4 }}
        browse={browse}
        onConfirm={onConfirm}
      />
    )
    await userEvent.click(await screen.findByLabelText('Bolt'))
    expect(screen.getByRole('status')).toHaveTextContent('1 left to choose')
    expect(confirm()).toBeDisabled()
    await userEvent.click(screen.getByLabelText('Mist'))
    expect(screen.getByRole('status')).toHaveTextContent('0 left to choose')
    expect(screen.getByLabelText('Ward')).toBeDisabled()
    // Unticking one frees a place again.
    await userEvent.click(screen.getByLabelText('Bolt'))
    expect(screen.getByLabelText('Ward')).toBeEnabled()
    await userEvent.click(screen.getByLabelText('Ward'))
    await userEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledWith(
      {
        spells: [
          { name: 'Mist', _ref: 'mist', _source: 'phb' },
          { name: 'Ward', _ref: 'ward', _source: 'phb' },
        ],
      },
      NO_PAGES_SKIPPED
    )
  })

  it('needs no answer when its count works out to nothing', async () => {
    const prompt: SheetPrompt = {
      label: 'Spells',
      steps: [{ key: 'spells', type: 'entries', content_type: 'spell', count: 'level - 4' }],
      apply: [],
    }
    render(
      <PromptDialog
        prompt={prompt}
        document={DOCUMENT}
        data={{}}
        context={{ level: 4 }}
        browse={catalog([{ id: 'bolt', name: 'Bolt' }])}
      />
    )
    expect(await screen.findByLabelText('Bolt')).toBeDisabled()
    expect(confirm()).toBeEnabled()
  })

  it('offers a feat once its prerequisite is ticked in the same step, and lets it go when unticked', async () => {
    const prompt: SheetPrompt = {
      label: 'Feats',
      steps: [
        {
          key: 'feats',
          type: 'entries',
          content_type: 'feat',
          count: 2,
          filter: "entry.needs == '' or has_ref(answer.feats, entry.needs)",
        },
      ],
      apply: [],
    }
    const browse = catalog([
      { id: 'grappler', name: 'Grappler', data: { needs: '' } },
      { id: 'crusher', name: 'Crusher', data: { needs: 'grappler' } },
      { id: 'alert', name: 'Alert', data: { needs: '' } },
    ])
    render(
      <PromptDialog prompt={prompt} document={DOCUMENT} data={{}} context={{}} browse={browse} />
    )
    await screen.findByLabelText('Grappler')
    expect(screen.queryByLabelText('Crusher')).not.toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Grappler'))
    await userEvent.click(await screen.findByLabelText('Crusher'))
    expect(confirm()).toBeEnabled()
    await userEvent.click(screen.getByLabelText('Grappler'))
    await waitFor(() => expect(screen.queryByLabelText('Crusher')).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('2 left to choose')
    expect(confirm()).toBeDisabled()
    // Ticked again, Crusher is offered again but no longer chosen.
    await userEvent.click(screen.getByLabelText('Grappler'))
    expect(await screen.findByLabelText('Crusher')).not.toBeChecked()
  })

  it('lets an entry go when the earlier answer its filter read changes', async () => {
    const prompt: SheetPrompt = {
      label: 'Spell',
      steps: [
        { key: 'cls', type: 'select', options: ['Wizard', 'Cleric'] },
        { key: 'spell', type: 'entry', content_type: 'spell', filter: 'entry.cls == answer.cls' },
      ],
      apply: [],
    }
    const browse = catalog([
      { id: 'bolt', name: 'Bolt', data: { cls: 'Wizard' } },
      { id: 'heal', name: 'Heal', data: { cls: 'Cleric' } },
    ])
    render(
      <PromptDialog prompt={prompt} document={DOCUMENT} data={{}} context={{}} browse={browse} />
    )
    await userEvent.click(screen.getByLabelText('Wizard'))
    await userEvent.click(await screen.findByLabelText('Bolt'))
    expect(confirm()).toBeEnabled()
    await userEvent.click(screen.getByLabelText('Cleric'))
    expect(await screen.findByLabelText('Heal')).not.toBeChecked()
    expect(screen.queryByLabelText('Bolt')).not.toBeInTheDocument()
    expect(confirm()).toBeDisabled()
    // Back to Wizard: Bolt is offered again, not chosen again.
    await userEvent.click(screen.getByLabelText('Wizard'))
    expect(await screen.findByLabelText('Bolt')).not.toBeChecked()
  })

  it('reads the catalog once as it opens, sharing it between steps with the same filters', async () => {
    const prompt: SheetPrompt = {
      label: 'Two',
      steps: [
        { key: 'kind', type: 'select', options: ['a', 'b'] },
        { key: 'one', type: 'entry', content_type: 'feat', filters: { cat: 'G' } },
        {
          key: 'two',
          type: 'entries',
          content_type: 'feat',
          filters: { cat: 'G' },
          visible_if: "answer.kind == 'b'",
        },
        { key: 'three', type: 'entry', content_type: 'spell' },
      ],
      apply: [],
    }
    const browse = catalog([{ id: 'alert', name: 'Alert' }])
    render(
      <PromptDialog prompt={prompt} document={DOCUMENT} data={{}} context={{}} browse={browse} />
    )
    await screen.findAllByLabelText('Alert')
    await userEvent.click(screen.getByLabelText('b'))
    await userEvent.click(screen.getByLabelText('a'))
    await userEvent.click(screen.getByLabelText('b'))
    expect(browse).toHaveBeenCalledTimes(2)
    expect(browse).toHaveBeenCalledWith('feat', { cat: 'G' }, 1, 200)
    expect(browse).toHaveBeenCalledWith('spell', {}, 1, 200)
  })

  it('offers nothing when the filter does not parse', async () => {
    const prompt: SheetPrompt = {
      label: 'Feat',
      steps: [{ key: 'feat', type: 'entry', content_type: 'feat', filter: 'entry.level <=' }],
      apply: [],
    }
    render(
      <PromptDialog
        prompt={prompt}
        document={DOCUMENT}
        data={{}}
        context={{}}
        browse={catalog([{ id: 'alert', name: 'Alert' }])}
      />
    )
    expect(await screen.findByText('Nothing to choose from')).toBeInTheDocument()
  })

  it('asks for an entry to be unticked when an earlier answer lowers the count', async () => {
    const prompt: SheetPrompt = {
      label: 'Spells',
      steps: [
        { key: 'n', type: 'select', options: ['1', '2'] },
        { key: 'spells', type: 'entries', content_type: 'spell', count: 'answer.n' },
      ],
      apply: [],
    }
    render(
      <PromptDialog
        prompt={prompt}
        document={DOCUMENT}
        data={{}}
        context={{}}
        browse={catalog([
          { id: 'bolt', name: 'Bolt' },
          { id: 'ward', name: 'Ward' },
        ])}
      />
    )
    await userEvent.click(screen.getByLabelText('2'))
    await userEvent.click(await screen.findByLabelText('Bolt'))
    await userEvent.click(screen.getByLabelText('Ward'))
    expect(confirm()).toBeEnabled()
    await userEvent.click(screen.getByLabelText('1'))
    expect(screen.getByRole('status')).toHaveTextContent('1 too many: untick one')
    expect(confirm()).toBeDisabled()
    await userEvent.click(screen.getByLabelText('Ward'))
    expect(confirm()).toBeEnabled()
  })

  it('cannot be confirmed when the catalog could not be read', async () => {
    const prompt: SheetPrompt = {
      label: 'Spells',
      steps: [{ key: 'spells', type: 'entries', content_type: 'spell', count: 2 }],
      apply: [],
    }
    render(
      <PromptDialog
        prompt={prompt}
        document={DOCUMENT}
        data={{}}
        context={{}}
        browse={async () => {
          throw new Error('Offline')
        }}
      />
    )
    expect(await screen.findByText('Offline')).toBeInTheDocument()
    expect(confirm()).toBeDisabled()
  })
})
