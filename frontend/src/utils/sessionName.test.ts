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
      tiny: 'S2', // #2790 owner ruling 2026-10-09 (was '2')
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
      tiny: 'S2a', // #2790 owner ruling 2026-10-09 (was '2a')
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
      tiny: 'AG 2', // #2790 owner ruling 2026-10-09 (was '2')
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
      // #2790: an unmapped quest reads as its name whole, never an invented
      // abbreviation (was the generic 'Quest').
      tiny: 'Teen Adventure Quests',
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
      tiny: 'SCIT: Rising 12th', // #2790: an unmapped teen name reads whole (was '12t')
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
      short: 'Family Camp 5', // #2790 owner ruling 2026-10-09: no subtitle
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
      tiny: 'WW', // #2790 owner ruling 2026-10-09 (was the identity whole)
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
    // Women's / Men's Weekend left this list: #2790 owner ruling 2026-10-09
    // maps them to WW / MW (pinned in the #2790 block below). Every OTHER
    // adult program still reads whole.
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

/**
 * The old functions' own unit tests, carried over when their exports went
 * (kindred#2763). Only the call changed — `fn(name, type)` became
 * `sessionName(name, type, form)` — and every expectation is as it was.
 */
describe("sessionName — the retired functions' specs", () => {
  describe('title (was getSessionDisplayNameFromString)', () => {
    it('should handle empty session name', () => {
      expect(sessionName('', undefined, 'title')).toBe('Unknown Session')
      expect(sessionName('', 'ag', 'title')).toBe('Unknown Session')
    })

    // Owner ruling 2026-09-22: the raw adult-weekend name is too long for the
    // camper journey. Same spirit as family's `weekendTitle` — identity before
    // a colon, then drop ONE trailing parenthetical qualifier (a night count,
    // a fee, "full price"). A trailing parenthetical is stripped ONLY for
    // adult weekends: a summer AG name's parenthetical (grades) is meaningful
    // and must survive untouched (see the non-adult cases below).
    describe('adult weekends', () => {
      it('drops a trailing night-count qualifier', () => {
        expect(sessionName("Women's Weekend", 'adult', 'title')).toBe("Women's Weekend")
        expect(sessionName("Women's Weekend (2 nights)", 'adult', 'title')).toBe("Women's Weekend")
        expect(sessionName("Women's Weekend (3 nights)", 'adult', 'title')).toBe("Women's Weekend")
      })

      it('leaves a name with no qualifier unchanged', () => {
        expect(sessionName("Men's Weekend", 'adult', 'title')).toBe("Men's Weekend")
        expect(sessionName('Adults Unplugged', 'adult', 'title')).toBe('Adults Unplugged')
      })

      it('takes the identity before the colon, then drops a trailing qualifier', () => {
        expect(sessionName('Divorce & Discovery: A Jewish Healing Retreat', 'adult', 'title')).toBe(
          'Divorce & Discovery'
        )
        expect(
          sessionName(
            'Divorce & Discovery: A Jewish Healing Retreat (full price)',
            'adult',
            'title'
          )
        ).toBe('Divorce & Discovery')
      })

      it('drops a trailing fee qualifier', () => {
        expect(sessionName('Spring Service Weekend ($54 fee)', 'adult', 'title')).toBe(
          'Spring Service Weekend'
        )
        expect(sessionName('Spring Service Weekend ($72 fee)', 'adult', 'title')).toBe(
          'Spring Service Weekend'
        )
        expect(sessionName('Spring Service Weekend ($118 fee)', 'adult', 'title')).toBe(
          'Spring Service Weekend'
        )
        expect(sessionName('Spring Service Weekend ($216 fee)', 'adult', 'title')).toBe(
          'Spring Service Weekend'
        )
      })

      it('does not touch a non-adult session with a meaningful parenthetical (AG grades)', () => {
        expect(sessionName('Session 2 (Grades 4-6)', undefined, 'title')).toBe(
          'Session 2 (Grades 4-6)'
        )
      })
    })

    it('should transform AG sessions by type', () => {
      expect(sessionName('Some AG Session', 'ag', 'title')).toBe('Some AG Session')
      expect(sessionName('AG Session 2', 'ag', 'title')).toBe('Session 2')
    })

    it('should transform AG sessions by name pattern', () => {
      expect(sessionName('All-Gender Cabin-Session 2', undefined, 'title')).toBe('Session 2')
      expect(sessionName('Session 3 All-Gender', undefined, 'title')).toBe('Session 3')
      expect(sessionName('ag session 3', undefined, 'title')).toBe('Session 3')
    })

    it('should return original name if no transformation needed', () => {
      expect(sessionName('Session 2', undefined, 'title')).toBe('Session 2')
      expect(sessionName('Taste of Camp', undefined, 'title')).toBe('Taste of Camp')
      expect(sessionName('Family Camp 1', undefined, 'title')).toBe('Family Camp 1')
    })
  })

  describe('chart (was getSessionChartLabel)', () => {
    it('should return "Unknown" for empty session name', () => {
      expect(sessionName('', undefined, 'chart')).toBe('Unknown')
    })

    it('should return taste session name as-is', () => {
      expect(sessionName('Taste of Camp', undefined, 'chart')).toBe('Taste of Camp')
      expect(sessionName('Taste of Camp 2', 'taste', 'chart')).toBe('Taste of Camp 2')
      expect(sessionName('Taste of Camp 2025', 'taste', 'chart')).toBe('Taste of Camp 2025')
    })

    it('should abbreviate AG sessions and preserve grade ranges', () => {
      expect(sessionName('All-Gender Cabin-Session 2', 'ag', 'chart')).toBe('All-Gender 2')
      expect(sessionName('All-Gender Cabin-Session 2 (Grades 6-8)', 'ag', 'chart')).toBe(
        'All-Gender 2 (6-8)'
      )
      expect(sessionName('All-Gender Cabin-Session 3 (Grades 3-5) 2025', undefined, 'chart')).toBe(
        'All-Gender 3 (3-5)'
      )
      expect(sessionName('AG Session 4', 'ag', 'chart')).toBe('All-Gender 4')
    })

    it('should preserve main session format', () => {
      expect(sessionName('Session 2', undefined, 'chart')).toBe('Session 2')
      expect(sessionName('Session 3', 'main', 'chart')).toBe('Session 3')
    })

    it('should preserve embedded session format', () => {
      expect(sessionName('Session 2a', 'embedded', 'chart')).toBe('Session 2a')
      expect(sessionName('Session 3b', undefined, 'chart')).toBe('Session 3b')
    })

    it('should truncate very long names without grade ranges', () => {
      expect(
        sessionName('Some Very Long Session Name That Goes On Forever', undefined, 'chart')
      ).toBe('Some Very Long Session...')
    })
  })

  // #2790 owner ruling 2026-10-09: "Session N" reads S<N> and an AG session reads
  // AG <N> (both were the bare number). Fallbacks below are unchanged.
  describe('tiny (was getSessionShorthand)', () => {
    it('should return empty string for empty session name', () => {
      expect(sessionName('', undefined, 'tiny')).toBe('')
    })

    it('should return "Taste" for Taste of Camp sessions', () => {
      expect(sessionName('Taste of Camp', undefined, 'tiny')).toBe('Taste')
      // 4-digit year suffixes must not be mistaken for cohort numbers.
      expect(sessionName('Taste of Camp 2025', 'taste', 'tiny')).toBe('Taste')
      // Split cohorts must be distinguishable on solver-debug source labels.
      expect(sessionName('Taste of Camp 1', undefined, 'tiny')).toBe('Taste 1')
      expect(sessionName('Taste of Camp 2', undefined, 'tiny')).toBe('Taste 2')
      // Two-digit cohorts supported in case the camp scales beyond 9.
      expect(sessionName('Taste of Camp 10', undefined, 'tiny')).toBe('Taste 10')
    })

    it('should extract session number from "Session N" format', () => {
      expect(sessionName('Session 2', undefined, 'tiny')).toBe('S2')
      expect(sessionName('Session 3', undefined, 'tiny')).toBe('S3')
      expect(sessionName('Session 2a', undefined, 'tiny')).toBe('S2a')
      expect(sessionName('Session 3b', undefined, 'tiny')).toBe('S3b')
    })

    it('should extract number from AG sessions', () => {
      expect(sessionName('AG Session 2', 'ag', 'tiny')).toBe('AG 2')
      expect(sessionName('All-Gender Cabin-Session 3', undefined, 'tiny')).toBe('AG 3')
      expect(sessionName('Session 2 All-Gender', undefined, 'tiny')).toBe('AG 2')
    })

    it('should fallback to number extraction', () => {
      expect(sessionName('Camp Week 4', undefined, 'tiny')).toBe('4')
      expect(sessionName('Week 2a Program', undefined, 'tiny')).toBe('2a')
    })

    it('should return first word as last resort', () => {
      expect(sessionName('Family Camp', undefined, 'tiny')).toBe('Family')
      expect(sessionName('Special Event', undefined, 'tiny')).toBe('Special')
    })

    it('should handle AG session type parameter', () => {
      expect(sessionName('Some AG Session 2', 'ag', 'tiny')).toBe('AG 2')
    })
  })

  // getSessionChartLabel took a date lookup it had long since stopped reading;
  // the argument is gone, and its cases still pin the chart form.
  describe('chart — the retired date-lookup cases', () => {
    it('should return taste session name as-is, ignoring date lookup', () => {
      expect(sessionName('Taste of Camp 1', undefined, 'chart')).toBe('Taste of Camp 1')
      expect(sessionName('Taste of Camp 2', undefined, 'chart')).toBe('Taste of Camp 2')
    })

    it('should not transform taste session names with date lookup', () => {
      expect(sessionName('Taste of Camp', 'taste', 'chart')).toBe('Taste of Camp')
    })

    it('should not append date to non-Taste sessions', () => {
      expect(sessionName('Session 2', 'main', 'chart')).toBe('Session 2')
      expect(sessionName('Session 3', 'main', 'chart')).toBe('Session 3')
    })

    it('should work without date lookup (backward compatibility)', () => {
      expect(sessionName('Taste of Camp', undefined, 'chart')).toBe('Taste of Camp')
      expect(sessionName('Taste of Camp 2', undefined, 'chart')).toBe('Taste of Camp 2')
      expect(sessionName('Session 2', undefined, 'chart')).toBe('Session 2')
    })
  })

  describe('short, untyped (was shortenSessionName)', () => {
    it('should return non-AG session names unchanged', () => {
      expect(sessionName('Session 2', undefined, 'short')).toBe('Session 2')
      expect(sessionName('Session 4', undefined, 'short')).toBe('Session 4')
      expect(sessionName('Taste of Camp', undefined, 'short')).toBe('Taste of Camp')
    })

    it('should shorten current-format AG names with grade ranges', () => {
      expect(sessionName('All-Gender Cabin-Session 2 (7th - 9th grades)', undefined, 'short')).toBe(
        'AG 2 (7-9)'
      )
      expect(sessionName('All-Gender Cabin-Session 4 (4th - 6th grades)', undefined, 'short')).toBe(
        'AG 4 (4-6)'
      )
    })

    it('should shorten older-format AG names with grade ranges', () => {
      expect(sessionName('Session 4 (All-Gender Cabin)-6th & 7th grades', undefined, 'short')).toBe(
        'AG 4 (6-7)'
      )
    })

    it('should shorten AG names without grade ranges', () => {
      expect(sessionName('Session B (All-Gender Cabins)', undefined, 'short')).toBe('AG B')
    })

    it('should handle AG prefix in name', () => {
      expect(sessionName('AG-Session 3 (4th - 6th grades)', undefined, 'short')).toBe('AG 3 (4-6)')
    })
  })

  describe('matrix (was formatAgSessionLabel)', () => {
    it('keeps "Session N" and ordinal grades, dropping "All-Gender Cabin-" and "grades"', () => {
      expect(
        sessionName('All-Gender Cabin-Session 2 (7th & 8th grades)', undefined, 'matrix')
      ).toBe('AG Session 2 (7th & 8th)')
      expect(
        sessionName('All-Gender Cabin-Session 3 (9th & 10th grades)', undefined, 'matrix')
      ).toBe('AG Session 3 (9th & 10th)')
    })

    it('preserves a dash connector in the grade range', () => {
      expect(
        sessionName('All-Gender Cabin-Session 4 (4th - 6th grades)', undefined, 'matrix')
      ).toBe('AG Session 4 (4th - 6th)')
    })

    it('handles older-format AG names', () => {
      expect(
        sessionName('Session 4 (All-Gender Cabin)-6th & 7th grades', undefined, 'matrix')
      ).toBe('AG Session 4 (6th & 7th)')
    })

    it('handles AG names without a grade range', () => {
      expect(sessionName('Session B (All-Gender Cabins)', undefined, 'matrix')).toBe('AG Session B')
    })

    it('returns non-AG names unchanged', () => {
      expect(sessionName('Session 2', undefined, 'matrix')).toBe('Session 2')
      expect(sessionName('Taste of Camp 2', undefined, 'matrix')).toBe('Taste of Camp 2')
    })
  })
})

