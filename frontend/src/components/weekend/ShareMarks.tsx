/**
 * ShareMarks — the anchor circle and the flush capsule, drawn.
 *
 * `shareMarks.ts` grades two independent questions into two mark families:
 * the radio's always-on anchor (`resolveShareAnchor`, zero or one mark) and
 * the checkbox cluster (`resolveShareCluster`, zero to three ticks, flushed
 * into one capsule). This module and the `MarkRun` renderer it delegates to
 * own ONLY the markup — the vocabulary, the colors, the icons and the wording
 * are LOCKED there
 * (`docs/plans/2026-08-22-share-icons-spec.md`, LOCAL ONLY, artifact
 * `LOCKED-final-picks`); read that module's header before changing any of
 * them here.
 *
 * The anchor draws lucide's `Handshake` fixed, in `shareMarkRuns.ts` rather
 * than the vocabulary module — every anchor state draws the same icon, so
 * `ShareAnchorSpec` carries no `Icon` field at all (see `shareMarks.ts`'s
 * header comment).
 *
 * ## The emphasis wrappers (spec 2026-08-24)
 *
 * Each mark family is wrapped in a span that carries the halo and the
 * breathe for the "open to sharing" set — see `shareEmphasis.ts` for which
 * marks qualify and why the transform must never land on a glyph inside a
 * capsule. The wrappers render UNCONDITIONALLY so there is one DOM shape to
 * reason about; only the glow class and the motion handle are conditional.
 * The anchor and the cluster get SEPARATE wrappers even when both are hot,
 * because they answer separate questions and the parent spec forbids the
 * anchor looking merged into the cluster.
 *
 * Drawing moved to `MarkRun` (kindred#2759): `familyShareRuns` packages the
 * anchor and the cluster as two SEPARATE `MarkRunSpec`s, and `MarkRun` draws
 * each one's wrapper as described above, keyed on the spec's `hot`.
 */
import type { RosterPartyRow } from '../../types/lodging'
import { MarkRuns } from './MarkRun'
import { familyShareRuns } from './shareMarkRuns'

export function ShareMarks({ party }: { party: RosterPartyRow }) {
  return <MarkRuns runs={familyShareRuns(party)} />
}
