/**
 * Test handles for the kit's AidPicker (design-language §3), the Camperships select. Its button reads
 * "<label>: <shown>" to a test, so a picker is found by its label alone, and what it shows is read
 * from that name. Options render only while the list is open.
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const nameOf = (label: string) => new RegExp(`^${escape(label)}: `)

/** The picker labelled `label` (its button), within `scope` when given. */
export function aidPicker(label: string, scope?: HTMLElement): HTMLElement {
  return (scope ? within(scope) : screen).getByRole('button', { name: nameOf(label) })
}

/** The picker labelled `label`, or null when none is on screen. */
export function queryAidPicker(label: string, scope?: HTMLElement): HTMLElement | null {
  return (scope ? within(scope) : screen).queryByRole('button', { name: nameOf(label) })
}

/** What the picker shows: the picked option's label, or its placeholder. */
export function aidPicked(label: string, scope?: HTMLElement): string {
  const name = aidPicker(label, scope).getAttribute('aria-label') ?? ''
  return name.slice(label.length + 2)
}

/** Open the picker and pick the option named `option`. */
export async function chooseAid(label: string, option: string | RegExp, scope?: HTMLElement) {
  await userEvent.click(aidPicker(label, scope))
  await userEvent.click(screen.getByRole('option', { name: option }))
}

/** Open the picker, read its options' labels in order (the ✓ on the picked one dropped), and close it. */
export async function aidOptions(label: string, scope?: HTMLElement): Promise<string[]> {
  await userEvent.click(aidPicker(label, scope))
  const labels = screen.getAllByRole('option').map((o) => o.textContent.replace('✓', ''))
  await userEvent.click(aidPicker(label, scope))
  return labels
}
