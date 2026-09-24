/**
 * The neutral card-mark spec (kindred#2759).
 *
 * The family share marks and the adult Jotform marks are the SAME drawing: a
 * 20px circle, or a flush capsule of them, with an optional halo. What
 * differs is only who decides the icon, the tone and whether it glows. Each
 * resolver (`familyShareRuns`, `resolveBunkingRequestRuns`) produces these;
 * one renderer (`MarkRun`) draws them. Emphasis keys on `hot` — the renderer
 * never reads a family field, which is what let the adult marks reuse it.
 */
import type { LucideIcon } from 'lucide-react'

export interface MarkSpec {
  readonly key: string
  readonly Icon: LucideIcon
  readonly className: string
  readonly tooltip: string
  readonly ariaLabel: string
}

export interface MarkRunSpec {
  readonly key: string
  /** One mark draws a solo circle; two or more flush into a capsule. */
  readonly marks: readonly MarkSpec[]
  /** Glow and breathe. Decided by the resolver, never by the renderer. */
  readonly hot: boolean
  readonly testId?: string | undefined
  /** When set, an amber corner dot is drawn with this test id. */
  readonly dotTestId?: string | undefined
}
