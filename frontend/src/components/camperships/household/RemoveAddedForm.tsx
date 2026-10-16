import { useAidRetireAddition } from '../../../hooks/camperships/useAidIntakeWrites'
import { Effects } from '../kit/Effects'
import { ReasonForm } from './ReasonForm'

/**
 * Remove… on an added request's card (the form-intake mock, steps 16–17): a reason, then the addition retired and its
 * request withdrawn, decisions kept. The card offers it only while no round is posted and the request is not cancelled
 * in Kindred (`removeBlock`); a refusal the server still makes shows on the form. Its own component, so the write's
 * hook mounts only while the form is open.
 * A rule-made request (PR 4b; owner #83: Remove… for a request that's wrong, Cancel Request… for a family that
 * declined) says on the form itself that removing it is permanent: the rule never re-makes a slot that had an addition.
 */
export function RemoveAddedForm({
  year,
  additionId,
  ruleMade = false,
  onDone,
}: {
  year: number
  additionId: string
  ruleMade?: boolean
  onDone: () => void
}) {
  const retire = useAidRetireAddition()
  return (
    <ReasonForm
      head={ruleMade ? 'Remove this request the dashboard made' : 'Remove this added request'}
      label="Reason"
      submitLabel="Remove Request"
      hint={
        <Effects
          items={[
            {
              sym: 'ok',
              text: (
                <>
                  <b>Withdraws the request</b>: it leaves every list
                </>
              ),
              then: '→ its decisions and history are kept',
            },
            ...(ruleMade
              ? [
                  {
                    sym: 'hand' as const,
                    text: (
                      <>
                        <b>Permanent</b>: the dashboard never makes this request again from the
                        registration ask
                      </>
                    ),
                  },
                ]
              : []),
            { sym: 'hand', text: 'A family that declined aid: use Cancel Request… instead' },
          ]}
        />
      }
      onSubmit={(reason) => retire.mutateAsync({ year, additionId, reason }).then(onDone)}
      onCancel={onDone}
    />
  )
}
