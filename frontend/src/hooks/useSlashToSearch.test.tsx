import { describe, it, expect, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import useSlashToSearch from './useSlashToSearch'

function Page({ withInput = true }: { withInput?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  useSlashToSearch(ref)
  return (
    <>
      {withInput && <input ref={ref} aria-label="Search" defaultValue="old" />}
      <textarea aria-label="Notes" />
      <button>Elsewhere</button>
    </>
  )
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useSlashToSearch', () => {
  it('moves focus to the search box on /', () => {
    render(<Page />)
    screen.getByRole('button').focus()
    fireEvent.keyDown(screen.getByRole('button'), { key: '/' })
    expect(document.activeElement).toBe(screen.getByLabelText('Search'))
  })

  it('leaves / alone while typing in a field', () => {
    render(<Page />)
    const notes = screen.getByLabelText('Notes')
    notes.focus()
    fireEvent.keyDown(notes, { key: '/' })
    expect(document.activeElement).toBe(notes)
  })

  it('ignores / with a modifier, and other keys', () => {
    render(<Page />)
    const button = screen.getByRole('button')
    button.focus()
    fireEvent.keyDown(button, { key: '/', metaKey: true })
    fireEvent.keyDown(button, { key: 'a' })
    expect(document.activeElement).toBe(button)
  })

  it('stays out of the way of an open dialog', () => {
    render(
      <>
        <Page />
        <div role="dialog" aria-modal="true" />
      </>
    )
    const button = screen.getByRole('button')
    button.focus()
    fireEvent.keyDown(button, { key: '/' })
    expect(document.activeElement).toBe(button)
  })

  it('does nothing without a search box', () => {
    render(<Page withInput={false} />)
    const button = screen.getByRole('button')
    button.focus()
    fireEvent.keyDown(button, { key: '/' })
    expect(document.activeElement).toBe(button)
  })
})
