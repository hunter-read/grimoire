import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PromptDialog from './PromptDialog'
import type { SheetPrompt } from './sheetPrompts'

// A `paged` prompt: a page at a time, with Back and Next, and pages that can
// be skipped to be chosen later.
const LEVEL_UP: SheetPrompt = {
  label: 'Level up',
  paged: true,
  pages: {
    sub: { label: 'Subclass' },
    feat: { label: 'Feat', later: 'feat_later' },
  },
  steps: [
    { key: 'hp', type: 'select', label: 'Hit points', options: ['5', '6'] },
    { key: 'sub', type: 'select', label: 'Subclass', options: ['Champion'], page: 'sub' },
    {
      key: 'kind',
      type: 'select',
      label: 'Improvement',
      options: ['asi', 'feat'],
      page: 'feat',
    },
    {
      key: 'feat',
      type: 'select',
      label: 'Which feat',
      options: ['Alert', 'Lucky'],
      page: 'feat',
      visible_if: "answer.kind == 'feat'",
    },
    {
      key: 'spells',
      type: 'select',
      label: 'Spells',
      options: ['Bolt'],
      visible_if: 'casts',
    },
  ],
  apply: [],
}

const DOCUMENT = { fields: {} }
const button = (name: string) => screen.getByRole('button', { name })
const next = () => button('Next')

describe('PromptDialog - pages', () => {
  it('shows a page at a time, Next waiting for its answers, Back keeping them', async () => {
    const onConfirm = vi.fn()
    render(
      <PromptDialog
        prompt={LEVEL_UP}
        document={DOCUMENT}
        data={{}}
        context={{ casts: false }}
        onConfirm={onConfirm}
      />
    )
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.queryByText('Subclass')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(next()).toBeDisabled()
    await userEvent.click(screen.getByLabelText('6'))
    await userEvent.click(next())

    expect(screen.getByText('Page 2 of 3 · Subclass')).toBeInTheDocument()
    expect(screen.queryByLabelText('6')).not.toBeInTheDocument()
    // The subclass cannot be put off on its own: only the whole prompt.
    expect(button('Choose later')).toBeInTheDocument()
    await userEvent.click(button('Back'))
    expect(screen.getByLabelText('6')).toBeChecked()
    await userEvent.click(next())
    await userEvent.click(screen.getByLabelText('Champion'))
    await userEvent.click(next())

    // The spells page shows for no non-caster: two answers make the last page.
    expect(screen.getByText('Page 3 of 3 · Feat')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('feat'))
    expect(button('Confirm')).toBeDisabled()
    await userEvent.click(screen.getByLabelText('Lucky'))
    await userEvent.click(button('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith(
      { hp: '6', sub: 'Champion', kind: 'feat', feat: 'Lucky' },
      { later: [], skipped: [] }
    )
  })

  it('skips a page to choose it later, which no longer blocks Confirm', async () => {
    const onConfirm = vi.fn()
    render(
      <PromptDialog
        prompt={LEVEL_UP}
        document={DOCUMENT}
        data={{}}
        context={{ casts: true }}
        onConfirm={onConfirm}
      />
    )
    await userEvent.click(screen.getByLabelText('5'))
    await userEvent.click(next())
    await userEvent.click(screen.getByLabelText('Champion'))
    await userEvent.click(next())
    await userEvent.click(screen.getByLabelText('feat'))
    await userEvent.click(button('Skip, choose later'))

    expect(screen.getByText('Page 4 of 4')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Bolt'))
    await userEvent.click(button('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith(
      { hp: '5', sub: 'Champion', spells: 'Bolt' },
      { later: ['feat_later'], skipped: ['feat'] }
    )
  })

  it('asks a skipped page again when the player goes back to it', async () => {
    const onConfirm = vi.fn()
    render(
      <PromptDialog
        prompt={LEVEL_UP}
        document={DOCUMENT}
        data={{}}
        context={{ casts: true }}
        onConfirm={onConfirm}
      />
    )
    await userEvent.click(screen.getByLabelText('5'))
    await userEvent.click(next())
    await userEvent.click(screen.getByLabelText('Champion'))
    await userEvent.click(next())
    await userEvent.click(button('Skip, choose later'))
    await userEvent.click(button('Back'))
    expect(screen.getByText('Page 3 of 4 · Feat')).toBeInTheDocument()
    expect(next()).toBeDisabled()
    await userEvent.click(screen.getByLabelText('asi'))
    await userEvent.click(next())
    await userEvent.click(screen.getByLabelText('Bolt'))
    await userEvent.click(button('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith(
      { hp: '5', sub: 'Champion', kind: 'asi', spells: 'Bolt' },
      { later: [], skipped: [] }
    )
  })

  it('confirms when the page skipped is the last one', async () => {
    const onConfirm = vi.fn()
    render(
      <PromptDialog
        prompt={LEVEL_UP}
        document={DOCUMENT}
        data={{}}
        context={{ casts: false }}
        onConfirm={onConfirm}
      />
    )
    await userEvent.click(screen.getByLabelText('5'))
    await userEvent.click(next())
    await userEvent.click(screen.getByLabelText('Champion'))
    await userEvent.click(next())
    await userEvent.click(screen.getByLabelText('feat'))
    await userEvent.click(button('Skip, choose later'))
    expect(onConfirm).toHaveBeenCalledWith(
      { hp: '5', sub: 'Champion' },
      { later: ['feat_later'], skipped: ['feat'] }
    )
  })

  it('goes back past its first page to the prompt before it, when there is one', async () => {
    const onBack = vi.fn()
    const onSkip = vi.fn()
    render(
      <PromptDialog
        prompt={LEVEL_UP}
        document={DOCUMENT}
        data={{}}
        context={{}}
        onBack={onBack}
        onSkip={onSkip}
      />
    )
    await userEvent.click(button('Back'))
    expect(onBack).toHaveBeenCalledTimes(1)
    await userEvent.click(button('Choose later'))
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('opens again on its last page with the answers it was confirmed with', async () => {
    const onConfirm = vi.fn()
    render(
      <PromptDialog
        prompt={LEVEL_UP}
        document={DOCUMENT}
        data={{}}
        context={{ casts: false }}
        initialAnswers={{ hp: '6', kind: 'asi' }}
        initialSkipped={['sub']}
        startAtEnd
        onConfirm={onConfirm}
      />
    )
    expect(screen.getByText('Page 3 of 3 · Feat')).toBeInTheDocument()
    expect(screen.getByLabelText('asi')).toBeChecked()
    await userEvent.click(button('Back'))
    // A page skipped before is asked again on the way back to it.
    expect(screen.getByLabelText('Champion')).not.toBeChecked()
    await userEvent.click(screen.getByLabelText('Champion'))
    await userEvent.click(next())
    await userEvent.click(button('Confirm'))
    expect(onConfirm).toHaveBeenCalledWith(
      { hp: '6', sub: 'Champion', kind: 'asi' },
      { later: [], skipped: [] }
    )
  })

  it('draws a prompt that is not paged on one page, with no Back', () => {
    render(
      <PromptDialog
        prompt={{ ...LEVEL_UP, paged: false }}
        document={DOCUMENT}
        data={{}}
        context={{ casts: true }}
        onBack={vi.fn()}
      />
    )
    expect(screen.getByText('Subclass')).toBeInTheDocument()
    expect(screen.getByText('Spells')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Page 1/)).not.toBeInTheDocument()
  })
})
