/**
 * Tests for BunkingLegend component.
 *
 * Pins the contract between what the bunking board renders and what the legend
 * documents. Each icon-key that CamperCard or BunkCard can render must have a
 * corresponding entry in the legend. This test fails if someone adds a new
 * indicator without updating the legend.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import BunkingLegend, { WeekendLegendButton } from './BunkingLegend'

describe('BunkingLegend', () => {
  it('renders when open', () => {
    render(<BunkingLegend isOpen={true} onClose={() => {}} />)
    expect(screen.getByText('Visual Guide')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<BunkingLegend isOpen={false} onClose={() => {}} />)
    expect(screen.queryByText('Visual Guide')).not.toBeInTheDocument()
  })

  describe('Camper card indicators — must match CamperCard.tsx rendering', () => {
    it('documents the unfulfilled-request warning (orange triangle)', () => {
      render(<BunkingLegend isOpen={true} onClose={() => {}} />)
      // CamperCard shows AlertTriangle when totalRequests > 0 && satisfiedCount === 0
      expect(screen.getByText(/unsatisfied requests/i)).toBeInTheDocument()
    })

    it('documents the friend-group lock icon with count', () => {
      render(<BunkingLegend isOpen={true} onClose={() => {}} />)
      // CamperCard shows Lock + group size when lockState === 'locked'
      // Use getAllByText since "friend group" appears in both heading and description
      expect(screen.getAllByText(/friend group/i).length).toBeGreaterThan(0)
    })

    it('documents the pending-selection amber glow', () => {
      render(<BunkingLegend isOpen={true} onClose={() => {}} />)
      // CamperCard applies pending-lock-glow + border-amber-400 when lockState === 'pending'
      expect(screen.getByText(/pending selection/i)).toBeInTheDocument()
    })

    it('documents the group name glow', () => {
      render(<BunkingLegend isOpen={true} onClose={() => {}} />)
      // CamperCard applies text-shadow glow to camper name when in a locked group
      expect(screen.getByText(/group name glow/i)).toBeInTheDocument()
    })

    it('documents gender-coded card backgrounds', () => {
      render(<BunkingLegend isOpen={true} onClose={() => {}} />)
      // CamperCard applies blue/pink/purple background from getGenderColorClasses()
      // Must have a dedicated heading entry — not just a passing mention
      expect(screen.getByText('Gender Card Color')).toBeInTheDocument()
    })

    it('documents the last-year history indicator', () => {
      render(<BunkingLegend isOpen={true} onClose={() => {}} />)
      // CamperCard shows historyDisplay text (e.g. "S1 B-4") when getLastYearHistory returns data
      expect(screen.getByText('Prior-Year History')).toBeInTheDocument()
    })
  })

  describe('Bunk card indicators — must match BunkCard.tsx rendering', () => {
    it('documents the capacity utilization bar', () => {
      render(<BunkingLegend isOpen={true} onClose={() => {}} />)
      // BunkCard renders BunkUtilizationBar with green/yellow/orange/red colors
      expect(screen.getByText(/capacity bar/i)).toBeInTheDocument()
    })

    it('documents the social graph button', () => {
      render(<BunkingLegend isOpen={true} onClose={() => {}} />)
      // BunkCard renders Network icon button when onShowSocialGraph is provided
      expect(screen.getByText(/social graph/i)).toBeInTheDocument()
    })

    it('documents bunk warning indicators', () => {
      render(<BunkingLegend isOpen={true} onClose={() => {}} />)
      // BunkCard shows red border + ⚠️ on ageGapWarning, gradeRatioWarning, etc.
      expect(screen.getByText(/bunk warnings/i)).toBeInTheDocument()
    })

    it('documents the invalid drop target grey-out', () => {
      render(<BunkingLegend isOpen={true} onClose={() => {}} />)
      // BunkCard applies opacity-40 when dropDisabled && activeDragCamper
      expect(screen.getByText(/invalid drop target/i)).toBeInTheDocument()
    })

    it('documents the active drop target highlight', () => {
      render(<BunkingLegend isOpen={true} onClose={() => {}} />)
      // BunkCard applies ring-primary ring-2 when isOver (camper being dragged over bunk)
      // Must have a dedicated entry describing the highlighted / hover state
      expect(
        screen.getByText(
          /active drop|drop.*highlight|highlighted.*bunk|hover.*bunk|dragging.*over/i
        )
      ).toBeInTheDocument()
    })
  })

  describe('Working modes', () => {
    it('documents draft scenario mode', () => {
      render(<BunkingLegend isOpen={true} onClose={() => {}} />)
      expect(screen.getByText(/scenario mode/i)).toBeInTheDocument()
    })

    it('documents production / live mode', () => {
      render(<BunkingLegend isOpen={true} onClose={() => {}} />)
      expect(screen.getByText(/production mode/i)).toBeInTheDocument()
    })
  })
})

/**
 * The weekend's own Visual Guide (kindred#1997) — the same shell BunkingLegend
 * uses, DRY'd rather than copied, with entirely different sections: the three
 * rows moved out of the map's own legend, plus the board's shared-consent
 * ring. None of summer's camper/bunk/scenario content belongs here — a
 * weekend has no friend groups, gender cards or AG grade ratios.
 */