/**
 * kindred#2790 — the owner's tiny / short vocabulary (ruling 2026-10-09).
 * Real shapes come from the synced `camp_sessions` names; the camp's own name
 * is `{camp}` here and never appears in a rule.
 */
describe('sessionName — #2790 tiny vocabulary', () => {
  it.each([
    ["Women's Weekend", 'WW'],
    ["Women's Weekend (3 nights)", 'WW'],
    ["Men's Weekend", 'MW'],
  ])('adult %j → %s', (name, expected) => {
    expect(sessionName(name, 'adult', 'tiny')).toBe(expected)
  })

  it.each([
    ['Adults Unplugged', 'Adults Unplugged'],
    ['Divorce & Discovery: A Jewish Healing Retreat', 'Divorce & Discovery'],
    ["Men's Retreat 2", "Men's Retreat 2"],
  ])('any other adult program, %j, keeps its identity whole', (name, expected) => {
    expect(sessionName(name, 'adult', 'tiny')).toBe(expected)
  })

  it.each([
    ['Northwest Canada Quest', 'NW Canada'],
    ['Quest H20', 'H2O'],
    ['Rock and River Quest', 'Rock & River'],
    ['Sierra Slam Quest', 'Sierra Slam'],
    ['Surf `n` Turf Quest', 'Surf n Turf'],
    ['Taste of Quest', 'Taste Quest'],
  ])('quest %j → %s', (name, expected) => {
    expect(sessionName(name, 'quest', 'tiny')).toBe(expected)
    expect(sessionName(name, undefined, 'tiny')).toBe(expected)
  })

  it.each([
    ['Women of the Wild Quest', 'Women of the Wild Quest'],
    ['Magical Mystery Tour', 'Magical Mystery Tour'],
    ['Sierra Slam Quest 2', 'Sierra Slam Quest 2'],
    ['Quest Session 2: Backpacking the High Sierra', 'Quest Session 2'],
  ])('an UNMAPPED quest, %j, reads as its name whole, never invented', (name, expected) => {
    expect(sessionName(name, 'quest', 'tiny')).toBe(expected)
  })

  it.each([
    ['Session 2', 'main', 'S2'],
    ['Session 3', 'main', 'S3'],
    ['Session 2 (Grades 4-6)', 'main', 'S2'],
    ['Session 2a', 'embedded', 'S2a'],
    ['Session 3b', 'embedded', 'S3b'],
    ['Taste of Camp 1', 'main', 'Taste 1'],
    ['Taste of Camp 2', 'embedded', 'Taste 2'],
    ['Taste of Camp', 'main', 'Taste'],
    ['All-Gender Cabin-Session 2 (7th & 8th grades)', 'ag', 'AG 2'],
    ['Session 4 (All-Gender Cabin)-6th & 7th grades', 'ag', 'AG 4'],
    ['Session B (All-Gender Cabins)', 'ag', 'AG B'],
    ['AG Session 4', 'ag', 'AG 4'],
  ])('summer %j (%s) → %s', (name, type, expected) => {
    expect(sessionName(name, type, 'tiny')).toBe(expected)
  })

  it.each([
    ["{camp}'s B*Mitzvah Program Year 1 - East Bay", 'BM1 EB'],
    ["{camp}'s B*Mitzvah Program Year 1 - San Francisco", 'BM1 SF'],
    ["{camp}'s B*Mitzvah Program Year 2 - East Bay", 'BM2 EB'],
    ["{camp}'s B*Mitzvah Program Year 2 - San Francisco", 'BM2 SF'],
    // No ruled region, or no year: never invent one — the name whole.
    [
      "B'nai Mitzvah Program Year 1 - South Peninsula",
      "B'nai Mitzvah Program Year 1 - South Peninsula",
    ],
    ['{camp} B*Mitzvah Fall 2025 Shabbaton', '{camp} B*Mitzvah Fall 2025 Shabbaton'],
  ])('B*Mitzvah %j → %s', (name, expected) => {
    expect(sessionName(name, 'bmitzvah', 'tiny')).toBe(expected)
  })

  it.each([
    ['Hebrew 1 - Wednesdays at 4pm', 'Heb 1'],
    ['Hebrew 2 - Wednesdays at 5:15pm', 'Heb 2'],
    ['Hebrew 1', 'Heb 1'],
  ])('Hebrew %j → %s', (name, expected) => {
    expect(sessionName(name, 'hebrew', 'tiny')).toBe(expected)
  })

  it.each([
    ['{camp} Family School - East Bay cohort', 'TFS EB'],
    ['{camp} Family School - San Francisco cohort', 'TFS SF'],
    ['{camp} Family School (Marin Cohort)', '{camp} Family School (Marin Cohort)'],
  ])('Family School %j → %s', (name, expected) => {
    expect(sessionName(name, 'school', 'tiny')).toBe(expected)
  })

  it.each([
    ['Counselor In-Training', 'scit', 'CIT'],
    ['Specialist In-Training', 'scit', 'SIT'],
    ['Teen Leadership Institute', 'tli', 'TLI'],
    ['Teen Winter Retreat', 'teen', 'TWR'],
    ['Teen Winter Retreat (December)', 'teen', 'TWR'],
    ['Staff Kids at Camp', 'other', 'Staff Kids'],
    ['{camp} Board', 'other', 'Board'],
    ['Gold Rush', 'other', 'Gold Rush'],
    ['{camp} Israel Program: Leadership in Action', 'other', '{camp} Israel Program'],
  ])('%j (%s) → %s', (name, type, expected) => {
    expect(sessionName(name, type, 'tiny')).toBe(expected)
  })

  it('an unmapped teen name reads whole, so two trips never collapse onto one label', () => {
    expect(sessionName('TLI: Camp to Portland', 'tli', 'tiny')).toBe('TLI: Camp to Portland')
    expect(sessionName('TLI: Portland to Camp', 'tli', 'tiny')).toBe('TLI: Portland to Camp')
    expect(sessionName('SCIT: Rising 12th', 'scit', 'tiny')).toBe('SCIT: Rising 12th')
  })

  it('leaves Family Camp FC1..FC8, WFC and RSC unchanged', () => {
    expect(sessionName('Family Camp 8: JFAM Weekend', 'family', 'tiny')).toBe('FC8')
    expect(sessionName('Winter Family Camp', 'family', 'tiny')).toBe('WFC')
    expect(sessionName('Ready, Set, Camp', 'family', 'tiny')).toBe('RSC')
    expect(sessionName('Spring Family Retreat', 'family', 'tiny')).toBe('Spring FR')
  })
})

