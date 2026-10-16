import type { GenderBasis } from '../../types/velocity'
// The switcher the owner named for this picker: the Requests Round filter's (R1/R2/R3), the kit's segmented
// control. To use another switcher, swap this import; the props below are all it needs.
import { AidSegmented as Switcher } from '../camperships/kit/Segmented'

const OPTIONS = [
  { value: 'field', label: 'Gender field' },
  { value: 'identity', label: 'Gender identity' },
] as const satisfies ReadonlyArray<{ value: GenderBasis; label: string }>

/**
 * Velocity's Gender picker (#2898 owner answer #78): the Gender field (default, cabin pacing) or gender identity.
 * Unlike the Round filter it never clears: clicking the lit choice keeps it, so there is always one value.
 */
export function GenderBasisPicker({
  value,
  onChange,
}: {
  value: GenderBasis
  onChange: (value: GenderBasis) => void
}) {
  return (
    <Switcher
      label="Gender"
      value={value}
      options={OPTIONS}
      onChange={(v) => {
        if (v !== value) onChange(v)
      }}
    />
  )
}
