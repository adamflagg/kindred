/**
 * The editor layout (design-language §24; kit .cf-form2 / .cf-fgrid / .cf-edrow): an editor is wide
 * and short. Fields sit in a two-column grid (label · field · label · field); dependent choices go in
 * the right column, shown switched off rather than hidden; the Title Case buttons sit on one row with
 * the required-field reason beside them.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EditorActions, EditorField, EditorForm, EditorGrid } from './EditorLayout'

describe('EditorForm', () => {
  it('puts the fields left and the dependent choices right, in two columns', () => {
    render(
      <EditorForm
        title="New Funder"
        side={<label>Covers the canteen deposit</label>}
        actions={<button type="button">Save Funder</button>}
      >
        <span>fields</span>
      </EditorForm>
    )
    const form = screen.getByTestId('aid-editor-form')
    expect(form).toHaveClass('grid', 'grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')
    expect(screen.getByText('New Funder')).toBeInTheDocument()
  })

  it('takes one column when nothing depends on the fields', () => {
    render(
      <EditorForm actions={<button type="button">Save</button>}>
        <span>fields</span>
      </EditorForm>
    )
    expect(screen.getByTestId('aid-editor-form')).not.toHaveClass('grid')
  })
})

describe('EditorGrid and EditorField', () => {
  it('lays label · field · label · field, four columns by default and two when asked', () => {
    const { rerender } = render(
      <EditorGrid>
        <EditorField label="Name">
          <input aria-label="Name" />
        </EditorField>
      </EditorGrid>
    )
    expect(screen.getByTestId('aid-editor-grid')).toHaveClass(
      'grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)]'
    )
    rerender(
      <EditorGrid columns={2}>
        <EditorField label="Name">
          <input aria-label="Name" />
        </EditorField>
      </EditorGrid>
    )
    expect(screen.getByTestId('aid-editor-grid')).toHaveClass(
      'grid-cols-[max-content_minmax(0,1fr)]'
    )
  })

  it('dims the label of a field that is switched off, keeping it on screen', () => {
    render(
      <EditorGrid>
        <EditorField label="Pays the rest" off>
          <input aria-label="Pays the rest" disabled />
        </EditorField>
      </EditorGrid>
    )
    expect(screen.getByText('Pays the rest')).toHaveClass('opacity-50')
    expect(screen.getByLabelText('Pays the rest')).toBeDisabled()
  })
})

describe('EditorActions', () => {
  it('keeps the buttons and the reason on one row', () => {
    render(
      <EditorActions reason="A name is needed">
        <button type="button">Save Funder</button>
        <button type="button">Back</button>
      </EditorActions>
    )
    const row = screen.getByRole('button', { name: 'Save Funder' }).parentElement
    expect(row).toHaveClass('flex', 'flex-nowrap')
    expect(screen.getByText('A name is needed')).toHaveAttribute('title', 'A name is needed')
  })
  it('is not held to the toolbar status’s 340px: an editor row has the room', () => {
    render(
      <EditorActions reason="Each part lands on its request in full, or nothing is written · one logged operation">
        <button type="button">Place It</button>
      </EditorActions>
    )
    const reason = screen.getByText(/^Each part lands on its request in full/)
    expect(reason).toHaveClass('max-w-none')
    expect(reason).not.toHaveClass('max-w-[340px]')
  })
})

// ux3 to-place-3: an editor whose final mock draws a .cf-phead head asks for it; the rest keep the card heading.
describe('EditorForm heading', () => {
  it('is the uppercase panel head when asked, the card heading otherwise', () => {
    const { rerender } = render(
      <EditorForm title="Split $600" heading="phead">
        <span>fields</span>
      </EditorForm>
    )
    expect(screen.getByText('Split $600')).toHaveClass(
      'uppercase',
      'text-[11px]',
      'tracking-[.05em]'
    )
    rerender(
      <EditorForm title="Edit plan">
        <span>fields</span>
      </EditorForm>
    )
    expect(screen.getByText('Edit plan')).not.toHaveClass('uppercase')
  })
})

// Owner, 10-10 evening (editors.html option 3, scoped by a rule): "white on not white, and green on
// white". ONE card: `onWhite` swaps only the colour classes for the band tint; nothing else may differ.
describe('EditorForm onWhite', () => {
  const classesOf = (onWhite: boolean) => {
    const { container, unmount } = render(
      <EditorForm onWhite={onWhite} title="Cost">
        <span>fields</span>
      </EditorForm>
    )
    const classes = new Set((container.firstElementChild as HTMLElement).className.split(/\s+/))
    unmount()
    return classes
  }
  const COLOUR = /^(dark:)?(bg|border(-[trbl])?)-(card|border|\[color-mix\(.*\)\])$/

  it('is the white kit card by default, and takes the band tint on a white surface', () => {
    const white = classesOf(false)
    const tinted = classesOf(true)
    expect(white.has('bg-card')).toBe(true)
    expect(tinted.has('bg-card')).toBe(false)
    expect(
      [...tinted].some((c) => c.startsWith('bg-[color-mix(in_oklab,var(--color-forest-200)'))
    ).toBe(true)
    // Its edge is the band's edge colour on all four sides (option 3 draws a full green-grey border).
    expect(
      [...tinted].some((c) => c.startsWith('border-[color-mix(in_oklab,var(--color-forest-700)'))
    ).toBe(true)
  })

  it('differs from the default ONLY in colour classes: the shape, padding and layout are the same', () => {
    const white = classesOf(false)
    const tinted = classesOf(true)
    const onlyWhite = [...white].filter((c) => !tinted.has(c))
    const onlyTinted = [...tinted].filter((c) => !white.has(c))
    expect(onlyWhite.length).toBeGreaterThan(0)
    expect(onlyTinted.length).toBeGreaterThan(0)
    for (const c of [...onlyWhite, ...onlyTinted]) expect(c).toMatch(COLOUR)
    // and the shared part carries the whole shape
    for (const c of [
      'flex',
      'flex-col',
      'gap-1.5',
      'self-stretch',
      'rounded-[10px]',
      'border',
      'px-2.5',
      'py-2',
    ])
      expect(white.has(c) && tinted.has(c)).toBe(true)
  })
})
