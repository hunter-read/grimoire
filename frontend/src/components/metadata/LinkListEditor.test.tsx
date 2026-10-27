import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LinkListEditor, { type EditableLink } from './LinkListEditor'

function Harness({ initial = [{ label: '', url: '' }] }: { initial?: EditableLink[] }) {
  const [links, setLinks] = useState<EditableLink[]>(initial)
  return (
    <LinkListEditor
      links={links}
      onChange={setLinks}
      addLabel="Add Link"
      labelPlaceholder="Label"
      urlPlaceholder="URL"
      idPrefix="lnk"
    />
  )
}

describe('LinkListEditor', () => {
  it('edits label and url', async () => {
    render(<Harness />)
    const label = document.getElementById('lnk-label-0') as HTMLInputElement
    const url = document.getElementById('lnk-url-0') as HTMLInputElement
    await userEvent.type(label, 'DTRPG')
    await userEvent.type(url, 'http://x')
    expect(label.value).toBe('DTRPG')
    expect(url.value).toBe('http://x')
  })

  it('adds a new row', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByText('Add Link'))
    expect(document.getElementById('lnk-url-1')).toBeTruthy()
  })

  it('removes a row', async () => {
    render(
      <Harness
        initial={[
          { label: 'a', url: 'b' },
          { label: 'c', url: 'd' },
        ]}
      />
    )
    await userEvent.click(screen.getAllByLabelText('Remove link')[0])
    // Only one row remains.
    expect(document.getElementById('lnk-url-1')).toBeFalsy()
  })
})
