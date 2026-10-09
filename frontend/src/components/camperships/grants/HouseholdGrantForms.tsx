import type { EditorExits } from '../household/editorExits'
import type { GrantFormOpening } from '../household/HouseholdSections'
import { HH_BUTTON } from '../household/householdStyles'
import { useAidGrants } from '../../../hooks/camperships/useAidGrants'
import type { ApiAidHouseholdPage } from '../../../types/api-types'
import { CommitmentForm } from './CommitmentForm'
import { PlaceCamperForm } from './PlaceCamperForm'

type HouseholdGrant = ApiAidHouseholdPage['grants'][number]

/** Open a form through the page's one open editor (it saves what is typed first), as Correct… does. */
const opener = (exits: EditorExits | undefined, opening: GrantFormOpening) => () => {
  if (exits === undefined) opening.setOpen(true)
  else exits.beforeLeave(() => opening.setOpen(true))
}

/**
 * The household page's "Add a Commitment…" (rulings:340): slice 3's commitment form, its campers the
 * page's own requests. Closed, the button; open, the form.
 */
export function HouseholdAddCommitment({
  page,
  opening,
  exits,
}: {
  page: ApiAidHouseholdPage
  opening: GrantFormOpening
  exits?: EditorExits | undefined
}) {
  if (!opening.open) {
    return (
      <button type="button" className={HH_BUTTON} onClick={opener(exits, opening)}>
        Add a Commitment…
      </button>
    )
  }
  return (
    <CommitmentForm
      year={page.year}
      household={{ rows: page.requests.map((r) => r.row) }}
      onCancel={() => opening.setOpen(false)}
      onDone={(words) => {
        opening.setOpen(false)
        opening.done(words)
      }}
    />
  )
}

/**
 * "Place on a Camper…" on one grant row (rulings:340): only for a line Grants lists as needing a
 * camper (`needs_camper`, matched on the transaction); it opens slice 3's placement form with the
 * household's candidates and the suggestion pre-picked. Nothing while Grants' read loads.
 */
export function HouseholdPlaceOnCamper({
  page,
  grant,
  opening,
  exits,
}: {
  page: ApiAidHouseholdPage
  grant: HouseholdGrant
  opening: GrantFormOpening
  exits?: EditorExits | undefined
}) {
  const grants = useAidGrants()
  const need = grants.data?.needs_camper.find(
    (n) => n.grant.transaction_cm_id === grant.transaction_cm_id
  )
  if (need === undefined) return null
  if (!opening.open) {
    return (
      <button type="button" className={HH_BUTTON} onClick={opener(exits, opening)}>
        Place on a Camper…
      </button>
    )
  }
  return (
    <PlaceCamperForm
      need={need}
      year={page.year}
      onCancel={() => opening.setOpen(false)}
      onDone={(words) => {
        opening.setOpen(false)
        opening.done(words)
      }}
    />
  )
}
