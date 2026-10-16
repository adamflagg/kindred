/**
 * Gender identity tokens (design language, "Gender identity" section; #2898). Every chart that splits by gender
 * identity takes its order, groups, names and colours from here, so a label wears one colour on every page.
 *
 * The labels are the ones the API sends (`bunking/gender_identity.py`): CampMinder's Gender Identity options,
 * "self-described" for a write-in and "not given" for no answer at all.
 */

/** Every label in the fixed order (owner answer #76 a), as `IDENTITY_ORDER` in `bunking/gender_identity.py`. */
export const GENDER_IDENTITY_ORDER: readonly string[] = [
  'Girl/woman',
  'Boy/man',
  'Non-binary',
  'Transgender girl/woman',
  'Transgender boy/man',
  'Agender',
  'Not listed above',
  'self-described',
  'Prefer not to answer',
  'not given',
]

export const ANOTHER_IDENTITY = 'Another identity'
export const NO_ANSWER = 'No answer'

/**
 * The five groups a chart with little room folds labels into (#75 a): stacked bars, the Trends lines and table,
 * Velocity's lines. Donuts, comparison tables, Retention, the drill-down and the CSV list every label.
 */
export const GENDER_IDENTITY_GROUPS: readonly string[] = [
  'Girl/woman',
  'Boy/man',
  'Non-binary',
  ANOTHER_IDENTITY,
  NO_ANSWER,
]

const OWN_GROUP = new Set(GENDER_IDENTITY_GROUPS.slice(0, 3))
const NO_ANSWER_LABELS = new Set(['Prefer not to answer', 'not given'])

/** The group a label folds into. A label CampMinder adds later is an identity someone gave: Another identity. */
export function identityGroup(label: string): string {
  if (OWN_GROUP.has(label)) return label
  if (NO_ANSWER_LABELS.has(label)) return NO_ANSWER
  return ANOTHER_IDENTITY
}

/** The labels Another identity holds, in order (the line under a grouped chart lists them with counts). */
export const ANOTHER_IDENTITY_MEMBERS: readonly string[] = GENDER_IDENTITY_ORDER.filter(
  (label) => identityGroup(label) === ANOTHER_IDENTITY
)

// Named colours (#77 a): distinct hues, validated for contrast on the light and dark cards. The two non-answers
// are greys that change with the theme, so they are CSS custom properties (`index.css`).
export const GENDER_GIRL_WOMAN = '#d9266b'
export const GENDER_BOY_MAN = '#1f8fc4'
export const GENDER_NON_BINARY = '#b8860f'
export const GENDER_TRANSGENDER_GIRL_WOMAN = '#a855c7'
export const GENDER_TRANSGENDER_BOY_MAN = '#1a9e77'
export const GENDER_AGENDER = '#e0662a'
export const GENDER_NOT_LISTED = '#6b7fd7'
export const GENDER_SELF_DESCRIBED = '#7a9a1e'
export const GENDER_ANOTHER_IDENTITY = '#8460c0'
export const GENDER_PREFER_NOT = 'var(--gender-prefer-not)'
export const GENDER_NOT_GIVEN = 'var(--gender-not-given)'

export const GENDER_IDENTITY_COLOR: Readonly<Record<string, string>> = {
  'Girl/woman': GENDER_GIRL_WOMAN,
  'Boy/man': GENDER_BOY_MAN,
  'Non-binary': GENDER_NON_BINARY,
  'Transgender girl/woman': GENDER_TRANSGENDER_GIRL_WOMAN,
  'Transgender boy/man': GENDER_TRANSGENDER_BOY_MAN,
  Agender: GENDER_AGENDER,
  'Not listed above': GENDER_NOT_LISTED,
  'self-described': GENDER_SELF_DESCRIBED,
  'Prefer not to answer': GENDER_PREFER_NOT,
  'not given': GENDER_NOT_GIVEN,
  [ANOTHER_IDENTITY]: GENDER_ANOTHER_IDENTITY,
  [NO_ANSWER]: GENDER_NOT_GIVEN,
}

/** The binary Gender field's words where a chart still reads it (Velocity's cabin pacing, #78). */
export const GENDER_FIELD_LABEL: Readonly<Record<string, string>> = { F: 'Girls', M: 'Boys' }

/** A label's colour; F and M (the Gender field) wear Girl/woman's and Boy/man's; an unknown label Another's. */
export function genderIdentityColor(label: string): string {
  if (label === 'F') return GENDER_GIRL_WOMAN
  if (label === 'M') return GENDER_BOY_MAN
  return GENDER_IDENTITY_COLOR[label] ?? GENDER_ANOTHER_IDENTITY
}

const DISPLAY: Readonly<Record<string, string>> = {
  'self-described': 'Self-described',
  'not given': 'Not given',
}

/** The label as staff read it: the API's two lower-case labels capitalised. Camperships' own words are unchanged. */
export function genderDisplayName(label: string): string {
  return DISPLAY[label] ?? label
}

// Unknown labels sort after Not listed above and before self-described (so before the non-answers); groups sit
// beside their members.
const RANK: Readonly<Record<string, number>> = {
  ...Object.fromEntries(GENDER_IDENTITY_ORDER.map((label, i) => [label, i])),
  [ANOTHER_IDENTITY]: GENDER_IDENTITY_ORDER.indexOf('self-described') + 0.5,
  [NO_ANSWER]: GENDER_IDENTITY_ORDER.length,
}
const UNLISTED = GENDER_IDENTITY_ORDER.indexOf('self-described') - 0.5

export function identityOrderIndex(label: string): number {
  return RANK[label] ?? UNLISTED
}

/** Items in the fixed order (#76 a); a stable sort, so equal ranks keep their order. */
export function sortByIdentityOrder<T>(items: readonly T[], labelOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => identityOrderIndex(labelOf(a)) - identityOrderIndex(labelOf(b)))
}

/** Another identity folds several identities, so its segment, swatch and line are hatched (dashed on a line). */
export const GENDER_HATCH_IMAGE =
  'repeating-linear-gradient(45deg, rgba(255,255,255,0.38) 0 2px, transparent 2px 6px)'

export function genderHatched(label: string): boolean {
  return label === ANOTHER_IDENTITY
}
