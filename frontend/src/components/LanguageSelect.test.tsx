import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import LanguageSelect from './LanguageSelect'
import { LANGUAGES } from '../utils/languages'

const renderSelect = (value: string, onChange = vi.fn()) => {
  render(
    <>
      <label htmlFor="lang">Language</label>
      <LanguageSelect id="lang" value={value} onChange={onChange} />
    </>
  )
  return { select: screen.getByLabelText('Language') as HTMLSelectElement, onChange }
}

describe('LanguageSelect', () => {
  it('offers "not set" and every listed language, capitalised', () => {
    const { select } = renderSelect('')
    const labels = Array.from(select.options).map((o) => o.textContent)
    expect(labels[0]).toBe('Not set')
    expect(labels.slice(1)).toEqual(LANGUAGES.map((l) => l.charAt(0).toUpperCase() + l.slice(1)))
    expect(select.value).toBe('')
  })

  it('stores the lowercase name of the language picked', () => {
    const { select, onChange } = renderSelect('english')
    expect(select.value).toBe('english')
    fireEvent.change(select, { target: { value: 'italian' } })
    expect(onChange).toHaveBeenCalledWith('italian')
  })

  it('keeps an unlisted value it was opened with rather than changing it silently', () => {
    const { select } = renderSelect('klingon')
    expect(select.value).toBe('klingon')
    expect(Array.from(select.options).some((o) => o.value === 'klingon')).toBe(true)
  })
})
