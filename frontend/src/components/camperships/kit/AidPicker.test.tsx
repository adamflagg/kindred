/**
 * AidPicker (design-language §3; kit .cf-picker / CF.picker / CF.pickerMulti): every select in
 * Camperships is this white stylized picker, a Headless UI Listbox. A toolbar picker is 26px at
 * 12.5px on card white; inside an editor (`size="field"`) it is 30px at 13.5px. A multi-choice
 * picker names its picks while they fit and counts them past that, with every name in the title.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { AidPicker, AidPickerMulti } from './AidPicker'
import { multiPickerWords, type AidPickerOption } from './pickerWords'

const PROGRAMS: ReadonlyArray<AidPickerOption<string>> = [
  { value: 'all', label: 'All' },
  { value: 'summer', label: 'Summer', group: 'Camp & Quest' },
  { value: 'quest', label: 'Quest', group: 'Camp & Quest' },
  { value: 'family', label: 'Family Camp', group: 'Weekend' },
]

function Single({ onChange = vi.fn() }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState('all')
  return (
    <AidPicker
      label="Program"
      value={value}
      options={PROGRAMS}
      onChange={(v) => {
        setValue(v)
        onChange(v)
      }}
    />
  )
}

describe('AidPicker (single)', () => {
  it('shows the picked label on a white, 26px, 12.5px button with a chevron', () => {
    render(<Single />)
    const button = screen.getByRole('button', { name: /Program/ })
    expect(button).toHaveTextContent('All')
    expect(button).toHaveClass('bg-card', 'h-[26px]', 'text-[12.5px]')
    expect(button.querySelector('svg')).not.toBeNull()
  })

  it('opens a white card list with group headings and a tick on the picked option', async () => {
    render(<Single />)
    await userEvent.click(screen.getByRole('button', { name: /Program/ }))
    const list = screen.getByRole('listbox')
    expect(list).toHaveClass('bg-card')
    expect(screen.getByText('Camp & Quest')).toBeInTheDocument()
    expect(screen.getByText('Weekend')).toBeInTheDocument()
    const picked = screen.getByRole('option', { name: /All/ })
    expect(picked).toHaveTextContent('✓')
    expect(screen.getByRole('option', { name: /Summer/ })).not.toHaveTextContent('✓')
  })

  it('picks an option and reads it on the button', async () => {
    const onChange = vi.fn()
    render(<Single onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Program/ }))
    await userEvent.click(screen.getByRole('option', { name: /Family Camp/ }))
    expect(onChange).toHaveBeenCalledWith('family')
    expect(screen.getByRole('button', { name: /Program/ })).toHaveTextContent('Family Camp')
  })

  it('carries the picked label as the button title, so a cut label reads whole', () => {
    render(<AidPicker label="Program" value="family" options={PROGRAMS} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Program/ })).toHaveAttribute('title', 'Family Camp')
  })

  it('is 30px at 13.5px inside an editor (size="field")', () => {
    render(
      <AidPicker label="Program" size="field" value="all" options={PROGRAMS} onChange={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: /Program/ })).toHaveClass('h-[30px]', 'text-[13.5px]')
  })

  it('can be switched off', () => {
    render(<AidPicker label="Program" disabled value="all" options={PROGRAMS} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Program/ })).toBeDisabled()
  })
})

const GROUPS: ReadonlyArray<AidPickerOption<string>> = [
  { value: 'cq', label: 'Camp & Quest' },
  { value: 'tbm', label: 'TBM' },
  { value: 'wk', label: 'Weekend Programs' },
]

function Multi({ start = [] as string[] }) {
  const [values, setValues] = useState<string[]>(start)
  return (
    <AidPickerMulti
      label="Reporting group"
      values={values}
      options={GROUPS}
      noun="groups"
      none="Needs a group"
      onChange={setValues}
    />
  )
}

describe('AidPickerMulti (rev1: "the funds reporting group picker needs to support multi select")', () => {
  it('names the picks while they fit, else counts them; nothing picked reads its none words', () => {
    expect(multiPickerWords([], GROUPS, 'groups', 'Needs a group')).toBe('Needs a group')
    expect(multiPickerWords(['cq', 'tbm'], GROUPS, 'groups', 'Needs a group')).toBe(
      'Camp & Quest, TBM'
    )
    expect(multiPickerWords(['cq', 'tbm', 'wk'], GROUPS, 'groups', 'Needs a group')).toBe(
      '3 groups'
    )
  })

  it('draws a checkbox per option and stays open while staff check several', async () => {
    render(<Multi />)
    const button = screen.getByRole('button', { name: /Reporting group/ })
    expect(button).toHaveTextContent('Needs a group')
    await userEvent.click(button)
    await userEvent.click(screen.getByRole('option', { name: /Camp & Quest/ }))
    await userEvent.click(screen.getByRole('option', { name: /TBM/ }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(button).toHaveTextContent('Camp & Quest, TBM')
    expect(button).toHaveAttribute('title', 'Camp & Quest, TBM')
  })

  it('counts past the room, with every name still in the title', () => {
    render(<Multi start={['cq', 'tbm', 'wk']} />)
    const button = screen.getByRole('button', { name: /Reporting group/ })
    expect(button).toHaveTextContent('3 groups')
    expect(button).toHaveAttribute('title', 'Camp & Quest, TBM, Weekend Programs')
  })
})

// Requests' Program picker (mock PROG_OPTS): a pool is a pickable bold heading, its programs indented.
describe('AidPickerMulti face words (Scenarios: "Columns · 5")', () => {
  it('reads the caller’s own words on the button, the picks still in the title', () => {
    render(
      <AidPickerMulti
        label="Columns"
        values={['cq', 'tbm']}
        options={GROUPS}
        noun="columns"
        none="Columns"
        faceText="Columns · 2"
        onChange={vi.fn()}
      />
    )
    const button = screen.getByRole('button', { name: /^Columns/ })
    expect(button).toHaveTextContent('Columns · 2')
    expect(button).toHaveAttribute('title', 'Camp & Quest, TBM')
  })
})

describe('AidPicker option levels', () => {
  it('draws a heading option bold and an indented one pushed in', async () => {
    render(
      <AidPicker
        label="Program"
        value="all"
        onChange={() => undefined}
        options={[
          { value: 'all', label: 'All programs' },
          { value: 'pool:cq', label: 'Camp & Quest', level: 'heading' },
          { value: 'summer', label: 'Summer', level: 'indent' },
        ]}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /Program/ }))
    expect(screen.getByRole('option', { name: /Camp & Quest/ })).toHaveClass('font-bold')
    expect(screen.getByRole('option', { name: /Summer/ }).style.paddingLeft).toBe('34px')
    expect(screen.getByRole('option', { name: /All programs/ })).not.toHaveClass('font-bold')
  })
})

describe('AidPicker placeholder', () => {
  it('reads the placeholder while the value matches no option', () => {
    render(
      <AidPicker
        label="Add a session"
        value=""
        placeholder="Add a session"
        options={PROGRAMS}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Add a session: Add a session' })).toHaveTextContent(
      'Add a session'
    )
  })
})