describe('WeekendLegendButton', () => {
  it('starts closed, behind a trigger button', () => {
    render(<WeekendLegendButton />)
    expect(screen.queryByText('Visual Guide')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show visual guide/i })).toBeInTheDocument()
  })

  it('opens the guide on click', async () => {
    render(<WeekendLegendButton />)
    await userEvent.click(screen.getByRole('button', { name: /show visual guide/i }))
    expect(screen.getByText('Visual Guide')).toBeInTheDocument()
  })

  it('documents the staff-cabin dashed square moved off the map', async () => {
    render(<WeekendLegendButton />)
    await userEvent.click(screen.getByRole('button', { name: /show visual guide/i }))
    expect(screen.getByText(/staff cabin/i)).toBeInTheDocument()
  })

  it('documents the near-bathhouse blue dot moved off the map', async () => {
    render(<WeekendLegendButton />)
    await userEvent.click(screen.getByRole('button', { name: /show visual guide/i }))
    expect(screen.getByText(/near bathhouse/i)).toBeInTheDocument()
  })

  it('documents the area-colour hue moved off the map', async () => {
    render(<WeekendLegendButton />)
    await userEvent.click(screen.getByRole('button', { name: /show visual guide/i }))
    expect(screen.getByText(/area colou?r/i)).toBeInTheDocument()
  })

  it("documents the board's own shared-consent ring alongside the map rows", async () => {
    // Not one of the three moved rows — the board's own signal, included per
    // the issue's "alongside them".
    render(<WeekendLegendButton />)
    await userEvent.click(screen.getByRole('button', { name: /show visual guide/i }))
    expect(screen.getByText(/not consented/i)).toBeInTheDocument()
  })

  it('carries none of the summer-only camper/bunk content', async () => {
    // Pins the DRY move being sections, not a copy of the file: reusing
    // CAMPER_SECTIONS here would smuggle friend groups onto a weekend.
    render(<WeekendLegendButton />)
    await userEvent.click(screen.getByRole('button', { name: /show visual guide/i }))
    expect(screen.queryByText(/friend group/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/gender card/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/scenario mode/i)).not.toBeInTheDocument()
  })

  it('closes on "Got it"', async () => {
    render(<WeekendLegendButton />)
    await userEvent.click(screen.getByRole('button', { name: /show visual guide/i }))
    await userEvent.click(screen.getByRole('button', { name: /got it/i }))
    expect(screen.queryByText('Visual Guide')).not.toBeInTheDocument()
  })
})
