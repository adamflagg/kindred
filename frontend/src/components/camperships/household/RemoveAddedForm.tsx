import { useAidRetireAddition } from '../../../hooks/camperships/useAidIntakeWrites'
import { Effects } from '../kit/Effects'
import { ReasonForm } from './ReasonForm'

/**
 * Remove… on an added request's card (the form-intake mock, steps 16–17): a reason, then the addition retired and its
 * request withdrawn, decisions kept. The card offers it only while no round is posted (`removeBlock`); a refusal the
 * server still makes shows on the form. Its own component, so the write's hook mounts only while the form is open.
 */
export function RemoveAddedForm({
  year,
  additionId,
  onDone,
}: {
  year: number
  additionId: string
  onDone: () => void
}) {
  const retire = useAidRetireAddition()
  return (
    <ReasonForm
      head="Remove this added request"
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
            { sym: 'hand', text: 'A family that declined aid: use Cancel Request… instead' },
          ]}
        />
      }
      onSubmit={(reason) => retire.mutateAsync({ year, additionId, reason }).then(onDone)}
      onCancel={onDone}
    />
  )
}
