import { describe, expect, it, vi } from 'vitest'
import { Suspense } from 'react'
import { render, screen } from '@testing-library/react'
import lazyWithPreload from './lazyWithPreload'

const Hello = () => <p>hello</p>

describe('lazyWithPreload', () => {
  it('renders the loaded component', async () => {
    const View = lazyWithPreload(() => Promise.resolve({ default: Hello }))
    render(
      <Suspense fallback={<p>loading</p>}>
        <View />
      </Suspense>
    )
    expect(await screen.findByText('hello')).toBeInTheDocument()
  })

  it('shares one fetch between preload and render', async () => {
    const load = vi.fn(() => Promise.resolve({ default: Hello }))
    const View = lazyWithPreload(load)
    await View.preload()
    await View.preload()
    render(
      <Suspense fallback={<p>loading</p>}>
        <View />
      </Suspense>
    )
    expect(await screen.findByText('hello')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('tries again after a failed fetch', async () => {
    const load = vi
      .fn<() => Promise<{ default: typeof Hello }>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ default: Hello })
    const View = lazyWithPreload(load)
    await expect(View.preload()).rejects.toThrow('offline')
    await expect(View.preload()).resolves.toEqual({ default: Hello })
    expect(load).toHaveBeenCalledTimes(2)
  })
})