describe('sessionName — #2790 short vocabulary', () => {
  it.each([
    ["{camp}'s B*Mitzvah Program Year 1 - East Bay", 'B*Mitzvah Y1 East Bay'],
    ["{camp}'s B*Mitzvah Program Year 1 - San Francisco", 'B*Mitzvah Y1 San Francisco'],
    ["{camp}'s B*Mitzvah Program Year 2 - East Bay", 'B*Mitzvah Y2 East Bay'],
    ["{camp}'s B*Mitzvah Program Year 2 - San Francisco", 'B*Mitzvah Y2 San Francisco'],
    // Not a ruled region: stays as short does today (whole).
    [
      "B'nai Mitzvah Program Year 1 - South Peninsula",
      "B'nai Mitzvah Program Year 1 - South Peninsula",
    ],
  ])('B*Mitzvah %j → %s', (name, expected) => {
    expect(sessionName(name, 'bmitzvah', 'short')).toBe(expected)
  })

  it.each([
    ['Hebrew 1 - Wednesdays at 4pm', 'Hebrew 1 · Wed 4pm'],
    ['Hebrew 2 - Wednesdays at 5:15pm', 'Hebrew 2 · Wed 5:15pm'],
    ['Hebrew 1 - Wednesdays at 5:00pm', 'Hebrew 1 · Wed 5:00pm'],
    ['Hebrew 1', 'Hebrew 1'],
  ])('Hebrew %j → %s', (name, expected) => {
    expect(sessionName(name, 'hebrew', 'short')).toBe(expected)
  })

  it.each([
    ['{camp} Family School - East Bay cohort', 'Family School EB'],
    ['{camp} Family School - San Francisco cohort', 'Family School SF'],
    ['{camp} Family School (Marin Cohort)', '{camp} Family School (Marin Cohort)'],
  ])('Family School %j → %s', (name, expected) => {
    expect(sessionName(name, 'school', 'short')).toBe(expected)
  })

  it.each([
    ['Family Camp 2: Keshet LGBTQ Weekend', 'Family Camp 2'],
    ['Family Camp 5: JFAM Weekend (w/ kids 10 and under)', 'Family Camp 5'],
    ['Family Camp 10: Labor Day Weekend', 'Family Camp 10'],
    ['Family Camp 3', 'Family Camp 3'],
    // Un-numbered names stay as short does today.
    ['Ready, Set, Camp', 'Ready, Set, Camp'],
    ['Winter Family Camp', 'Winter Family Camp'],
    ['JFAM Winter Family Camp', 'JFAM Winter Family Camp'],
    ['Spring Family Camp', 'Spring Family Camp'],
  ])('Family Camp short carries no subtitle: %j → %s', (name, expected) => {
    expect(sessionName(name, 'family', 'short')).toBe(expected)
  })

  it('leaves everything else exactly as short renders today', () => {
    expect(sessionName('Session 2', 'main', 'short')).toBe('Session 2')
    expect(sessionName('Rock and River Quest', 'quest', 'short')).toBe('Rock and River Quest')
    expect(sessionName("Women's Weekend (3 nights)", 'adult', 'short')).toBe("Women's Weekend")
    expect(sessionName('Gold Rush', 'other', 'short')).toBe('Gold Rush')
    expect(sessionName('Counselor In-Training', 'scit', 'short')).toBe('Counselor In-Training')
  })

  it('leaves full unchanged for every ruled program', () => {
    const n = "{camp}'s B*Mitzvah Program Year 1 - East Bay"
    expect(sessionName(n, 'bmitzvah', 'full')).toBe(n)
    expect(sessionName('Hebrew 1 - Wednesdays at 4pm', 'hebrew', 'full')).toBe(
      'Hebrew 1 - Wednesdays at 4pm'
    )
  })
})
