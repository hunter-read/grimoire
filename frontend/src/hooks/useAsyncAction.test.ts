import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import useAsyncAction from './useAsyncAction'

describe('useAsyncAction', () => {
  it('resolves to the result and is busy only while it runs', async () => {
    const { result } = renderHook(() => useAsyncAction())
    let finish: (value: string) => void = () => {}
    let pending: Promise<string | undefined> = Promise.resolve(undefined)
    act(() => {
      pending = result.current.run(() => new Promise<string>((resolve) => (finish = resolve)))
    })
    expect(result.current.busy).toBe(true)
    await act(async () => finish('done'))
    await expect(pending).resolves.toBe('done')
    expect(result.current.busy).toBe(false)
    expect(result.current.error).toBe('')
  })

  it('records a failure instead of rejecting', async () => {
    const { result } = renderHook(() => useAsyncAction())
    let outcome: unknown = 'unset'
    await act(async () => {
      outcome = await result.current.run(() => Promise.reject(new Error('Server said no')))
    })
    expect(outcome).toBeUndefined()
    expect(result.current.error).toBe('Server said no')
    expect(result.current.busy).toBe(false)
  })

  it('falls back to a generic message when the failure has none', async () => {
    const { result } = renderHook(() => useAsyncAction())
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error('')))
    })
    expect(result.current.error).toBe('Something went wrong')
  })

  it('clears the previous error when it runs again', async () => {
    const { result } = renderHook(() => useAsyncAction())
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error('first')))
    })
    await act(async () => {
      await result.current.run(() => Promise.resolve(1))
    })
    expect(result.current.error).toBe('')
  })

  it('leaves its state alone once unmounted', async () => {
    const { result, unmount } = renderHook(() => useAsyncAction())
    let fail: (e: Error) => void = () => {}
    let pending: Promise<unknown> = Promise.resolve()
    act(() => {
      pending = result.current.run(() => new Promise((_, reject) => (fail = reject)))
    })
    unmount()
    fail(new Error('late'))
    await expect(pending).resolves.toBeUndefined()
  })
})
