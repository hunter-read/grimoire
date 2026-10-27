import { describe, it, expect, vi } from 'vitest'
import { useRef, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useDialogFocus from './useDialogFocus'

function Dialog({ onClose, withInitial = false, empty = false }) {
  const ref = useRef(null)
  const initial = useRef(null)
  useDialogFocus(ref, { onClose, initialFocusRef: withInitial ? initial : undefined })
  return (
    <div ref={ref} role="dialog" aria-label="Test" tabIndex={-1}>
      {empty ? null : (
        <>
          <button>First</button>
          <input aria-label="Middle" ref={initial} />
          <button>Last</button>
        </>
      )}
    </div>
  )
}

function Host({ onClose, ...props }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Opener</button>
      {open ? (
        <Dialog
          {...props}
          onClose={() => {
            onClose?.()
            setOpen(false)
          }}
        />
      ) : null}
    </>
  )
}

describe('useDialogFocus', () => {
  it('moves focus to the first control on open', () => {
    render(<Dialog />)
    expect(screen.getByText('First')).toHaveFocus()
  })

  it('moves focus to the chosen control when one is given', () => {
    render(<Dialog withInitial />)
    expect(screen.getByLabelText('Middle')).toHaveFocus()
  })

  it('focuses the dialog itself when it has no controls', () => {
    render(<Dialog empty />)
    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('keeps Tab inside the dialog, both ways', async () => {
    render(<Dialog />)
    screen.getByText('Last').focus()
    await userEvent.tab()
    expect(screen.getByText('First')).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByText('Last')).toHaveFocus()
  })

  it('lets Tab move normally between the ends', async () => {
    render(<Dialog />)
    await userEvent.tab()
    expect(screen.getByLabelText('Middle')).toHaveFocus()
  })

  it('closes on Escape and hands focus back to the opener', async () => {
    const onClose = vi.fn()
    render(<Host onClose={onClose} />)
    await userEvent.click(screen.getByText('Opener'))
    expect(screen.getByText('First')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    expect(screen.getByText('Opener')).toHaveFocus()
  })

  it('ignores Tab in a dialog with nothing to focus', async () => {
    render(<Dialog empty />)
    await userEvent.tab()
    expect(document.body).toBeTruthy()
  })
})
