import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AudioChaptersPanel from './AudioChaptersPanel'

const CHAPTERS = [
  { start: 0, title: 'Prologue' },
  { start: 3725, title: '' },
]

describe('AudioChaptersPanel', () => {
  it('lists each chapter with its start time, numbering untitled ones', () => {
    render(<AudioChaptersPanel chapters={CHAPTERS} currentIndex={-1} onSelect={() => {}} />)
    expect(screen.getByText('Chapters (2)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /0:00\s*Prologue/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1:02:05\s*Chapter 2/ })).toBeInTheDocument()
  })

  it('marks the playing chapter', () => {
    render(<AudioChaptersPanel chapters={CHAPTERS} currentIndex={1} onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: /Chapter 2/ })).toHaveAttribute(
      'aria-current',
      'true'
    )
    expect(screen.getByRole('button', { name: /Prologue/ })).not.toHaveAttribute('aria-current')
  })

  it('hands the chapter start to onSelect', async () => {
    const onSelect = vi.fn()
    render(<AudioChaptersPanel chapters={CHAPTERS} currentIndex={0} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: /Chapter 2/ }))
    expect(onSelect).toHaveBeenCalledWith(3725)
  })
})
