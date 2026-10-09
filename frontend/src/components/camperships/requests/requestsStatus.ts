/**
 * What the Requests toolbar's one status slot says (design-language §5–6; answers 1a R8–R11). A failed
 * save, the checked rows, a bulk result and the March File result used to be four boxes above the grid;
 * now the most urgent says its words here and the grid starts at the same height every time.
 * Precedence: a failed save, a bulk result (until dismissed), the checked count, the March File.
 */

/** What the last tick did: its words, and exactly the lines it ticked (bulk ruling Q4). */
export interface TickResult {
  readonly words: string
  readonly lines: readonly string[]
  /**
   * Some of what was sent was already ticked. The server says how many, not which, so the list is
   * headed "Sent" rather than claimed as ticked.
   */
  readonly someAlreadyTicked: boolean
}

export interface SaveFailure {
  readonly key: string
  readonly name: string
  readonly message: string
}

export interface StatusInput {
  readonly failures: readonly SaveFailure[]
  readonly selected: number
  readonly hidden: number
  readonly result: TickResult | null
  readonly march: { readonly said: string | null; readonly error: string | null } | null
}

export interface RequestsStatus {
  readonly text: string
  /** The full words (a native title). */
  readonly title: string
  readonly tone: 'muted' | 'ok' | 'warn'
  /** A failed save: the request key Go Back returns to. */
  readonly goBack?: string
  /** Which result a ✕ clears. */
  readonly dismiss?: 'result' | 'march'
}

const LISTED = 12

function resultWords(result: TickResult): string {
  const list =
    result.lines.length === 0
      ? ''
      : `${result.someAlreadyTicked ? '. Sent: ' : ': '}${result.lines.slice(0, LISTED).join(', ')}${
          result.lines.length > LISTED ? ` and ${String(result.lines.length - LISTED)} more` : ''
        }`
  return `${result.words}${list}`
}

export function requestsStatus(input: StatusInput): RequestsStatus | null {
  const [first, ...more] = input.failures
  if (first !== undefined) {
    const said = `Couldn't save ${first.name}'s Round 2 ask`
    return {
      text: `⚠ ${said}${more.length > 0 ? ` (+${String(more.length)} more)` : ''}`,
      title: `${said}: ${first.message} Go Back to the row to try again.`,
      tone: 'warn',
      goBack: first.key,
    }
  }
  if (input.result !== null) {
    // A fresh result stays until dismissed or the next tick starts; rows still checked ride after it.
    const still = input.selected > 0 ? ` · ${String(input.selected)} still checked` : ''
    const words = `${resultWords(input.result)}${still}`
    return { text: `✓ ${words}`, title: words, tone: 'ok', dismiss: 'result' }
  }
  if (input.selected > 0) {
    const text = `${String(input.selected)} checked${input.hidden > 0 ? ` · ${String(input.hidden)} hidden` : ''}`
    return {
      text,
      title:
        input.hidden > 0
          ? `${text} by the search or filters, still checked and still in Check Accepted…`
          : text,
      tone: 'muted',
    }
  }
  if (input.march !== null) {
    if (input.march.error !== null) {
      return { text: input.march.error, title: input.march.error, tone: 'warn', dismiss: 'march' }
    }
    if (input.march.said !== null) {
      return { text: input.march.said, title: input.march.said, tone: 'ok', dismiss: 'march' }
    }
  }
  return null
}
