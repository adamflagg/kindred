import { retryUnlessRefused } from '../../services/camperships/aidApi'

/**
 * Reports' reads retry a dropped connection, never a refusal: a 422 names a control the season can't
 * take (the reporting controls before 2027, an unknown ZIP group), a 404 an unknown report, a 403 a
 * read this user may not make; a 401 is a lapsed sign-in (`retryUnlessRefused` adds it). Retrying
 * those only keeps a spinner up before the sentence shows.
 */
export const reportRetry = retryUnlessRefused([403, 404, 422])
