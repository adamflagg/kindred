/**
 * The title-as-switcher primitive shared by the summer session header and the
 * weekend roster header. Both surfaces make the program's name the page title
 * AND the control that changes it; this holds the one copy of that markup so
 * the two cannot drift apart on styling.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tent } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { TitleSwitcher } from './TitleSwitcher'

const OPTIONS = [
  { value: 'fc1', label: 'Family Camp 1' },
  { value: 'ww', label: "Women's Weekend" },
]

function renderSwitcher(overrides: Record<string, unknown> = {}) {
  const onChange = vi.fn()
  render(
    <TitleSwitcher
      icon={Tent}
      label="Family Camp 1"
      value="fc1"
      options={OPTIONS}
      onChange={onChange}
      {...overrides}
    />
  )
  return { onChange }
}

describe('TitleSwitcher', () => {
  it('makes the title itself the control that opens the list', async () => {
    renderSwitcher()
    await userEvent.click(screen.getByRole('button', { name: /Family Camp 1/ }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
      'Family Camp 1',
      "Women's Weekend",
    ])
  })

  it('reports the chosen option by value, not by label', async () => {
    // Both callers route on the value — a session cm_id, a weekend slug — and
    // neither can navigate on the human-readable label.
    const { onChange } = renderSwitcher()
    await userEvent.click(screen.getByRole('button', { name: /Family Camp 1/ }))
    await userEvent.click(await screen.findByRole('option', { name: "Women's Weekend" }))
    expect(onChange).toHaveBeenCalledWith('ww')
  })

  it('shows a label that is not one of the options', () => {
    // The weekend header reads "Loading weekends…" and "Weekend not found" in
    // the gaps where nothing is selected yet. The button text is the caller's
    // to decide, so it cannot be derived from the selected option.
    renderSwitcher({ label: 'Loading weekends…', value: '' })
    expect(screen.getByRole('button', { name: /Loading weekends…/ })).toBeInTheDocument()
  })

  it('carries the caller class onto the dropdown', async () => {
    // The two headers size their dropdowns differently — a weekend name is
    // longer than a session name. Passing the literal keeps Tailwind able to
    // see the class at build time.
    renderSwitcher({ optionsClassName: 'min-w-[220px]' })
    await userEvent.click(screen.getByRole('button', { name: /Family Camp 1/ }))
    expect(await screen.findByRole('listbox')).toHaveClass('min-w-[220px]')
  })
})
