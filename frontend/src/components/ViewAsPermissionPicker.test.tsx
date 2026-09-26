import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ViewAsPermissionPicker } from './ViewAsPermissionPicker'
import { groupPermissions } from '../utils/permissionFamilies'

const ALL = [
  'bunking.manage',
  'financial_aid.casework',
  'financial_aid.rules',
  'financial_aid.summary',
  'financial_aid.view',
  'metrics.financial',
  'metrics.geo',
  'sheets.export',
]
const AID = [
  'financial_aid.casework',
  'financial_aid.rules',
  'financial_aid.summary',
  'financial_aid.view',
]

describe('groupPermissions', () => {
  it('groups codenames by the family before the dot, keeping order', () => {
    expect(groupPermissions(ALL)).toEqual([
      { family: 'bunking', permissions: ['bunking.manage'] },
      { family: 'financial_aid', permissions: AID },
      { family: 'metrics', permissions: ['metrics.financial', 'metrics.geo'] },
      { family: 'sheets', permissions: ['sheets.export'] },
    ])
  })
})

describe('ViewAsPermissionPicker', () => {
  const renderPicker = (selected: string[], onChange = vi.fn()) => {
    render(<ViewAsPermissionPicker all={ALL} selected={selected} onChange={onChange} />)
    return onChange
  }

  it('shows a single-permission family as one full-codename row', () => {
    renderPicker([])
    expect(screen.getByLabelText('bunking.manage')).toBeTruthy()
    expect(screen.queryByLabelText('bunking')).toBeNull()
  })

  it('shows a multi-permission family as a parent with short child labels', () => {
    renderPicker([])
    expect(screen.getByLabelText('financial_aid')).toBeTruthy()
    expect(screen.getByLabelText('casework')).toBeTruthy()
    expect(screen.getByLabelText('view')).toBeTruthy()
  })

  it('ticking the parent selects every permission in the family', () => {
    const onChange = renderPicker(['sheets.export'])
    fireEvent.click(screen.getByLabelText('financial_aid'))
    expect(onChange).toHaveBeenCalledWith([
      'financial_aid.casework',
      'financial_aid.rules',
      'financial_aid.summary',
      'financial_aid.view',
      'sheets.export',
    ])
  })

  it('unticking a fully-selected parent clears the whole family', () => {
    const onChange = renderPicker([...AID, 'sheets.export'])
    const parent = screen.getByLabelText<HTMLInputElement>('financial_aid')
    expect(parent.checked).toBe(true)
    fireEvent.click(parent)
    expect(onChange).toHaveBeenCalledWith(['sheets.export'])
  })

  it('shows a partly-selected family as indeterminate, and ticking it fills the family', () => {
    const onChange = renderPicker(['financial_aid.view'])
    const parent = screen.getByLabelText<HTMLInputElement>('financial_aid')
    expect(parent.checked).toBe(false)
    expect(parent.indeterminate).toBe(true)
    fireEvent.click(parent)
    expect(onChange).toHaveBeenCalledWith(AID)
  })

  it('toggles a single child on its own', () => {
    const onChange = renderPicker(['financial_aid.view'])
    fireEvent.click(screen.getByLabelText('rules'))
    expect(onChange).toHaveBeenCalledWith(['financial_aid.rules', 'financial_aid.view'])
  })

  it('is one scrollable column, so it cannot overflow the menu sideways', () => {
    renderPicker([])
    const list = screen.getByTestId('view-as-permission-picker')
    expect(list.className).toContain('overflow-y-auto')
    expect(list.className).not.toContain('grid-cols-2')
  })
})
