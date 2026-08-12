import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReplaceSheetDialog from './ReplaceSheetDialog'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

beforeEach(() => {
  vi.clearAllMocks()
})

function setup(overrides = {}) {
  const props = {
    downloadUrl: 'http://sheet.pdf',
    onCancel: vi.fn(),
    onReplace: vi.fn(),
    ...overrides,
  }
  return { ...render(<ReplaceSheetDialog {...props} />), props }
}

describe('ReplaceSheetDialog', () => {
  it('warns about the replacement and offers all three actions', () => {
    setup()
    expect(screen.getByText('members.replaceSheet')).toBeInTheDocument()
    expect(screen.getByText('members.replaceSheetWarning')).toBeInTheDocument()
    expect(screen.getByText('members.cancel')).toBeInTheDocument()
    expect(screen.getByText('members.replace')).toBeInTheDocument()
  })

  it('links the download to the current sheet, opening safely in a new tab', () => {
    setup({ downloadUrl: 'http://sheet.pdf?token=abc' })
    const link = screen.getByRole('link', { name: /members.downloadCurrent/ })
    expect(link).toHaveAttribute('href', 'http://sheet.pdf?token=abc')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('calls onReplace when the replace button is clicked', async () => {
    const { props } = setup()
    await userEvent.click(screen.getByText('members.replace'))
    expect(props.onReplace).toHaveBeenCalledTimes(1)
    expect(props.onCancel).not.toHaveBeenCalled()
  })

  it('calls onCancel when the cancel button is clicked', async () => {
    const { props } = setup()
    await userEvent.click(screen.getByText('members.cancel'))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
    expect(props.onReplace).not.toHaveBeenCalled()
  })

  it('cancels on a backdrop click but not on a click inside the panel', async () => {
    const { container, props } = setup()
    await userEvent.click(container.firstChild)
    expect(props.onCancel).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByText('members.replaceSheetWarning'))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })
})
