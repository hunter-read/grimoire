import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PromptDialog from './PromptDialog'
import type { SheetPrompt } from './sheetPrompts'

const LEVEL_UP: SheetPrompt = {
  label: 'Level up',
  steps: [
    { key: 'hp', type: 'number', label: 'Hit points', average: 'hit_die / 2 + 1', min: 0 },
    {
      key: 'kind',
      type: 'select',
      label: 'Improvement',
      options: [
        { value: 'asi', label: 'Ability Score Improvement' },
        { value: 'feat', label: 'Feat' },
      ],
    },
    {
      key: 'asi',
      type: 'distribute',
      label: 'Abilities',
      options: [
        { value: 'str', label: 'Strength' },
        { value: 'dex', label: 'Dexterity' },
      ],
      patterns: ['2', '1,1'],
      visible_if: "answer.kind == 'asi'",
    },
    {
      key: 'feat',
      type: 'entry',
      label: 'Feat',
      content_type: 'feat',
      filters: { category: 'G' },
      filter: 'entry.level <= level',
      visible_if: "answer.kind == 'feat'",
    },
  ],
  apply: [{ set: 'level', to: 'level + 1' }],
}

const DOCUMENT = {
  fields: {
    level: { type: 'number' },
    skills: { type: 'multiselect', options: ['Arcana', 'History', 'Insight'] },
  },
}
const SHEET = { level: 4, hit_die: 10 }

const confirm = () => screen.getByRole('button', { name: 'Confirm' })

describe('PromptDialog', () => {
  it('shows the steps for the answers so far, and confirms once all are answered', async () => {
    const onConfirm = vi.fn()
    render(
      <PromptDialog
        prompt={LEVEL_UP}
        document={DOCUMENT}
        data={{}}
        context={SHEET}
        onConfirm={onConfirm}
      />
    )
    expect(screen.getByRole('dialog', { name: 'Level up' })).toBeInTheDocument()
    expect(screen.queryByText('Abilities')).not.toBeInTheDocument()
    expect(confirm()).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Use average (6)' }))
    await userEvent.click(screen.getByLabelText('Ability Score Improvement'))
    expect(screen.getByText('Abilities')).toBeInTheDocument()
    expect(confirm()).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'One more for Strength' }))
    expect(confirm()).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'One more for Dexterity' }))
    // +1/+1 spends every point: no third.
    expect(screen.getByRole('button', { name: 'One more for Strength' })).toBeDisabled()
    await userEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledWith({ hp: 6, kind: 'asi', asi: { str: 1, dex: 1 } })
  })

  it('takes a number typed by hand, within its bounds', async () => {
    const onConfirm = vi.fn()
    const prompt: SheetPrompt = { ...LEVEL_UP, steps: [LEVEL_UP.steps[0]] }
    render(
      <PromptDialog
        prompt={prompt}
        document={DOCUMENT}
        data={{}}
        context={SHEET}
        onConfirm={onConfirm}
      />
    )
    await userEvent.type(screen.getByLabelText('Hit points'), '8')
    await userEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledWith({ hp: 8 })
  })

  it('offers the catalog entries the filters let through', async () => {
    const browse = vi.fn(async () => ({
      entries: [
        { entry_id: 'alert', name: 'Alert', source: 'xphb', data: { level: 1 } },
        { entry_id: 'boon', name: 'Boon of Speed', source: 'xphb', data: { level: 19 } },
      ],
      total: 2,
    }))
    const onConfirm = vi.fn()
    render(
      <PromptDialog
        prompt={LEVEL_UP}
        document={DOCUMENT}
        data={{}}
        context={SHEET}
        browse={browse}
        onConfirm={onConfirm}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Use average (6)' }))
    await userEvent.click(screen.getByLabelText('Feat'))
    await userEvent.click(await screen.findByLabelText('Alert'))
    expect(screen.queryByLabelText('Boon of Speed')).not.toBeInTheDocument()
    expect(browse).toHaveBeenCalledWith('feat', { category: 'G' }, 1, 200)
    await userEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledWith({
      hp: 6,
      kind: 'feat',
      feat: { level: 1, name: 'Alert', _ref: 'alert', _source: 'xphb' },
    })
  })

  it('says so when nothing passes', async () => {
    const prompt: SheetPrompt = {
      ...LEVEL_UP,
      steps: [{ ...LEVEL_UP.steps[3], visible_if: undefined }],
    }
    render(
      <PromptDialog
        prompt={prompt}
        document={DOCUMENT}
        data={{}}
        context={SHEET}
        browse={async () => ({ entries: [], total: 0 })}
      />
    )
    expect(await screen.findByText('Nothing to choose from')).toBeInTheDocument()
  })

  it('chooses as many as asked, leaving out what the character has', async () => {
    const onConfirm = vi.fn()
    const prompt: SheetPrompt = {
      label: 'Skills',
      steps: [{ key: 'skills', type: 'choose', target: 'skills', count: 1 }],
      apply: [{ add: 'skills', values: 'answer.skills' }],
    }
    render(
      <PromptDialog
        prompt={prompt}
        document={DOCUMENT}
        data={{ skills: ['Arcana'] }}
        context={{}}
        onConfirm={onConfirm}
      />
    )
    expect(screen.getByLabelText(/Arcana/)).toBeDisabled()
    await userEvent.click(screen.getByLabelText('History'))
    expect(screen.getByLabelText('Insight')).toBeDisabled()
    await userEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledWith({ skills: ['History'] })
  })

  it('can always be put off, by button or Escape', async () => {
    const onSkip = vi.fn()
    render(
      <PromptDialog
        prompt={LEVEL_UP}
        document={DOCUMENT}
        data={{}}
        context={SHEET}
        onSkip={onSkip}
      />
    )
    await userEvent.click(screen.getByText('Choose later'))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(onSkip).toHaveBeenCalledTimes(2))
  })
})
