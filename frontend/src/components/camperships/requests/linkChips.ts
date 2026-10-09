/**
 * The filters a link carries, as removable toolbar chips (design-language §6; answers 1a R3–R6). Each
 * chip's old sentence is its title. Pure: the page reads the URL and the two id reads, this words them.
 */
import { OP_MISSING } from './opFilter'
import { missingWords, REPORT_WORDS, reportWords } from './reportFilter'
import { figureWords, type SeasonFigure } from './seasonFigure'

export interface LinkChip {
  readonly key: 'live' | 'op' | 'report' | 'figure'
  readonly label: string
  readonly title: string
  /** A failed read: the chip is amber. */
  readonly warn: boolean
  /** Its label runs the read again (Try Again). */
  readonly retry: boolean
}

type ReadState = 'ready' | 'reading' | 'missing' | 'failed'

export interface LinkChipInput {
  readonly live: boolean
  readonly figure: SeasonFigure | null
  readonly op: { readonly on: boolean; readonly state: ReadState; readonly count: number }
  readonly report: {
    readonly on: boolean
    readonly state: ReadState
    readonly kind: 'statistics' | 'programs'
    readonly count: number
    /** Ids the count holds that this list does not. */
    readonly missing: number
  }
}

const SHOW_ALL = '✕ shows all.'
const RETRY_LABEL = "Couldn't read · Try Again"

const chip = (
  key: LinkChip['key'],
  label: string,
  title: string,
  extra: { warn?: boolean; retry?: boolean } = {}
): LinkChip => ({ key, label, title, warn: extra.warn ?? false, retry: extra.retry ?? false })

export function linkChips(input: LinkChipInput): LinkChip[] {
  const out: LinkChip[] = []
  if (input.live) {
    out.push(
      chip(
        'live',
        'Live only',
        `Live requests only, as the budget counts them (from Season › Rounds & budget). ${SHOW_ALL}`
      )
    )
  }
  const { op, report, figure } = input
  if (op.on) {
    if (op.state === 'failed') {
      out.push(
        chip(
          'op',
          RETRY_LABEL,
          "Couldn't read that History operation. Try Again, or ✕ to show all.",
          {
            warn: true,
            retry: true,
          }
        )
      )
    } else if (op.state === 'missing') {
      out.push(chip('op', 'History operation not found', `${OP_MISSING}. ${SHOW_ALL}`))
    } else if (op.state === 'reading') {
      out.push(
        chip('op', 'Reading History operation…', `Reading that History operation. ${SHOW_ALL}`)
      )
    } else {
      out.push(
        chip(
          'op',
          `History operation · ${String(op.count)}`,
          `The ${String(op.count)} ${op.count === 1 ? 'request' : 'requests'} in one History operation (from Season › History). ${SHOW_ALL}`
        )
      )
    }
  }
  if (report.on) {
    const name = REPORT_WORDS[report.kind]
    if (report.state === 'failed') {
      out.push(
        chip(
          'report',
          RETRY_LABEL,
          "Couldn't read the requests behind that Reports count. Try Again, or ✕ to show all.",
          { warn: true, retry: true }
        )
      )
    } else if (report.state === 'reading') {
      out.push(
        chip(
          'report',
          'Reading Reports count…',
          `Reading the requests behind one Reports count. ${SHOW_ALL}`
        )
      )
    } else {
      const words = reportWords(report.count, report.kind)
      const gap = missingWords(report.missing)
      const missing = gap === null ? '' : ` · ${gap}`
      out.push(
        chip('report', `${name} count · ${String(report.count)}`, `${words}${missing}. ${SHOW_ALL}`)
      )
    }
  }
  if (figure !== null) {
    const words = figureWords(figure)
    out.push(chip('figure', words, `${words}: the requests behind one Season figure. ${SHOW_ALL}`))
  }
  return out
}
