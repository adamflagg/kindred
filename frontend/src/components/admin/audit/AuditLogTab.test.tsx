/**
 * The Audit Log tab: rows as one line each, the Sign-ins chip and type buttons
 * driving the URL, "show all N", the empty state and the pager. The data hooks
 * are mocked; useAuditLog.test.tsx covers the network.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuditEntry, AuditPage, AuditQuery } from '../../../types/auditLog'

let lastQuery: AuditQuery | null = null
let page: AuditPage = { items: [], page: 1, per_page: 10, total: 0 }
vi.mock('../../../hooks/useAuditLog', () => ({
  useAuditLog: (query: AuditQuery) => {
    lastQuery = query
    return { isLoading: false, error: null, data: page }
  },
  useAuditLogActors: () => ({
    data: { actors: [{ email: 'alex.rivera@example.com', name: 'Alex Rivera' }] },
  }),
}))

import { AuditLogTab } from './AuditLogTab'

function entry(overrides: Partial<AuditEntry>): AuditEntry {
  return {
    id: `r${Math.random().toString(36).slice(2, 16)}`,
    created: '2026-09-25T16:20:07Z',
    type: 'settings',
    action: 'update',
    actor_kind: 'user',
    actor_email: 'alex.rivera@example.com',
    actor_name: 'Alex Rivera',
    fields: [],
    ip: '10.0.20.5',
    ...overrides,
  }
}

function Location() {
  const location = useLocation()
  return <div data-testid="location">{location.search}</div>
}

function renderTab(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/manage/audit${search}`]}>
      <AuditLogTab />
      <Location />
    </MemoryRouter>
  )
}

const url = () => screen.getByTestId('location').textContent

beforeEach(() => {
  lastQuery = null
  page = { items: [], page: 1, per_page: 10, total: 0 }
})

describe('AuditLogTab', () => {
  it('shows each entry as one line: when, who, type, what happened', () => {
    page = {
      items: [
        entry({
          type: 'roles',
          action: 'update',
          collection: 'roles',
          target_label: 'Finance',
          fields: ['permissions'],
          before: { permissions: ['financial_aid.view'] },
          after: { permissions: ['financial_aid.view', 'financial_aid.rules'] },
        }),
        entry({
          type: 'pb_admin',
          action: 'update',
          collection: 'config',
          record_id: 'k3j9x2m1q8r4t7w',
          target_label: 'solver.max_cabin_size',
          fields: ['value'],
          before: { value: 12 },
          after: { value: 14 },
        }),
        // Controller ruling: a user_roles grant is type `access`.
        entry({
          type: 'access',
          collection: 'user_roles',
          action: 'create',
          target_label: 'Sam Patel',
          detail: { role: 'Registrar' },
        }),
      ],
      page: 1,
      per_page: 10,
      total: 3,
    }
    renderTab()
    const [roleRow, pbRow, accessRow, ...rest] = screen.getAllByTestId('audit-row')
    if (!roleRow || !pbRow || !accessRow) throw new Error('want three rows')
    expect(rest).toHaveLength(0)
    expect(within(roleRow).getByText('Roles')).toBeTruthy()
    expect(roleRow.textContent).toContain('edited the Finance role')
    expect(within(roleRow).getByText('Alex Rivera')).toBeTruthy()
    expect(roleRow.querySelector('td')?.getAttribute('title')).toMatch(/:07 · IP 10\.0\.20\.5$/)
    // PB Admin rows name the collection and record id under the sentence.
    expect(pbRow.textContent).toContain('config k3j9x2m1q8r4t7w')
    // A role grant is an Access row, not Roles.
    expect(within(accessRow).getByText('Access')).toBeTruthy()
    expect(accessRow.textContent).toContain('gave Sam Patel a role')
    expect(accessRow.querySelectorAll('td')[5]?.textContent).toContain('Registrar')
    expect(screen.getByText('3 events')).toBeTruthy()
  })

  it('hides sign-ins until the chip is on, and the chip lives in the URL', () => {
    renderTab()
    expect(lastQuery?.signIns).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Sign-ins' }))
    expect(url()).toBe('?signins=1')
    expect(lastQuery?.signIns).toBe(true)
  })

  it('a type button filters to one type and goes back to page 1', () => {
    renderTab('?page=3')
    fireEvent.click(screen.getByRole('button', { name: 'PB Admin' }))
    expect(url()).toBe('?type=pb_admin')
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(url()).toBe('')
  })

  it('the person picker lists the actors and filters by email', () => {
    renderTab()
    fireEvent.change(screen.getByRole('combobox', { name: 'Person' }), {
      target: { value: 'alex.rivera@example.com' },
    })
    expect(url()).toBe('?actor=alex.rivera%40example.com')
  })

  it('shows three changed fields inline, then "show all N"', () => {
    const fields = ['beds', 'code', 'name', 'notes']
    page = {
      items: [
        entry({
          collection: 'lodging_units',
          target_label: 'Cabin 14',
          fields,
          before: { beds: 8, code: 'c14', name: 'Cabin 14', notes: '' },
          after: { beds: 10, code: 'c-14', name: 'Cabin Fourteen', notes: 'Two cabins added' },
        }),
      ],
      page: 1,
      per_page: 10,
      total: 1,
    }
    renderTab()
    expect(screen.queryByText('Two cabins added')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'show all 4' }))
    expect(screen.getByText('Two cabins added')).toBeTruthy()
  })

  // A long sentence (spaces, no single unbroken token) — the "SUPER TALL row" case.
  const LONG_SENTENCE =
    'This penalty applies whenever a cabin drops below the configured minimum ' +
    'occupancy threshold for its session and age group, which the solver checks twice.'
  // A long unbroken token — the "MASSIVELY wide row" case.
  const LONG_UNBROKEN = 'x'.repeat(150)

  function longValueEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
    return entry({
      collection: 'config',
      target_label: 'constraint.cabin_minimum_occupancy.penalty',
      fields: ['value'],
      before: { value: 'a short before value' },
      after: { value: LONG_SENTENCE },
      ...overrides,
    })
  }

  it('a long value renders clamped, with a "full value" control', () => {
    page = { items: [longValueEntry()], page: 1, per_page: 10, total: 1 }
    renderTab()
    expect(screen.getByRole('button', { name: 'full value' })).toBeTruthy()
  })

  it('a clamped value keeps the display line-clamp needs (no `block`, which overrides -webkit-box)', () => {
    page = { items: [longValueEntry()], page: 1, per_page: 10, total: 1 }
    renderTab()
    const clamped = screen.getByText(LONG_SENTENCE)
    expect(clamped.className).toContain('line-clamp-3')
    expect(clamped.className.split(/\s+/)).not.toContain('block')
  })

  it('a long actor truncates in its column, with the full name on hover', () => {
    page = {
      items: [
        longValueEntry({ actor_name: '', actor_email: 'a.very.long.reviewer.address@example.com' }),
      ],
      page: 1,
      per_page: 10,
      total: 1,
    }
    renderTab()
    const who = screen.getByText('a.very.long.reviewer.address@example.com')
    expect(who.className.split(/\s+/)).toContain('truncate')
    expect(who.getAttribute('title')).toBe('a.very.long.reviewer.address@example.com')
  })

  it('a short value renders with no control', () => {
    page = {
      items: [
        entry({
          collection: 'config',
          target_label: 'solver.max_cabin_size',
          fields: ['value'],
          before: { value: 12 },
          after: { value: 14 },
        }),
      ],
      page: 1,
      per_page: 10,
      total: 1,
    }
    renderTab()
    expect(screen.queryByRole('button', { name: 'full value' })).toBeNull()
  })

  it('clicking the control shows the full text of both before and after', () => {
    page = { items: [longValueEntry()], page: 1, per_page: 10, total: 1 }
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'full value' }))
    expect(screen.getByTestId('audit-full-before').textContent).toBe('a short before value')
    expect(screen.getByTestId('audit-full-after').textContent).toBe(LONG_SENTENCE)
  })

  it('names the field and the row’s sentence in the full-value title', () => {
    page = { items: [longValueEntry()], page: 1, per_page: 10, total: 1 }
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'full value' }))
    expect(screen.getByRole('heading').textContent).toContain('value')
    expect(screen.getByRole('heading').textContent).toContain('changed the setting')
  })

  it('JSON pretty-prints in the full view', () => {
    const obj = { threshold: 4, note: 'x'.repeat(150) }
    page = {
      items: [longValueEntry({ before: { value: null }, after: { value: obj } })],
      page: 1,
      per_page: 10,
      total: 1,
    }
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'full value' }))
    expect(screen.getByTestId('audit-full-after').textContent).toBe(JSON.stringify(obj, null, 2))
  })

  it('a long unbroken value gets the wrap-anywhere class', () => {
    page = {
      items: [longValueEntry({ after: { value: LONG_UNBROKEN } })],
      page: 1,
      per_page: 10,
      total: 1,
    }
    renderTab()
    const row = screen.getByTestId('audit-row')
    const valueSpan = within(row).getByText(LONG_UNBROKEN)
    expect(valueSpan.className).toContain('[overflow-wrap:anywhere]')
  })

  it('says so when nothing matches', () => {
    renderTab('?q=nobody')
    expect(screen.getByText('No events match.')).toBeTruthy()
  })

  it('pages through the URL', () => {
    page = { items: [entry({})], page: 1, per_page: 10, total: 42 }
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Older →' }))
    expect(url()).toBe('?page=2')
    fireEvent.change(screen.getByRole('combobox', { name: /Rows per page/ }), {
      target: { value: '25' },
    })
    expect(url()).toBe('?per=25')
  })

  it('reads a linked view from the URL', () => {
    renderTab('?q=Cabin&type=settings&signins=1&page=2&per=15')
    expect(lastQuery).toEqual({
      q: 'Cabin',
      types: ['settings'],
      actor: '',
      signIns: true,
      page: 2,
      perPage: 15,
    })
    expect(screen.getByRole('searchbox')).toHaveProperty('value', 'Cabin')
  })
})
