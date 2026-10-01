import { Users } from 'lucide-react'
import { useParams } from 'react-router'

import { AidPageBand } from '../../components/camperships/shell/AidPageBand'
import { useAidAsOf } from '../../hooks/camperships/useAidAsOf'

/** `/aid/households/:householdCmId` (spec §6.3) before slice 1 builds it. */
export default function AidHouseholdPage() {
  const { householdCmId } = useParams()
  const asOf = useAidAsOf()
  return (
    <div className="space-y-3 sm:space-y-4">
      <AidPageBand icon={Users} title={`Household ${householdCmId ?? ''}`} asOf={asOf} />
      <div className="card-lodge text-muted-foreground p-6 text-sm">
        The household page is built in slice 1 (December).
      </div>
    </div>
  )
}
