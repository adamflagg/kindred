import { PopulateFromPreviousYear } from '../admin/PopulateFromPreviousYear'
import { RegistrationDatesConfig } from '../admin/RegistrationDatesConfig'
import { SessionConfigTable } from '../admin/SessionConfigTable'

export function ManageRegistrationPage() {
  return (
    <div className="space-y-4">
      <PopulateFromPreviousYear />
      <RegistrationDatesConfig />
      <SessionConfigTable />
    </div>
  )
}
