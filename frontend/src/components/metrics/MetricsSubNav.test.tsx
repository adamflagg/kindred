/**
 * Tests for MetricsSubNav component
 * Secondary navigation following AreaFilterBar pattern
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { LayoutDashboard, Globe, Building2, Clock } from 'lucide-react'
import MetricsSubNav, { type SubNavItem } from './MetricsSubNav'
import { AuthContext } from '../../contexts/AuthContext'
import { createMockAuthContext, createMockUser } from '../../test/test-helpers'

const REGISTRATION_SUB_NAV: SubNavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    path: '/analytics/registration/overview',
  },
  {
    id: 'geo',
    label: 'Geographic',
    icon: Globe,
    path: '/analytics/registration/geo',
  },
  {
    id: 'synagogue',
    label: 'Synagogue',
    icon: Building2,
    path: '/analytics/registration/synagogue',
  },
  {
    id: 'waitlist',
    label: 'Waitlist',
    icon: Clock,
    path: '/analytics/registration/waitlist',
  },
]

const renderWithRouter = (
  initialPath: string,
  items: SubNavItem[] = REGISTRATION_SUB_NAV,
  userOverrides?: { is_admin?: boolean; cached_permissions?: string[] }
) => {
  const user = createMockUser(userOverrides ?? { is_admin: true })
  const ctx = createMockAuthContext({ user })

  return render(
    createElement(
      AuthContext.Provider,
      { value: ctx },
      <MemoryRouter initialEntries={[initialPath]}>
        <MetricsSubNav items={items} />
      </MemoryRouter>
    )
  )
}

describe('MetricsSubNav', () => {
  it('renders all provided sub-nav items', () => {
    renderWithRouter('/analytics/registration/overview')

    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /geographic/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /synagogue/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /waitlist/i })).toBeInTheDocument()
  })

  it('renders icons for each item', () => {
    renderWithRouter('/analytics/registration/overview')

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(4)

    links.forEach((link) => {
      const svg = link.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  it('highlights active item based on exact path match', () => {
    renderWithRouter('/analytics/registration/overview')

    const overviewLink = screen.getByRole('link', { name: /overview/i })
    const geoLink = screen.getByRole('link', { name: /geographic/i })

    expect(overviewLink).toHaveClass('bg-primary')
    expect(geoLink).not.toHaveClass('bg-primary')
  })

  it('highlights geo tab when on geo route', () => {
    renderWithRouter('/analytics/registration/geo')

    const geoLink = screen.getByRole('link', { name: /geographic/i })
    const overviewLink = screen.getByRole('link', { name: /overview/i })

    expect(geoLink).toHaveClass('bg-primary')
    expect(overviewLink).not.toHaveClass('bg-primary')
  })

  it('links to correct paths', () => {
    renderWithRouter('/analytics/registration/overview')

    expect(screen.getByRole('link', { name: /overview/i })).toHaveAttribute(
      'href',
      '/analytics/registration/overview'
    )
    expect(screen.getByRole('link', { name: /geographic/i })).toHaveAttribute(
      'href',
      '/analytics/registration/geo'
    )
    expect(screen.getByRole('link', { name: /synagogue/i })).toHaveAttribute(
      'href',
      '/analytics/registration/synagogue'
    )
    expect(screen.getByRole('link', { name: /waitlist/i })).toHaveAttribute(
      'href',
      '/analytics/registration/waitlist'
    )
  })

  it('renders segmented control container with proper styling', () => {
    renderWithRouter('/analytics/registration/overview')

    const container = screen.getByRole('navigation')
    // The inner div should have the segmented control styling
    const segmentedControl = container.querySelector('.rounded-xl')
    expect(segmentedControl).toBeInTheDocument()
  })

  it('uses nav element for accessibility', () => {
    renderWithRouter('/analytics/registration/overview')

    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })

  it('renders empty when no items provided', () => {
    renderWithRouter('/analytics/registration/overview', [])

    // Nav should still be present but empty
    const nav = screen.getByRole('navigation')
    expect(nav.querySelectorAll('a')).toHaveLength(0)
  })

  it('hides items requiring a permission the user lacks', () => {
    const itemsWithPermission: SubNavItem[] = [
      {
        id: 'overview',
        label: 'Overview',
        icon: LayoutDashboard,
        path: '/analytics/registration/overview',
      },
      {
        id: 'forecast',
        label: 'Forecast',
        icon: Clock,
        path: '/analytics/registration/forecast',
        permission: 'metrics.financial',
      },
    ]

    renderWithRouter('/analytics/registration/overview', itemsWithPermission, {
      is_admin: false,
      cached_permissions: [],
    })

    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /forecast/i })).not.toBeInTheDocument()
  })

  it('shows permission-gated items when user has the permission', () => {
    const itemsWithPermission: SubNavItem[] = [
      {
        id: 'overview',
        label: 'Overview',
        icon: LayoutDashboard,
        path: '/analytics/registration/overview',
      },
      {
        id: 'forecast',
        label: 'Forecast',
        icon: Clock,
        path: '/analytics/registration/forecast',
        permission: 'metrics.financial',
      },
    ]

    renderWithRouter('/analytics/registration/overview', itemsWithPermission, {
      is_admin: false,
      cached_permissions: ['metrics.financial'],
    })

    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /forecast/i })).toBeInTheDocument()
  })

  it('works with subset of items', () => {
    const twoItems: SubNavItem[] = [
      {
        id: 'overview',
        label: 'Overview',
        icon: LayoutDashboard,
        path: '/analytics/registration/overview',
      },
      {
        id: 'geo',
        label: 'Geographic',
        icon: Globe,
        path: '/analytics/registration/geo',
      },
    ]

    renderWithRouter('/analytics/registration/overview', twoItems)

    expect(screen.getAllByRole('link')).toHaveLength(2)
  })
})
