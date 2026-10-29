/** A pill's words in sentence case: the first letter capitalised, the rest left as the source wrote it. */
export const sentenceCase = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * Where a request came from (design-language rule 9): staff made it with Add a Request… ("added"), the dashboard made
 * it from a registration ask ("reg. ask"), or made it from one that no one has reviewed yet (amber). `OriginMark`
 * draws them; a CSV or a sentence reuses the words.
 */
export type RequestOrigin = 'added' | 'reg_ask' | 'reg_ask_review'
export const ORIGIN_WORDS: Readonly<Record<RequestOrigin, string>> = {
  added: 'added',
  reg_ask: 'reg. ask',
  reg_ask_review: 'reg. ask · review',
}

/** CLOSED-SEASONS-DONE (CSD-4): the "Closed N" chip's title (ClosedChip). */
export const CLOSED_CHIP_TITLE =
  'Closed: this season is closed. Its requests show as they stood, and nothing in it needs doing.'
