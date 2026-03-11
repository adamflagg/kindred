import { PopulateFromPreviousYear } from '../admin/PopulateFromPreviousYear'
import { RegistrationDatesConfig } from '../admin/RegistrationDatesConfig'
import { GradeEligibilityConfig } from '../admin/GradeEligibilityConfig'
import { SessionBudgetConfig } from '../admin/SessionBudgetConfig'

export function ManageRegistrationPage() {
  return (
    <div className="space-y-4">
      <PopulateFromPreviousYear />
      <RegistrationDatesConfig />
      <GradeEligibilityConfig />
      <SessionBudgetConfig />
    </div>
  )
}
