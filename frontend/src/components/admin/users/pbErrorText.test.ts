import { describe, it, expect } from 'vitest'
import { ClientResponseError } from 'pocketbase'
import { pbErrorText } from './pbErrorText'

function pbError(response: Record<string, unknown>) {
  return new ClientResponseError({ status: 400, response })
}

describe('pbErrorText', () => {
  it('prefers the guard message nested in a batch failure and strips its period', () => {
    const err = pbError({
      status: 400,
      message: 'Batch transaction failed.',
      data: {
        requests: {
          '1': {
            code: 'batch_request_failed',
            message: 'Batch request failed.',
            response: {
              status: 403,
              message: "You can't change your own roles. Ask an admin.",
              data: {},
            },
          },
        },
      },
    })
    expect(pbErrorText(err)).toBe("You can't change your own roles. Ask an admin")
  })

  it('uses the first field error message', () => {
    const err = pbError({
      status: 400,
      message: 'Failed to create record.',
      data: { slug: { code: 'validation_not_unique', message: 'Value must be unique.' } },
    })
    expect(pbErrorText(err)).toBe('Value must be unique')
  })

  it('falls back to err.message, one trailing period stripped', () => {
    expect(pbErrorText(pbError({ status: 400, message: 'Something broke.', data: {} }))).toBe(
      'Something broke'
    )
    expect(pbErrorText(new Error('Network down'))).toBe('Network down')
  })

  it('handles non-errors', () => {
    expect(pbErrorText('nope')).toBe('Unknown error')
  })
})
