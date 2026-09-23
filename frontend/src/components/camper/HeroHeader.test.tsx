import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { Camper } from '../../types/app-types'
import { HeroHeader } from './HeroHeader'

const camper = {
  id: '3000001:s1',
  name: 'Emma Johnson',
  first_name: 'Emma',
  last_name: 'Johnson',
  person_cm_id: 3000001,
  gender: 'F',
  grade: 0,
  age: 43.01,
  years_at_camp: 0,
} as unknown as Camper

function renderHero(extra: Partial<Parameters<typeof HeroHeader>[0]> = {}) {
  return render(
    <MemoryRouter>
      <HeroHeader
        camper={camper}
        currentYear={2026}
        location={null}
        sessionShortName="WW"
        pronouns="she/her"
        journeyCounts={{ summers: 0, familyWeekends: 0, adultWeekends: 5 }}
        {...extra}
      />
    </MemoryRouter>
  )
}

describe('HeroHeader count line', () => {
  it('shows the shared label instead of "years at camp"', () => {
    renderHero()
    expect(screen.getByText('5 adult weekends')).toBeInTheDocument()
    expect(screen.queryByText(/years at camp/)).toBeNull()
  })

  // Q11 (owner, 2026-09-22 late) trims only the summer board modal's line to
  // summers; the full camper record keeps every part.
  it('keeps the whole line — summers AND weekends — on the full record', () => {
    renderHero({ journeyCounts: { summers: 5, familyWeekends: 3, adultWeekends: 0 } })
    expect(screen.getByText('5 summers · 3 family weekends')).toBeInTheDocument()
  })

  it('hides the stat when every count is zero', () => {
    const { container } = renderHero({
      journeyCounts: { summers: 0, familyWeekends: 0, adultWeekends: 0 },
    })
    expect(screen.queryByText(/weekend|summer/)).toBeNull()
    // The whole stat is gone, not just its text: TreePine appears in the hero
    // only on this stat, so an empty span beside a bare icon would fail here.
    expect(container.querySelector('.lucide-tree-pine')).toBeNull()
  })
})

describe('HeroHeader adult branch', () => {
  it('drops the grade for an adult-program person', () => {
    renderHero({ isAdultProgram: true })
    expect(screen.queryByText(/Grade/)).toBeNull()
  })

  it('keeps the grade for everyone else', () => {
    renderHero({ camper: { ...camper, grade: 5, grade_name: '5th', age: 10.04 } })
    expect(screen.getByText(/5th Grade/)).toBeInTheDocument()
  })
})

// kindred#2779: the hero reads `grade_name`, never the number.
describe('HeroHeader grade name', () => {
  it('shows a kindergartner as K, not "0th"', () => {
    renderHero({ camper: { ...camper, grade: 0, grade_name: 'K', age: 5.06 } })
    expect(screen.getByText(/• K$/)).toBeInTheDocument()
    expect(screen.queryByText(/0th/)).toBeNull()
  })

  it('shows a preschooler as Pre-K, never "-1th"', () => {
    renderHero({ camper: { ...camper, grade: -1, grade_name: 'Pre-K', age: 4.02 } })
    expect(screen.getByText(/• Pre-K$/)).toBeInTheDocument()
    expect(screen.queryByText(/-1th/)).toBeNull()
  })

  it('hides a stale grade on someone 21 or older', () => {
    renderHero({ camper: { ...camper, grade: 6, grade_name: '6th', age: 23.06 } })
    expect(screen.queryByText(/6th/)).toBeNull()
  })

  it('shows no grade when there is no grade name', () => {
    renderHero({ camper: { ...camper, grade: 0, grade_name: '', age: 43.01 } })
    expect(screen.queryByText(/Grade|0th/)).toBeNull()
  })
})

// Quest option A (owner ruling 2026-09-23): CampMinder's "bunk" for a Quest
// enrollment is the trip name, not a cabin. The hero used to show it exactly
// like a real cabin — Home icon, link to the session board. Keep the text
// and the link (the board link is still useful), drop the icon, so it reads
// as the trip/group rather than housing.
describe('HeroHeader cabin/trip chip (Quest option A)', () => {
  it('shows the Home icon and a board link for a summer cabin', () => {
    const mainCamper = {
      ...camper,
      expand: {
        session: { name: 'Session 1', session_type: 'main' },
        assigned_bunk: { name: 'Cabin 3' },
      },
    } as unknown as Camper
    const { container } = renderHero({ camper: mainCamper })

    expect(container.querySelector('.lucide-home')).not.toBeNull()
    expect(screen.getByText('Cabin 3')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cabin 3' })).toHaveAttribute(
      'href',
      expect.stringContaining('/board')
    )
  })

  it('shows the trip name without the Home icon for a Quest enrollment', () => {
    const questCamper = {
      ...camper,
      expand: {
        session: { name: 'Session 900', session_type: 'quest' },
        assigned_bunk: { name: 'Sierra Slam' },
      },
    } as unknown as Camper
    const { container } = renderHero({ camper: questCamper })

    expect(container.querySelector('.lucide-home')).toBeNull()
    expect(screen.getByText(/Sierra Slam/)).toBeInTheDocument()
    // The board link is kept — only the cabin styling (Home icon) is dropped.
    expect(screen.getByRole('link', { name: /Sierra Slam/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/board')
    )
    expect(screen.queryByText('(unassigned)')).toBeNull()
  })

  it('shows one Home icon for a real cabin and none for a Quest trip among multiple enrollments', () => {
    const mainEc = {
      ...camper,
      id: 'ec-main',
      expand: {
        session: { name: 'Session 1', session_type: 'main' },
        assigned_bunk: { name: 'Cabin 3' },
      },
    } as unknown as Camper
    const questEc = {
      ...camper,
      id: 'ec-quest',
      expand: {
        session: { name: 'Session 900', session_type: 'quest' },
        assigned_bunk: { name: 'Sierra Slam' },
      },
    } as unknown as Camper
    const { container } = renderHero({ enrolledCampers: [mainEc, questEc] })

    expect(container.querySelectorAll('.lucide-home')).toHaveLength(1)
    expect(screen.getByText('Cabin 3')).toBeInTheDocument()
    expect(screen.getByText(/Sierra Slam/)).toBeInTheDocument()
  })
})
