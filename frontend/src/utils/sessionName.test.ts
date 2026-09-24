/**
 * `sessionName` — the one session-name entry point (kindred#2763).
 *
 * One row per program per form. The per-call-site pins, which are the
 * pixel-identical evidence for the move itself, live beside this file in
 * `sessionName.pins.test.ts`; this file pins the TABLE, so a reader can see
 * every rendering of one program side by side.
 */
import { describe, expect, it } from 'vitest'

import { SESSION_NAME_FORMS, sessionName } from './sessionName'
import type { SessionNameForm } from './sessionName'

type Row = Readonly<Record<SessionNameForm, string>>

/**
 * [program, session_type, name, output per form]. The AG row is the five
 * renderings of one session the issue was filed about; they stay five until
 * #2790 reconciles them.
 */
const TABLE: ReadonlyArray<readonly [string, string, string, Row]> = [
  [
    'summer main',
    'main',
    'Session 2 (Grades 4-6)',
    {
      full: 'Session 2 (Grades 4-6)',
      identity: 'Session 2 (Grades 4-6)',
      title: 'Session 2 (Grades 4-6)',
      short: 'Session 2 (Grades 4-6)',
      matrix: 'Session 2 (Grades 4-6)',
      chart: 'Session 2 (4-6)',
      tiny: '2',
    },
  ],
  [
    'embedded',
    'embedded',
    'Session 2a',
    {
      full: 'Session 2a',
      identity: 'Session 2a',
      title: 'Session 2a',
      short: 'Session 2a',
      matrix: 'Session 2a',
      chart: 'Session 2a',
      tiny: '2a',
    },
  ],
  [
    'Taste of Camp (embedded)',
    'embedded',
    'Taste of Camp 2',
    {
      full: 'Taste of Camp 2',
      identity: 'Taste of Camp 2',
      title: 'Taste of Camp 2',
      short: 'Taste of Camp 2',
      matrix: 'Taste of Camp 2',
      chart: 'Taste of Camp 2',
      tiny: 'Taste 2',
    },
  ],
  [
    'AG',
    'ag',
    'All-Gender Cabin-Session 2 (7th & 8th grades)',
    {
      full: 'All-Gender Cabin-Session 2 (7th & 8th grades)',
      identity: 'All-Gender Cabin-Session 2 (7th & 8th grades)',
      title: 'Session 2',
      short: 'AG 2 (7-8)',
      matrix: 'AG Session 2 (7th & 8th)',
      chart: 'All-Gender 2',
      tiny: '2',
    },
  ],
  [
    'Quest',
    'quest',
    'Teen Adventure Quests',
    {
      full: 'Teen Adventure Quests',
      identity: 'Teen Adventure Quests',
      title: 'Teen Adventure Quests',
      short: 'Teen Adventure Quests',
      matrix: 'Teen Adventure Quests',
      chart: 'Teen Adventure Quests',
      tiny: 'Quest',
    },
  ],
  [
    'teen (SCIT)',
    'scit',
    'SCIT: Rising 12th',
    {
      full: 'SCIT: Rising 12th',
      identity: 'SCIT',
      title: 'SCIT: Rising 12th',
      short: 'SCIT: Rising 12th',
      matrix: 'SCIT: Rising 12th',
      chart: 'SCIT: Rising 12th',
      tiny: '12t',
    },
  ],
  [
    'family',
    'family',
    'Family Camp 5: JFAM Weekend (w/ kids 10 and under)',
    {
      full: 'Family Camp 5: JFAM Weekend (w/ kids 10 and under)',
      identity: 'Family Camp 5',
      title: 'Family Camp 5',
      short: 'Family Camp 5: JFAM Weekend (w/ kids 10 and under)',
      matrix: 'Family Camp 5: JFAM Weekend (w/ kids 10 and under)',
      chart: 'Family Camp 5: JFAM We...',
      tiny: 'FC5',
    },
  ],
  [
    'family, 2017-2019 legacy name',
    'family',
    'Fall Family Camp II',
    {
      full: 'Fall Family Camp II',
      identity: 'Fall Family Camp II',
      title: 'Family Camp 5',
      short: 'Fall Family Camp II',
      matrix: 'Fall Family Camp II',
      chart: 'Fall Family Camp II',
      tiny: 'FC5',
    },
  ],
  [
    'adult',
    'adult',
    "Women's Weekend (3 nights)",
    {
      full: "Women's Weekend (3 nights)",
      identity: "Women's Weekend (3 nights)",
      title: "Women's Weekend",
      short: "Women's Weekend",
      matrix: "Women's Weekend (3 nights)",
      chart: "Women's Weekend (3 nig...",
      tiny: "Women's Weekend (3 nights)",
    },
  ],
]

