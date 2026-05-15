import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CamperNameButton } from './CamperNameButton'

describe('CamperNameButton', () => {
  it('renders the name and calls onSelect with the stringified cm_id when clicked', () => {
    const onSelect = vi.fn()
    render(<CamperNameButton cmId={4242} name="Emma Johnson" onSelect={onSelect} />)
    const button = screen.getByRole('button', { name: 'Emma Johnson' })
    fireEvent.click(button)
    expect(onSelect).toHaveBeenCalledWith('4242')
  })

  it('has type="button" so it does not submit enclosing forms', () => {
    render(<CamperNameButton cmId={1} name="Liam Garcia" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Liam Garcia' })).toHaveAttribute('type', 'button')
  })
})
