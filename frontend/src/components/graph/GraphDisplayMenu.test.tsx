import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GraphDisplayMenu from './GraphDisplayMenu'

function setup(overrides = {}) {
  const props = {
    showBubbles: true,
    onToggleBubbles: vi.fn(),
    showUnits: true,
    onToggleUnits: vi.fn(),
    crossScope: false,
    onToggleCrossScope: vi.fn(),
    ...overrides,
  }
  render(<GraphDisplayMenu {...props} />)
  return props
}

describe('GraphDisplayMenu', () => {
  it('opens the menu and toggles bunk bubbles', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: /display/i }))
    await userEvent.click(screen.getByLabelText(/bunk bubbles/i))
    expect(props.onToggleBubbles).toHaveBeenCalled()
  })

  it('reflects cross-scope state and toggles it', async () => {
    const props = setup({ crossScope: true })
    await userEvent.click(screen.getByRole('button', { name: /display/i }))
    expect(screen.getByLabelText(/cross-scope edges/i)).toBeChecked()
    await userEvent.click(screen.getByLabelText(/cross-scope edges/i))
    expect(props.onToggleCrossScope).toHaveBeenCalled()
  })

  it('toggles unit grouping', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: /display/i }))
    await userEvent.click(screen.getByLabelText(/unit grouping/i))
    expect(props.onToggleUnits).toHaveBeenCalled()
  })
})
