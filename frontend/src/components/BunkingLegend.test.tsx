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
import { BunkingLegendButton, WeekendLegendButton } from './BunkingLegend'
import { BATHHOUSE_BLUE, CONSENT_AMBER } from './weekend/mapColors'

/** Every case here goes through `BunkingLegendButton`, not a direct
 *  `isOpen`/`onClose`-controlled render (kindred#2158): the file's own
 *  default export existed for that direct render, but nothing in production
 *  ever used it — `SessionHeader.tsx` always goes through the button — so it
 *  read as load-bearing on a skim when it was dead. Routing through the
 *  button keeps this suite's actual job, pinning CamperCard/BunkCard
 *  indicators against what the legend documents, while exercising the one
 *  path that's real. */
async function openLegend() {
  render(<BunkingLegendButton />)
  await userEvent.click(screen.getByRole('button', { name: /show visual guide/i }))
}

describe('BunkingLegend', () => {
  it('starts closed, behind a trigger button', () => {
    render(<BunkingLegendButton />)
    expect(screen.queryByText('Visual Guide')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show visual guide/i })).toBeInTheDocument()
  })

  it('renders when the trigger is clicked', async () => {
    await openLegend()
    expect(screen.getByText('Visual Guide')).toBeInTheDocument()
  })

  describe('Camper card indicators — must match CamperCard.tsx rendering', () => {
    it('documents the unfulfilled-request warning (orange triangle)', async () => {
      await openLegend()
      // CamperCard shows AlertTriangle when totalRequests > 0 && satisfiedCount === 0
      expect(screen.getByText(/unsatisfied requests/i)).toBeInTheDocument()
    })

    it('documents the friend-group lock icon with count', async () => {
      await openLegend()
      // CamperCard shows Lock + group size when lockState === 'locked'
      // Use getAllByText since "friend group" appears in both heading and description
      expect(screen.getAllByText(/friend group/i).length).toBeGreaterThan(0)
    })

    it('documents the pending-selection amber glow', async () => {
      await openLegend()
      // CamperCard applies pending-lock-glow + border-amber-400 when lockState === 'pending'
      expect(screen.getByText(/pending selection/i)).toBeInTheDocument()
    })

    it('documents the group name glow', async () => {
      await openLegend()
      // CamperCard applies text-shadow glow to camper name when in a locked group
      expect(screen.getByText(/group name glow/i)).toBeInTheDocument()
    })

    it('documents gender-coded card backgrounds', async () => {
      await openLegend()
      // CamperCard applies blue/pink/purple background from getGenderColorClasses()
      // Must have a dedicated heading entry — not just a passing mention
      expect(screen.getByText('Gender Card Color')).toBeInTheDocument()
    })

    it('documents the last-year history indicator', async () => {
      await openLegend()
      // CamperCard shows historyDisplay text (e.g. "S1 B-4") when getLastYearHistory returns data
      expect(screen.getByText('Prior-Year History')).toBeInTheDocument()
    })
  })

  describe('Bunk card indicators — must match BunkCard.tsx rendering', () => {
    it('documents the capacity utilization bar', async () => {
      await openLegend()
      // BunkCard renders BunkUtilizationBar with green/yellow/orange/red colors
      expect(screen.getByText(/capacity bar/i)).toBeInTheDocument()
    })

    it('documents the social graph button', async () => {
      await openLegend()
      // BunkCard renders Network icon button when onShowSocialGraph is provided
      expect(screen.getByText(/social graph/i)).toBeInTheDocument()
    })

    it('documents bunk warning indicators', async () => {
      await openLegend()
      // BunkCard shows red border + ⚠️ on ageGapWarning, gradeRatioWarning, etc.
      expect(screen.getByText(/bunk warnings/i)).toBeInTheDocument()
    })

    it('documents the invalid drop target grey-out', async () => {
      await openLegend()
      // BunkCard applies opacity-40 when dropDisabled && activeDragCamper
      expect(screen.getByText(/invalid drop target/i)).toBeInTheDocument()
    })

    it('documents the active drop target highlight', async () => {
      await openLegend()
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
    it('documents draft scenario mode', async () => {
      await openLegend()
      expect(screen.getByText(/scenario mode/i)).toBeInTheDocument()
    })

    it('documents production / live mode', async () => {
      await openLegend()
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

  it('draws its swatches from the SAME colour tokens the map itself uses, not a re-typed copy', async () => {
    // code review on #1997 flagged the original literal duplication as a
    // drift risk; `mapColors.ts` is the single source both this guide and
    // `LodgingMap.tsx`/`MapUnitPopover.tsx` import from now. Checked via
    // `.style` properties, matching how `LodgingMap.test.tsx` pins the same
    // tokens — jsdom re-serialises a hex `background-color` to `rgb(...)`,
    // so an attribute-string match on the hex literal would false-negative.
    render(<WeekendLegendButton />)
    await userEvent.click(screen.getByRole('button', { name: /show visual guide/i }))
    const swatches = [...document.querySelectorAll<HTMLElement>('[style]')]

    // jsdom re-serialises a hex `background-color` to `rgb(...)`, so a probe
    // element run through the SAME normalisation is what makes this an
    // honest "same token" check rather than a hardcoded rgb() guess.
    const probe = document.createElement('div')
    probe.style.backgroundColor = BATHHOUSE_BLUE
    expect(swatches.some((el) => el.style.backgroundColor === probe.style.backgroundColor)).toBe(
      true
    )
    // `box-shadow` is a shorthand jsdom does not re-normalise the same way,
    // so the hex survives verbatim — matching how `LodgingMap.test.tsx` pins
    // `CONSENT_AMBER` on the mark's own ring.
    expect(swatches.some((el) => el.style.boxShadow.includes(CONSENT_AMBER))).toBe(true)
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
