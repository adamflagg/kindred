/**
 * A fold line that opens in place (design-language rule 23; Season › Shown, not counted's "CampMinder aid on no
 * request", owner Q4-A): the line's label is a caret toggle, as the budget table's pool rows are, and opened, the row
 * under it holds a kit table whose rows carry their own actions (Add a Request…). No modal. Fictional rows.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AidTable } from './AidTable'
import { CS_FOLD_PANEL } from './csType'
import { AidFoldPanel, AidFoldToggle } from './FoldRow'
import { DETAIL_ROW } from './kitStyles'
import { aidActionColumn } from './RowAction'

interface Fam {
  id: string
  family: string
}
const FAMS: Fam[] = [
  { id: 'f1', family: 'Lucas Garcia' },
  { id: 'f2', family: 'Mila Chen' },
]

function Harness({ onAdd }: { onAdd: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <MemoryRouter>
      <table>
        <tbody>
          <tr data-line="cm">
            <td>
              <AidFoldToggle open={open} onToggle={() => setOpen((o) => !o)}>
                CampMinder aid on no request
              </AidFoldToggle>
            </td>
            <td>2 fam</td>
            <td>$2,608</td>
            <td>posted in CampMinder, on no request</td>
          </tr>
          {open && (
            <AidFoldPanel span={4}>
              <AidTable<Fam>
                hideToolbar
                rows={FAMS}
                rowKey={(r) => r.id}
                csvFilename="x.csv"
                columns={[
                  { key: 'family', header: 'Family', value: (r) => r.family },
                  aidActionColumn<Fam>({
                    width: 132,
                    action: (r) => ({ label: 'Add a Request…', onClick: () => onAdd(r.id) }),
                  }),
                ]}
              />
            </AidFoldPanel>
          )}
          <tr data-line="held">
            <td>Held requests</td>
          </tr>
        </tbody>
      </table>
    </MemoryRouter>
  )
}

describe('AidFoldToggle', () => {
  it('is the pool row grammar: a muted caret, then the bold label, one button that says whether it is open', () => {
    render(<Harness onAdd={() => {}} />)
    const toggle = screen.getByRole('button', { name: /CampMinder aid on no request/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('▸')
    expect(toggle.querySelector('b')).toHaveTextContent('CampMinder aid on no request')
    const caret = toggle.querySelector('span') as HTMLElement
    expect(caret).toHaveClass('text-muted-foreground', 'text-[10px]')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveTextContent('▾')
  })
})

describe('AidFoldPanel', () => {
  it('opens in place: the row straight under the line, one cell across the table', () => {
    render(<Harness onAdd={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /CampMinder aid on no request/ }))
    const panel = document.querySelector('tr[data-aid-fold-panel]') as HTMLElement
    expect(panel.previousElementSibling).toHaveAttribute('data-line', 'cm')
    expect(panel.nextElementSibling).toHaveAttribute('data-line', 'held')
    const cells = panel.querySelectorAll(':scope > td')
    expect(cells).toHaveLength(1)
    expect(cells[0]).toHaveAttribute('colspan', '4')
    expect(cells[0]?.className).toBe(CS_FOLD_PANEL)
  })

  it("wears the opened row's cream, unclipped, inset under the label", () => {
    expect(CS_FOLD_PANEL).toContain(DETAIL_ROW.split(' ')[0] as string)
    for (const c of [
      'overflow-visible',
      'whitespace-normal',
      'pl-[34px]',
      'border-amber-300',
      'dark:border-amber-800',
    ])
      expect(CS_FOLD_PANEL).toContain(c)
  })

  it('holds a kit table whose rows carry their own action', () => {
    const onAdd = vi.fn()
    render(<Harness onAdd={onAdd} />)
    fireEvent.click(screen.getByRole('button', { name: /CampMinder aid on no request/ }))
    const panel = document.querySelector('tr[data-aid-fold-panel]') as HTMLElement
    const row = panel.querySelector('tr[data-row-key="f2"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Add a Request…' }))
    expect(onAdd).toHaveBeenCalledWith('f2')
    // the nested table brings no toolbar of its own: the section's head row has Download CSV
    expect(within(panel).queryByRole('button', { name: /Download CSV/ })).toBeNull()
  })
})
