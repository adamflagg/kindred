/**
 * Season › History's invented season (fictional set, tests/CLAUDE.md): two staff sign-ins, household
 * ids from 1000001, every figure invented. Shapes are the generated types', so a server change fails tsc.
 */
import type {
  ApiAidHistoryOperation,
  ApiAidHistoryOperationDetail,
  ApiAidHistoryPage,
  ApiAidHistoryRow,
} from '../../../types/api-types'

export const FINANCE_EMAIL = 'finance@example.com'
export const REGISTRAR_EMAIL = 'registrar@example.com'

export const OP_SHARE: ApiAidHistoryOperation = {
  operation_id: 'op0000000000001',
  at: '2027-04-10T16:42:00Z',
  actor: REGISTRAR_EMAIL,
  kind: 'money',
  reason: 'Family emailed',
  // The writer logs the whole share set as one operation: the entered household and the remainder's.
  rows: 2,
  counts: [{ entity: 'aid_payer_shares', action: 'set_household_share', rows: 2 }],
  rules_versions: [],
  rules_sections: [],
}

export const OP_RELEASE: ApiAidHistoryOperation = {
  operation_id: 'op0000000000002',
  at: '2027-04-10T16:31:00Z',
  actor: REGISTRAR_EMAIL,
  kind: 'holds',
  reason: 'Income confirmed by phone',
  rows: 1,
  counts: [{ entity: 'aid_hold_events', action: 'release', rows: 1 }],
  rules_versions: [],
  rules_sections: [],
}

export const OP_POSTED: ApiAidHistoryOperation = {
  operation_id: 'op0000000000003',
  at: '2027-04-09T23:05:00Z',
  actor: REGISTRAR_EMAIL,
  kind: 'offers',
  reason: '',
  rows: 30,
  // The server's code is `post` (EventKind); History words it "Posted" (ACTION_WORDS).
  counts: [{ entity: 'aid_decisions', action: 'post', rows: 30 }],
  rules_versions: [],
  rules_sections: [],
}

/**
 * A round's first Posted tick: its decisions and the rules locks it triggers, one operation. The server
 * files a mixed operation as `offers` (H6), so it is not hidden from a reader without `rules`.
 */
export const OP_POSTED_LOCKING: ApiAidHistoryOperation = {
  operation_id: 'op0000000000008',
  at: '2027-03-01T18:05:00Z',
  actor: REGISTRAR_EMAIL,
  kind: 'offers',
  reason: '',
  rows: 382,
  counts: [
    { entity: 'aid_decisions', action: 'post', rows: 380 },
    { entity: 'aid_rules', action: 'lock', rows: 2 },
  ],
  rules_versions: [3],
  rules_sections: ['income', 'tiers'],
}

export const OP_RULES_SAVE: ApiAidHistoryOperation = {
  operation_id: 'op0000000000004',
  at: '2027-04-08T21:20:00Z',
  actor: FINANCE_EMAIL,
  kind: 'rules',
  reason: '',
  rows: 1,
  counts: [{ entity: 'aid_rules', action: 'save', rows: 1 }],
  rules_versions: [4],
  rules_sections: [],
}

export const OP_RULES_APPROVE: ApiAidHistoryOperation = {
  operation_id: 'op0000000000005',
  at: '2027-03-02T23:48:00Z',
  actor: FINANCE_EMAIL,
  kind: 'rules',
  reason: 'Finance committee',
  rows: 2,
  counts: [{ entity: 'aid_rules', action: 'approve', rows: 2 }],
  rules_versions: [3],
  rules_sections: ['awards', 'budget'],
}

export const OP_RULES_CREATE: ApiAidHistoryOperation = {
  operation_id: 'op0000000000006',
  at: '2027-04-08T22:00:00Z',
  actor: FINANCE_EMAIL,
  kind: 'rules',
  reason: '',
  rows: 1,
  counts: [{ entity: 'aid_rules', action: 'save', rows: 1 }],
  rules_versions: [5],
  rules_sections: [],
}

export const OP_INTAKE: ApiAidHistoryOperation = {
  operation_id: 'op0000000000007',
  at: '2027-04-08T18:02:00Z',
  actor: 'system:intake',
  kind: 'intake',
  reason: '',
  rows: 8,
  counts: [
    { entity: 'aid_applications', action: 'create', rows: 3 },
    { entity: 'aid_requests', action: 'update', rows: 5 },
  ],
  rules_versions: [],
  rules_sections: [],
}

/**
 * The same operation as the server sends it to a reader without `financial_aid.rules` (H6): only the
 * `aid_rules` rows are stripped, from the counts, the rows total, `rules_versions` and `rules_sections`.
 */
export const OP_POSTED_LOCKING_REGISTRAR: ApiAidHistoryOperation = {
  ...OP_POSTED_LOCKING,
  rows: 380,
  counts: [{ entity: 'aid_decisions', action: 'post', rows: 380 }],
  rules_versions: [],
  rules_sections: [],
}

