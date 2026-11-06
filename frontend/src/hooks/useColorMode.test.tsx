import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import useColorMode from './useColorMode'

afterEach(() => document.documentElement.removeAttribute('data-theme'))

describe('useColorMode', () => {
  it('reads the mode on <html data-theme>', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    expect(renderHook(() => useColorMode()).result.current).toBe('light')
  })

  it('follows a change to the attribute', async () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const { result } = renderHook(() => useColorMode())
    await act(async () => document.documentElement.setAttribute('data-theme', 'light'))
    expect(result.current).toBe('light')
  })

  it('is null when no mode is set', () => {
    expect(renderHook(() => useColorMode()).result.current).toBeNull()
  })
})
