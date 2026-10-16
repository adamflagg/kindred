import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  AnotherIdentityLine,
  GenderFallbackLine,
  GenderFallbackPairLine,
  GenderFallbackSeasonsLine,
  READ_WITH_CARE_ON,
  READ_WITH_CARE_SHARE,
  ReadWithCareLine,
  genderNote,
  groupCounts,
  needsReadWithCare,
} from './genderIdentityNotes'

describe('groupCounts (#75 a)', () => {
  it('folds every label into the five groups', () => {
    expect(
      groupCounts({
        'Girl/woman': 10,
        'Boy/man': 8,
        'Non-binary': 2,
        'Transgender boy/man': 1,
        Agender: 1,
        'self-described': 1,
        'Prefer not to answer': 2,
        'not given': 1,
      })
    ).toEqual({
      'Girl/woman': 10,
      'Boy/man': 8,
      'Non-binary': 2,
      'Another identity': 3,
      'No answer': 3,
    })
  })
})

describe('the ruling-58 note line under a chart (#72 a, #73 a)', () => {
  it('states the count, visible, with its note number', () => {
    const { container } = render(<GenderFallbackLine n={2} count={762} />)
    expect(container.textContent).toBe(
      '2 762 campers with no gender identity answer are counted by the Gender field.'
    )
    expect(container.querySelector('sup')?.textContent).toBe('2')
  })

  it('reads one camper in the singular, and names the season when given', () => {
    const { container } = render(<GenderFallbackLine n={1} count={1} season="2017 campers" />)
    expect(container.textContent).toBe(
      '1 1 camper with no gender identity answer is counted by the Gender field (2017 campers).'
    )
  })

  it('draws nothing when no camper was counted that way', () => {
    const { container } = render(<GenderFallbackLine n={2} count={0} />)
    expect(container.textContent).toBe('')
  })

  it('pairs two seasons on a comparison table, leaving out a season at 0', () => {
    const both = render(
      <GenderFallbackPairLine
        n={2}
        seasons={[
          { season: 2018, count: 762 },
          { season: 2017, count: 798 },
        ]}
      />
    )
    expect(both.container.textContent).toBe(
      '2 762 in 2018 and 798 in 2017: campers with no gender identity answer, counted by the Gender field.'
    )
    both.unmount()
    const one = render(
      <GenderFallbackPairLine
        n={2}
        seasons={[
          { season: 2026, count: 0 },
          { season: 2025, count: 1 },
        ]}
      />
    )
    expect(one.container.textContent).toBe(
      '2 1 in 2025: campers with no gender identity answer, counted by the Gender field.'
    )
    one.unmount()
    const none = render(<GenderFallbackPairLine n={2} seasons={[{ season: 2026, count: 0 }]} />)
    expect(none.container.textContent).toBe('')
  })

  it('lists Trends seasons above 0 with their totals (#74 a)', () => {
    const { container } = render(
      <GenderFallbackSeasonsLine
        n={3}
        seasons={[
          { season: 2017, count: 798, of: 1139 },
          { season: 2023, count: 1, of: 1200 },
          { season: 2026, count: 0, of: 1134 },
        ]}
      />
    )
    expect(container.textContent).toBe(
      '3 Campers with no gender identity answer, counted by the Gender field: 2017: 798 of 1,139 · 2023: 1.'
    )
  })
})

describe('the Another identity line (#75 a)', () => {
  it('lists the members with their counts, summed over the charts it covers', () => {
    render(
      <AnotherIdentityLine
        counts={[
          { 'Transgender boy/man': 5, 'Girl/woman': 100 },
          { 'Transgender boy/man': 3, 'self-described': 2, Agender: 1 },
        ]}
      />
    )
    expect(screen.getByText(/Another identity/).closest('p')?.textContent).toBe(
      'Another identity = Transgender boy/man 8, Agender 1, Self-described 2. No answer = Prefer not to answer + Not given. Every label stays separate in the drill-down and the CSV.'
    )
  })

  it('says none when the season has no one in the group', () => {
    const { container } = render(<AnotherIdentityLine counts={[{ 'Girl/woman': 3 }]} />)
    expect(container.textContent).toContain('Another identity = none this season.')
  })
})

describe('the page-foot note', () => {
  it('defines Gender and states each season above 0', () => {
    expect(
      genderNote(4, [
        { season: 2018, count: 762 },
        { season: 2017, count: 798 },
      ])
    ).toEqual({
      n: 4,
      term: 'Gender',
      text:
        'Gender: gender identity from CampMinder; a write-in counts as Self-described. 762 campers in 2018 and ' +
        '798 in 2017 with no gender identity answer are counted by the Gender field (F as Girl/woman, M as Boy/man).',
    })
  })

  it('is only the definition when no season fell back', () => {
    expect(genderNote(1, [{ season: 2026, count: 0 }]).text).toBe(
      'Gender: gender identity from CampMinder; a write-in counts as Self-described.'
    )
  })
})

describe('Read with care on Retention (#82 a, ruled)', () => {
  it('is switched on', () => {
    expect(READ_WITH_CARE_ON).toBe(true)
    expect(READ_WITH_CARE_SHARE).toBe(0.25)
  })

  it('shows only when MORE than 25% of the base season has no answer', () => {
    expect(needsReadWithCare(251, 1000)).toBe(true)
    expect(needsReadWithCare(250, 1000)).toBe(false)
    expect(needsReadWithCare(249, 1000)).toBe(false)
    expect(needsReadWithCare(0, 0)).toBe(false)
  })

  it('compares how often campers with and without an answer came back', () => {
    const { container } = render(
      <ReadWithCareLine
        season={2017}
        base={1000}
        returned={700}
        fallback={400}
        fallbackReturned={224}
      />
    )
    // with an answer: 476 of 600 = 79%; without: 224 of 400 = 56%
    expect(container.textContent).toBe(
      'Read with care: 400 of 1,000 2017 campers have no identity answer. CampMinder holds an answer mostly ' +
        'for campers who came back in later summers, so the identity rows here look more likely to return than ' +
        'they were (2017: 79% of campers with an answer returned, 56% of those without).'
    )
  })

  it('draws nothing at or under the threshold', () => {
    const { container } = render(
      <ReadWithCareLine
        season={2025}
        base={1000}
        returned={700}
        fallback={250}
        fallbackReturned={100}
      />
    )
    expect(container.textContent).toBe('')
  })
})
