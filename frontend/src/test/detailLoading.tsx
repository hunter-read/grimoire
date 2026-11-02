import { expect, it, type Mock } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'

interface DetailLoadingOptions {
  /** The detail endpoint's prefix, e.g. `/maps`; items are `${base}/<id>`. */
  base: string
  /** A detail response for `id` whose page title is `name`. */
  item: (id: string, name: string) => unknown
  /** The test file's mocked `api.get`. */
  get: Mock
  /**
   * Render the view on item `id`, returning how to move it to another item -
   * through the router, or by changing a mocked `useParams` and re-rendering.
   */
  mount: (id: string) => (next: string) => unknown
}

/**
 * The two loading cases every media detail view must get right (issue #785):
 * a response for an item the user has already stepped past is dropped, and a
 * 404 shows a message instead of a spinner that never ends.
 *
 * Which item is on screen is read from `document.title`, which each view sets
 * from the item it shows.
 */
export function itLoadsOnlyTheCurrentItem({ base, item, get, mount }: DetailLoadingOptions) {
  it('ignores the response for an item it has already left', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    get.mockImplementation((url: string) => {
      if (url === `${base}/one`) return new Promise((resolve) => (resolveFirst = resolve))
      if (url === `${base}/two`) return Promise.resolve(item('two', 'second-item'))
      return Promise.resolve({})
    })
    const go = mount('one')
    await act(async () => {
      await go('two')
    })
    await waitFor(() => expect(document.title).toContain('second-item'))

    await act(async () => resolveFirst(item('one', 'first-item')))
    expect(document.title).toContain('second-item')
  })

  it('says the item is gone when it 404s, rather than spinning', async () => {
    get.mockImplementation((url: string) =>
      url === `${base}/gone`
        ? Promise.reject(Object.assign(new Error('Not found'), { status: 404 }))
        : Promise.resolve({})
    )
    mount('gone')
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be found/i)
  })
}
