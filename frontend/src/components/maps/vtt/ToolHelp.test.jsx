import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ToolHelp from './ToolHelp'
import { TOOL_LIGHT, TOOL_PORTAL, TOOL_SELECT, TOOL_WALL, TOOL_WINDOW } from './tools'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

describe('ToolHelp', () => {
  it('tells the user how to finish a wall', () => {
    // The gesture that prompted this panel: nothing on screen said a wall ends
    // on a double-click, leaving users stuck mid-polyline.
    render(<ToolHelp tool={TOOL_WALL} />)
    expect(screen.getByText('maps.vtt.help.wall.finish')).toBeInTheDocument()
    expect(screen.getByText('maps.vtt.help.wall.cancel')).toBeInTheDocument()
  })

  it('shows only the active tool’s gestures', () => {
    render(<ToolHelp tool={TOOL_LIGHT} />)
    expect(screen.getByText('maps.vtt.help.light.click')).toBeInTheDocument()
    // A reference card of everything is one nobody reads.
    expect(screen.queryByText('maps.vtt.help.wall.finish')).toBeNull()
  })

  it('names the active tool', () => {
    render(<ToolHelp tool={TOOL_SELECT} />)
    expect(screen.getByText('maps.vtt.tools.select')).toBeInTheDocument()
  })

  it.each([
    [TOOL_PORTAL, 'maps.vtt.help.portal.click'],
    [TOOL_WINDOW, 'maps.vtt.help.window.click'],
  ])('covers the %s tool', (tool, key) => {
    render(<ToolHelp tool={tool} />)
    expect(screen.getByText(key)).toBeInTheDocument()
  })

  it('always shows the gestures that never change', () => {
    render(<ToolHelp tool={TOOL_WALL} />)
    expect(screen.getByText('maps.vtt.help.global.pan')).toBeInTheDocument()
    expect(screen.getByText('maps.vtt.help.global.zoom')).toBeInTheDocument()
    // The snap override is the least guessable of the three.
    expect(screen.getByText('maps.vtt.help.global.freeSnap')).toBeInTheDocument()
  })

  it('renders nothing for an unknown tool', () => {
    const { container } = render(<ToolHelp tool="nonsense" />)
    expect(container).toBeEmptyDOMElement()
  })
})