/** The registrar's first page: no rules-only operations (the server leaves them out), no intake. */
export const PAGE: ApiAidHistoryPage = {
  year: 2027,
  page: 1,
  per_page: 50,
  total: 3,
  operations: [OP_SHARE, OP_RELEASE, OP_POSTED],
  actors: [REGISTRAR_EMAIL],
}

/** Finance's first page: the rules operations too. */
export const FINANCE_PAGE: ApiAidHistoryPage = {
  year: 2027,
  page: 1,
  per_page: 50,
  total: 6,
  operations: [OP_SHARE, OP_RELEASE, OP_POSTED, OP_RULES_CREATE, OP_RULES_SAVE, OP_RULES_APPROVE],
  actors: [FINANCE_EMAIL, REGISTRAR_EMAIL],
}

const row = (
  fields: Partial<ApiAidHistoryRow> & Pick<ApiAidHistoryRow, 'entity' | 'entity_id' | 'action'>
): ApiAidHistoryRow => ({
  at: '2027-04-10T16:42:00Z',
  actor: REGISTRAR_EMAIL,
  reason: '',
  before: null,
  after: null,
  changes: [],
  ...fields,
})

/**
 * As `_replace_shares` logs `set_household_share`: percents are `_pct_text` strings ("40"), the entered
 * household's row carries `entered`, and the other household's share becomes the remainder (an update).
 */
export const DETAIL_SHARE: ApiAidHistoryOperationDetail = {
  year: 2027,
  operation: OP_SHARE,
  rows: [
    row({
      entity: 'aid_payer_shares',
      entity_id: 'req000000000009:1000001',
      action: 'set_household_share',
      reason: 'Family emailed',
      before: {
        actor: 'system:intake',
        household_cm_id: 1000001,
        note: '',
        request: 'req000000000009',
        share_pct: '100',
        source: 'intake_default',
        year: 2027,
      },
      after: {
        actor: REGISTRAR_EMAIL,
        household_cm_id: 1000001,
        note: 'Family emailed',
        request: 'req000000000009',
        share_pct: '60',
        source: 'staff',
        year: 2027,
      },
      changes: [
        { path: ['actor'], kind: 'changed', before: 'system:intake', after: REGISTRAR_EMAIL },
        { path: ['note'], kind: 'changed', before: '', after: 'Family emailed' },
        { path: ['share_pct'], kind: 'changed', before: '100', after: '60' },
        { path: ['source'], kind: 'changed', before: 'intake_default', after: 'staff' },
      ],
    }),
    row({
      entity: 'aid_payer_shares',
      entity_id: 'req000000000009:1000002',
      action: 'set_household_share',
      reason: 'Family emailed',
      after: {
        actor: REGISTRAR_EMAIL,
        entered: { household_cm_id: 1000002, share_pct: '40' },
        household_cm_id: 1000002,
        note: 'Family emailed',
        request: 'req000000000009',
        share_pct: '40',
        source: 'staff',
        year: 2027,
      },
      changes: [
        { path: ['actor'], kind: 'added', after: REGISTRAR_EMAIL },
        { path: ['entered', 'household_cm_id'], kind: 'added', after: 1000002 },
        { path: ['entered', 'share_pct'], kind: 'added', after: '40' },
        { path: ['household_cm_id'], kind: 'added', after: 1000002 },
        { path: ['note'], kind: 'added', after: 'Family emailed' },
        { path: ['request'], kind: 'added', after: 'req000000000009' },
        { path: ['share_pct'], kind: 'added', after: '40' },
        { path: ['source'], kind: 'added', after: 'staff' },
        { path: ['year'], kind: 'added', after: 2027 },
      ],
    }),
  ],
}

export const DETAIL_RELEASE: ApiAidHistoryOperationDetail = {
  year: 2027,
  operation: OP_RELEASE,
  rows: [
    row({
      entity: 'aid_hold_events',
      entity_id: 'req000000000004:placeholder_income',
      action: 'release',
      reason: 'Income confirmed by phone',
      // As `_hold_write` logs it: the release's `fact` stays on the row, out of the log.
      after: {
        actor: REGISTRAR_EMAIL,
        code: 'placeholder_income',
        event: 'release',
        note: 'Income confirmed by phone',
        request: 'req000000000004',
        year: 2027,
      },
      changes: [
        { path: ['actor'], kind: 'added', after: REGISTRAR_EMAIL },
        { path: ['code'], kind: 'added', after: 'placeholder_income' },
        { path: ['event'], kind: 'added', after: 'release' },
        { path: ['note'], kind: 'added', after: 'Income confirmed by phone' },
        { path: ['request'], kind: 'added', after: 'req000000000004' },
        { path: ['year'], kind: 'added', after: 2027 },
      ],
    }),
  ],
}