describe('sessionName — one row per program per form', () => {
  for (const [program, sessionType, name, row] of TABLE) {
    describe(`${program}: ${name}`, () => {
      it.each(SESSION_NAME_FORMS)('%s', (form) => {
        expect(sessionName(name, sessionType, form)).toBe(row[form])
      })
    })
  }
})

describe('sessionName — the closed set of forms', () => {
  it('is exactly these seven, in length order from longest', () => {
    expect(SESSION_NAME_FORMS).toEqual([
      'full',
      'identity',
      'title',
      'short',
      'matrix',
      'chart',
      'tiny',
    ])
  })
})

describe('sessionName — an empty name', () => {
  it.each<[SessionNameForm, string]>([
    ['full', ''],
    ['identity', ''],
    ['title', 'Unknown Session'],
    ['short', ''],
    ['matrix', ''],
    ['chart', 'Unknown'],
    ['tiny', ''],
  ])('%s → %j', (form, expected) => {
    expect(sessionName('', undefined, form)).toBe(expected)
    expect(sessionName('', 'family', form)).toBe(expected)
  })
})

describe('sessionName — an unknown session_type', () => {
  it('infers AG from the name only for the short form, and only when no type is given', () => {
    const ag = 'All-Gender Cabin-Session 2 (7th & 8th grades)'
    // The metrics rows carry no session_type at all, and have always read
    // AG off the name.
    expect(sessionName(ag, undefined, 'short')).toBe('AG 2 (7-8)')
    // A record that DOES carry a type is taken at its word.
    expect(sessionName(ag, '', 'short')).toBe(ag)
    expect(sessionName(ag, 'main', 'short')).toBe(ag)
  })
})

describe('sessionName — tiny never invents an abbreviation', () => {
  // The rule `weekendLabel` was built on (kindred#2393) carried over to the
  // whole tiny form: it abbreviates only what CampMinder NUMBERED, or what
  // the owner explicitly MAPPED. Anything else reads as its own identity.
  // Initials are how "Fall Family Camp I" and "II" both became FFCI.
  const INITIALS = /^[A-Z]{2,}\d*$/

  it.each([
    ['Fall Family Camp IV', 'Fall Family Camp IV'],
    ['Summer Family Retreat', 'Summer Family Retreat'],
    ['JFAM Spring Gathering: Sukkot', 'JFAM Spring Gathering'],
    ['Keshet Weekend', 'Keshet Weekend'],
  ])('an unmapped family weekend, %j, reads whole', (name, expected) => {
    const tiny = sessionName(name, 'family', 'tiny')
    expect(tiny).toBe(expected)
    expect(tiny).not.toMatch(INITIALS)
  })

  // The owner has supplied no adult vocabulary (ruling 2026-09-23), so an
  // adult program has no tiny form at all — not even a CampMinder number,
  // which a family weekend would be abbreviated from.
  it.each([
    ["Women's Weekend (3 nights)", "Women's Weekend (3 nights)"],
    ["Men's Weekend", "Men's Weekend"],
    ['Divorce & Discovery: A Jewish Healing Retreat', 'Divorce & Discovery'],
    ["Men's Retreat 2", "Men's Retreat 2"],
  ])('an adult program, %j, is never abbreviated', (name, expected) => {
    const tiny = sessionName(name, 'adult', 'tiny')
    expect(tiny).toBe(expected)
    expect(tiny).not.toMatch(INITIALS)
  })

  it('still abbreviates what CampMinder numbered or the owner mapped', () => {
    expect(sessionName('Family Camp 1: Memorial Day Weekend', 'family', 'tiny')).toBe('FC1')
    expect(sessionName('Spring Family Camp', 'family', 'tiny')).toBe('FC1')
    expect(sessionName('JFAM Winter Family Camp', 'family', 'tiny')).toBe('WFC')
    expect(sessionName('Ready, Set, Camp', 'family', 'tiny')).toBe('RSC')
  })
})
