/**
 * Which cabin the drag is over — the board's collision policy, in one place.
 *
 * POINTER FIRST, and that half is summer's: without it a drop released over
 * dead space snaps to whichever cabin happens to be nearest, placing a family
 * somewhere nobody chose.
 *
 * The half that is new is what happens when the pointer is inside NO cabin.
 * The board is a wrapping grid with a 12px gap, so a pointer travelling
 * between two cards spends several frames in a gutter. `pointerWithin` returns
 * nothing there, and the `rectIntersection` fallback scores by overlap of the
 * DRAGGED RECT — a ~200px overlay that straddles several cards — so the winner
 * is frequently a card the pointer never entered, and it changes as the
 * overlay slides.
 *
 * Measured on the board at 1600px, one deliberate diagonal move across four
 * intended targets: SIX `over` transitions including two reversals, one of
 * them an 86ms flash on a card the pointer never touched. That is visible as
 * the drop ring clicking between neighbours — and it is not only cosmetic,
 * because the ring and the drop target are the same `over`. Releasing during
 * the flap places the family in a cabin the pointer was never over.
 *
 * So: while the pointer is in dead space, HOLD the last cabin it was actually
 * inside, for as long as that cabin is still among the rects the drag
 * overlaps. Once it is not — the drag has genuinely left — the fallback speaks
 * again, and a release over dead space still lands somewhere rather than being
 * silently dropped.
 *
 * Stateful across calls BY DESIGN, which is why this is a factory rather than
 * a bare function: the held cabin is the state. `reset()` clears it, and the
 * board calls that on drag start and end so one gesture can never inherit the
 * previous gesture's hold.
 *
 * The two algorithms are injected so the policy is testable without building
 * dnd-kit's droppable registry and measured rects — the same reason
 * `ringPrecedence` and `needsFit` are pure modules rather than logic inside
 * the card.
 */
import { pointerWithin, rectIntersection } from '@dnd-kit/core'

type CollisionArgs = Parameters<typeof pointerWithin>[0]
type Collisions = ReturnType<typeof pointerWithin>

interface CollisionAlgorithms {
  pointerWithin: (args: CollisionArgs) => Collisions
  rectIntersection: (args: CollisionArgs) => Collisions
}

export interface BoardCollisionDetection {
  (args: CollisionArgs): Collisions
  /** Forget the held cabin. The board calls this on drag start and drag end. */
  reset: () => void
}

export function createBoardCollisionDetection(
  algorithms: CollisionAlgorithms = { pointerWithin, rectIntersection }
): BoardCollisionDetection {
  let heldId: string | null = null

  const detect = ((args: CollisionArgs): Collisions => {
    const pointerCollisions = algorithms.pointerWithin(args)
    if (pointerCollisions.length > 0) {
      heldId = String(pointerCollisions[0]?.id ?? '')
      return pointerCollisions
    }

    const rectCollisions = algorithms.rectIntersection(args)
    if (heldId === null) return rectCollisions

    // `find`, not a filter: dnd-kit reads the FIRST collision as `over`, so
    // returning the held one alone is the same answer with no ambiguity about
    // ordering.
    const held = rectCollisions.find((collision) => String(collision.id) === heldId)
    return held === undefined ? rectCollisions : [held]
  }) as BoardCollisionDetection

  detect.reset = () => {
    heldId = null
  }

  return detect
}
