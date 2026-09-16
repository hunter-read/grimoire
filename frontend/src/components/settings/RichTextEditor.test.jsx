import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RichTextEditor from './RichTextEditor'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k, i18n: { language: 'en-US' } }),
}))

// jsdom does not implement execCommand; the component's whole job is to call it
// with the right command, so stub it and assert on the calls.
let execCommand

beforeEach(() => {
  execCommand = vi.fn(() => true)
  document.execCommand = execCommand
})

afterEach(() => {
  vi.restoreAllMocks()
})

const setup = (props = {}) => {
  const onChange = vi.fn()
  const utils = render(<RichTextEditor value="" onChange={onChange} ariaLabel="Body" {...props} />)
  return { onChange, ...utils }
}

describe('RichTextEditor', () => {
  it('renders the editable region with its aria label', () => {
    setup()
    expect(screen.getByRole('textbox', { name: 'Body' })).toBeInTheDocument()
  })

  it('hydrates the editable region from `value`', () => {
    setup({ value: '<p>hello</p>' })
    expect(screen.getByRole('textbox', { name: 'Body' }).innerHTML).toBe('<p>hello</p>')
  })

  it.each([
    ['richText.bold', 'bold'],
    ['richText.italic', 'italic'],
    ['richText.strikethrough', 'strikeThrough'],
    ['richText.bulletList', 'insertUnorderedList'],
    ['richText.numberedList', 'insertOrderedList'],
  ])('%s runs the %s command', (title, command) => {
    const { onChange } = setup()
    fireEvent.click(screen.getByTitle(title))
    expect(execCommand).toHaveBeenCalledWith(command, false, undefined)
    expect(onChange).toHaveBeenCalled()
  })

  it('creates a link from an accepted URL', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('https://example.com')
    setup()
    fireEvent.click(screen.getByTitle('richText.link'))
    expect(execCommand).toHaveBeenCalledWith('createLink', false, 'https://example.com')
  })

  it('does nothing when the link prompt is dismissed', () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    setup()
    fireEvent.click(screen.getByTitle('richText.link'))
    expect(execCommand).not.toHaveBeenCalled()
  })

  // Defense in depth — the server sanitizes too, but a javascript: URL should
  // never reach execCommand from here.
  it.each(['javascript:alert(1)', 'data:text/html,<script>', 'ftp://example.com'])(
    'rejects the unsafe URL %s',
    (url) => {
      vi.spyOn(window, 'prompt').mockReturnValue(url)
      setup()
      fireEvent.click(screen.getByTitle('richText.link'))
      expect(execCommand).not.toHaveBeenCalled()
    }
  )

  it.each(['/relative/path', '#anchor', 'mailto:someone@example.com'])(
    'accepts the safe URL %s',
    (url) => {
      vi.spyOn(window, 'prompt').mockReturnValue(url)
      setup()
      fireEvent.click(screen.getByTitle('richText.link'))
      expect(execCommand).toHaveBeenCalledWith('createLink', false, url)
    }
  )

  it('reports edits on input and on blur', () => {
    const { onChange } = setup()
    const box = screen.getByRole('textbox', { name: 'Body' })
    box.innerHTML = '<p>typed</p>'
    fireEvent.input(box)
    expect(onChange).toHaveBeenLastCalledWith('<p>typed</p>')

    box.innerHTML = '<p>blurred</p>'
    fireEvent.blur(box)
    expect(onChange).toHaveBeenLastCalledWith('<p>blurred</p>')
  })
})