/** As `_post_write` logs a tick (`amount` a Decimal, so the log holds its exact string): the receipt `snapshot` stays on the row, out of the log. */
export const DETAIL_POSTED: ApiAidHistoryOperationDetail = {
  year: 2027,
  operation: OP_POSTED,
  rows: Array.from({ length: 30 }, (_, index) => {
    const request = `req${String(index + 1).padStart(12, '0')}`
    return row({
      at: '2027-04-09T23:05:00Z',
      entity: 'aid_decisions',
      entity_id: `${request}:1`,
      action: 'post',
      after: {
        actor: REGISTRAR_EMAIL,
        amount: '1420',
        effective_on: '2027-04-09',
        event: 'post',
        lock_source: 'tick',
        request,
        round: 1,
        rules_version: 3,
        year: 2027,
      },
      changes: [
        { path: ['actor'], kind: 'added', after: REGISTRAR_EMAIL },
        { path: ['amount'], kind: 'added', after: '1420' },
        { path: ['effective_on'], kind: 'added', after: '2027-04-09' },
        { path: ['event'], kind: 'added', after: 'post' },
        { path: ['lock_source'], kind: 'added', after: 'tick' },
        { path: ['request'], kind: 'added', after: request },
        { path: ['round'], kind: 'added', after: 1 },
        { path: ['rules_version'], kind: 'added', after: 3 },
        { path: ['year'], kind: 'added', after: 2027 },
      ],
    })
  }),
}

/** A Round 3 amount (`award`): a Decided figure, pending finance's approval (⚠ Decision 4). */
export const ROW_ROUND3_AWARD: ApiAidHistoryRow = row({
  entity: 'aid_decisions',
  entity_id: 'req000000000011:3',
  action: 'award',
  after: {
    amount: '500',
    event: 'award',
    needs_approval: true,
    request: 'req000000000011',
    round: 3,
  },
  changes: [
    { path: ['amount'], kind: 'added', after: '500' },
    { path: ['event'], kind: 'added', after: 'award' },
    { path: ['needs_approval'], kind: 'added', after: true },
    { path: ['request'], kind: 'added', after: 'req000000000011' },
    { path: ['round'], kind: 'added', after: 3 },
  ],
})

export const DETAIL_RULES_SAVE: ApiAidHistoryOperationDetail = {
  year: 2027,
  operation: OP_RULES_SAVE,
  rows: [
    row({
      at: '2027-04-08T21:20:00Z',
      actor: FINANCE_EMAIL,
      entity: 'aid_rules',
      entity_id: '2027:4',
      action: 'save',
      // Trimmed to the one section the diff touches; the real row holds the whole document.
      before: {
        document: { awards: { minimum: '250' } },
        section_status: { awards: { state: 'approved', approved_by: FINANCE_EMAIL } },
      },
      after: {
        document: { awards: { minimum: '300' } },
        section_status: {
          awards: { state: 'draft', approved_by: FINANCE_EMAIL, edited_by: FINANCE_EMAIL },
        },
      },
      changes: [
        { path: ['document', 'awards', 'minimum'], kind: 'changed', before: '250', after: '300' },
        { path: ['section_status', 'awards', 'edited_by'], kind: 'added', after: FINANCE_EMAIL },
        {
          path: ['section_status', 'awards', 'state'],
          kind: 'changed',
          before: 'approved',
          after: 'draft',
        },
      ],
    }),
  ],
}

const approvalChanges = (section: string) => [
  {
    path: ['section_status', section, 'approved_at'],
    kind: 'added' as const,
    after: '2027-03-02T23:48:00Z',
  },
  {
    path: ['section_status', section, 'approved_by'],
    kind: 'added' as const,
    after: FINANCE_EMAIL,
  },
  { path: ['section_status', section, 'note'], kind: 'added' as const, after: 'Finance committee' },
  {
    path: ['section_status', section, 'state'],
    kind: 'changed' as const,
    before: 'draft',
    after: 'approved',
  },
]

export const DETAIL_RULES_APPROVE: ApiAidHistoryOperationDetail = {
  year: 2027,
  operation: OP_RULES_APPROVE,
  rows: ['awards', 'budget'].map((section) =>
    row({
      at: '2027-03-02T23:48:00Z',
      actor: FINANCE_EMAIL,
      entity: 'aid_rules',
      entity_id: `2027:3:${section}`,
      action: 'approve',
      reason: 'Finance committee',
      before: { section_status: { [section]: { state: 'draft' } } },
      after: {
        section_status: {
          [section]: {
            state: 'approved',
            approved_at: '2027-03-02T23:48:00Z',
            approved_by: FINANCE_EMAIL,
            note: 'Finance committee',
          },
        },
      },
      changes: approvalChanges(section),
    })
  ),
}

/** A branching save: the log holds the whole new version, so every leaf is "added". */
export const DETAIL_RULES_CREATE: ApiAidHistoryOperationDetail = {
  year: 2027,
  operation: OP_RULES_CREATE,
  rows: [
    row({
      at: '2027-04-08T22:00:00Z',
      actor: FINANCE_EMAIL,
      entity: 'aid_rules',
      entity_id: '2027:5',
      action: 'save',
      after: {
        year: 2027,
        version: 5,
        parent_year: 2027,
        parent_version: 4,
        document: {},
        section_status: {},
      },
      changes: Array.from({ length: 120 }, (_, index) => ({
        path: ['document', 'awards', `setting_${String(index)}`],
        kind: 'added' as const,
        after: index,
      })),
    }),
  ],
}
