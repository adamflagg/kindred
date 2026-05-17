import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import type { ImpossibilityReport, ValidationStatistics } from '../../services/solver'
import { friendlyReasonLabel } from '../impossibility/reasonHints'
import { buildFamilyRows, cohortLabel } from './familyRows'
import { BUNK_LEVEL_ISSUE_TYPES, SUPPRESSED_ISSUE_TYPES, extractBunkName } from '../issueClassifier'

interface Props {
  sessionName: string
  year: number
  plannerName: string
  statistics: ValidationStatistics
  impossibilityReport: ImpossibilityReport
  /** Optional branded logo — pass /local/assets/camp-logo.png from caller */
  logoUrl?: string
  issues?: Array<{ type: string; severity: string; message: string }>
}

// Theme: forest green, amber, cream (generic Tawonga-inspired palette)
const GREEN = '#0f5132' // hsl(160 100% 21%) approx
const AMBER = '#f5a623' // hsl(42 92% 62%) approx
const CREAM = '#f5f2e8' // hsl(42 35% 97%) approx
const STONE_600 = '#78716c'
const STONE_300 = '#d6d3d1'
const STONE_200 = '#e7e5e4'
const STONE_100 = '#f5f5f4'
const STONE_950 = '#1c1917'

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', backgroundColor: '#ffffff' },
  brandHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: STONE_950,
    paddingBottom: 10,
    marginBottom: 4,
  },
  brandTitle: { fontSize: 16, fontWeight: 'bold', color: GREEN },
  brandSubtitle: { fontSize: 9, color: STONE_600, marginTop: 2 },
  sessionBlock: { alignItems: 'flex-end' },
  sessionName: { fontSize: 11, fontWeight: 'bold' },
  sessionYear: { fontSize: 9, color: STONE_600 },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    borderBottomWidth: 1,
    borderBottomColor: STONE_200,
    paddingBottom: 2,
    marginTop: 14,
    marginBottom: 6,
    color: STONE_950,
  },
  kpiRow: { flexDirection: 'row', gap: 6 },
  kpi: {
    flex: 1,
    borderWidth: 1,
    borderColor: STONE_300,
    borderRadius: 3,
    padding: 6,
    alignItems: 'center',
    backgroundColor: CREAM,
  },
  kpiValue: { fontSize: 16, fontWeight: 'bold', color: GREEN },
  kpiLabel: { fontSize: 6, color: STONE_600, marginTop: 2, textAlign: 'center' },
  tableHead: {
    flexDirection: 'row',
    color: STONE_600,
    fontSize: 7,
    textTransform: 'uppercase',
    borderBottomWidth: 1,
    borderBottomColor: STONE_200,
    paddingBottom: 2,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: STONE_100,
  },
  tableRowAlt: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: STONE_100,
    backgroundColor: CREAM,
  },
  cell: { flex: 1, fontSize: 8 },
  cellWide: { flex: 2, fontSize: 8 },
  subtitle: { fontSize: 8, color: STONE_600, marginBottom: 6 },
  emptyNote: { fontSize: 8, color: STONE_600, fontStyle: 'italic', marginTop: 4 },
  metaLine: { fontSize: 8, color: STONE_600, marginTop: 6 },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 36,
    right: 36,
    textAlign: 'center',
    fontSize: 7,
    color: STONE_600,
  },
  logo: { width: 40, height: 40, objectFit: 'contain' },
  coverageRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: STONE_200,
    alignItems: 'center',
  },
  coveragePct: { width: 50, textAlign: 'right', fontSize: 9, fontWeight: 'bold' },
  barContainer: {
    flex: 1,
    marginLeft: 8,
    marginRight: 8,
    height: 6,
    backgroundColor: STONE_100,
    borderRadius: 2,
  },
  barFill: { height: 6, backgroundColor: GREEN, borderRadius: 2 },
  amberFill: { height: 6, backgroundColor: AMBER, borderRadius: 2 },
  reasonGroup: { marginBottom: 10 },
  reasonHead: { fontSize: 11, fontWeight: 700, color: STONE_950, marginBottom: 4 },
})

function pct(rate: number | undefined): string {
  if (rate === undefined || rate === null) return '—'
  return `${Math.round(rate * 100)}%`
}

function coverageColor(rate: number): string {
  if (rate >= 0.85) return GREEN
  if (rate >= 0.7) return AMBER
  return '#dc2626' // red
}

export function BunkPlanReport({
  sessionName,
  year,
  plannerName,
  statistics,
  impossibilityReport,
  logoUrl,
  issues,
}: Props) {
  const mpRate = statistics.material_parent_request_satisfaction_rate
  const mpTotal = statistics.material_parent_requests ?? 0
  const mpSatisfied = statistics.satisfied_material_parent_requests ?? 0

  // Unmet parent persons sorted alphabetically for page 3
  const unmetParents = [...(statistics.unsatisfied_material_parent_persons ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name)
  )

  const generatedAt = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <Document>
      {/* ── Page 1 — Cover / Executive Summary (MSP-focused) ── */}
      <Page size="LETTER" style={styles.page}>
        {/* Brand header */}
        <View style={styles.brandHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {logoUrl && <Image src={logoUrl} style={styles.logo} />}
            <View>
              <Text style={styles.brandTitle}>
                Bunk Plan Report — {sessionName} · {year}
              </Text>
              <Text style={styles.brandSubtitle}>
                Generated {generatedAt} by {plannerName}
              </Text>
            </View>
          </View>
        </View>

        {/* KPI tiles — MSP-focused */}
        <Text style={styles.sectionTitle}>Executive Summary</Text>
        <View style={styles.kpiRow}>
          <View style={styles.kpi}>
            <Text style={[styles.kpiValue, { color: coverageColor(mpRate ?? 0) }]}>
              {pct(mpRate)}
            </Text>
            <Text style={styles.kpiLabel}>MSP{'\n'}satisfaction</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiValue}>
              {statistics.assigned_campers}/{statistics.total_campers}
            </Text>
            <Text style={styles.kpiLabel}>Campers{'\n'}assigned</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiValue}>
              {mpSatisfied}/{mpTotal || '—'}
            </Text>
            <Text style={styles.kpiLabel}>MSP reqs{'\n'}met</Text>
          </View>
        </View>

        {/* Coverage — MSP only */}
        <Text style={styles.sectionTitle}>Coverage (MSP)</Text>
        <View style={styles.tableHead}>
          <Text style={{ flex: 2 }}>Category</Text>
          <Text style={{ width: 50, textAlign: 'right' }}>Satisfied</Text>
          <Text style={{ width: 40, textAlign: 'right' }}>Total</Text>
          <Text style={{ width: 50, textAlign: 'right' }}>Rate</Text>
        </View>
        <View style={styles.coverageRow}>
          <Text style={{ flex: 2, fontSize: 8 }}>Material satisfaction parent</Text>
          <Text style={{ width: 50, textAlign: 'right', fontSize: 8 }}>{mpSatisfied}</Text>
          <Text style={{ width: 40, textAlign: 'right', fontSize: 8 }}>{mpTotal}</Text>
          <Text
            style={{
              width: 50,
              textAlign: 'right',
              fontSize: 8,
              color: coverageColor(mpRate ?? 0),
              fontWeight: 'bold',
            }}
          >
            {pct(mpRate)}
          </Text>
        </View>

        {/* Impossible by reason */}
        <Text style={styles.sectionTitle}>Impossible by Reason</Text>
        {Object.keys(impossibilityReport.by_reason ?? {}).length === 0 ? (
          <Text style={styles.emptyNote}>No impossible requests.</Text>
        ) : (
          <>
            <View style={styles.tableHead}>
              <Text style={{ flex: 2 }}>Reason</Text>
              <Text style={{ width: 50, textAlign: 'right' }}>Count</Text>
            </View>
            {Object.entries(impossibilityReport.by_reason ?? {}).map(([code, items], i) => (
              <View
                key={`reason-${code}`}
                style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
              >
                <Text style={{ flex: 2, fontSize: 8 }}>{friendlyReasonLabel(code)}</Text>
                <Text style={{ width: 50, textAlign: 'right', fontSize: 8 }}>
                  {(items as unknown[]).length}
                </Text>
              </View>
            ))}
          </>
        )}

        {/* Capacity by gender */}
        {statistics.capacity_by_gender && (
          <>
            <Text style={styles.sectionTitle}>Capacity by Gender</Text>
            <View style={styles.tableHead}>
              <Text style={{ flex: 2 }}>Gender</Text>
              <Text style={{ width: 60, textAlign: 'right' }}>Assigned</Text>
              <Text style={{ width: 60, textAlign: 'right' }}>Capacity</Text>
            </View>
            {Object.entries(statistics.capacity_by_gender).map(([gender, data], i) => (
              <View
                key={`cap-${gender}`}
                style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
              >
                <Text style={{ flex: 2, fontSize: 8, textTransform: 'capitalize' }}>{gender}</Text>
                <Text style={{ width: 60, textAlign: 'right', fontSize: 8 }}>{data.assigned}</Text>
                <Text style={{ width: 60, textAlign: 'right', fontSize: 8 }}>{data.capacity}</Text>
              </View>
            ))}
          </>
        )}

        <Text style={styles.metaLine}>
          Bunks: {statistics.bunks_at_capacity} at capacity · {statistics.bunks_under_capacity}{' '}
          under · {statistics.bunks_over_capacity} over
        </Text>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
            `Page ${pageNumber} of ${totalPages} · Bunk Plan Report · ${sessionName} ${year}`
          }
          fixed
        />
      </Page>

      {/* ── Page 2 — Families to contact (consolidated) ── */}
      {(() => {
        const familyRows = buildFamilyRows(statistics, impossibilityReport)
        if (familyRows.length === 0) return null
        return (
          <Page size="LETTER" style={styles.page}>
            <Text style={styles.sectionTitle}>Families to contact ({familyRows.length})</Text>
            <Text style={styles.subtitle}>Sorted alphabetically by camper first name. Each row needs a follow-up call.</Text>
            <View style={styles.tableHead}>
              <Text style={styles.cell}>Camper</Text>
              <Text style={styles.cell}>Cohort</Text>
              <Text style={[styles.cell, { flex: 2 }]}>Detail</Text>
            </View>
            {familyRows.map((r) => (
              <View key={r.key} style={styles.tableRow} wrap={false}>
                <Text style={styles.cell}>{r.name}</Text>
                <Text style={styles.cell}>{cohortLabel(r.cohort)}</Text>
                <Text style={[styles.cell, { flex: 2 }]}>{r.detail}</Text>
              </View>
            ))}
            <Text
              style={styles.footer}
              render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
                `Page ${pageNumber} of ${totalPages}`
              }
              fixed
            />
          </Page>
        )
      })()}

      {/* ── Page 3 — Action Lists (legacy) ── */}
      <Page size="LETTER" style={styles.page}>
        {/* Who Got Nothing */}
        <Text style={styles.sectionTitle}>Who Got Nothing</Text>
        {(impossibilityReport.mp_campers_entirely_impossible?.length ?? 0) === 0 ? (
          <Text style={styles.emptyNote}>No campers with entirely impossible requests.</Text>
        ) : (
          <>
            <View style={styles.tableHead}>
              <Text style={styles.cellWide}>Camper</Text>
              <Text style={styles.cell}>Gender</Text>
              <Text style={styles.cell}>Grade</Text>
              <Text style={styles.cellWide}>Reason codes</Text>
            </View>
            {(impossibilityReport.mp_campers_entirely_impossible ?? []).map((c, i) => (
              <View
                key={`imp-${c.cm_id}`}
                style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
              >
                <Text style={styles.cellWide}>{c.name}</Text>
                <Text style={styles.cell}>{c.gender}</Text>
                <Text style={styles.cell}>{c.grade}</Text>
                <Text style={styles.cellWide}>{(c.reason_codes ?? []).join(', ') || '—'}</Text>
              </View>
            ))}
          </>
        )}

        {/* Families to Call */}
        <Text style={styles.sectionTitle}>Families to Call</Text>
        {(statistics.negative_request_violations_detail?.length ?? 0) === 0 ? (
          <Text style={styles.emptyNote}>No not-bunk-with violations.</Text>
        ) : (
          <>
            <View style={styles.tableHead}>
              <Text style={styles.cellWide}>Requester</Text>
              <Text style={styles.cellWide}>Placed with</Text>
              <Text style={styles.cell}>Bunk</Text>
            </View>
            {(statistics.negative_request_violations_detail ?? []).map((v, i) => (
              <View
                key={`nbw-${v.requester_cm_id}-${v.target_cm_id}`}
                style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
              >
                <Text style={styles.cellWide}>{v.requester_name}</Text>
                <Text style={styles.cellWide}>{v.target_name}</Text>
                <Text style={styles.cell}>{v.bunk_name}</Text>
              </View>
            ))}
          </>
        )}

        {/* Priority Unsuccessfuls */}
        <Text style={styles.sectionTitle}>Priority Unsuccessfuls</Text>
        {(statistics.priority_unsuccessfuls?.length ?? 0) === 0 ? (
          <Text style={styles.emptyNote}>No priority-keyword requests went unmet.</Text>
        ) : (
          <>
            <View style={styles.tableHead}>
              <Text style={styles.cellWide}>Requester</Text>
              <Text style={styles.cellWide}>Requested</Text>
              <Text style={styles.cellWide}>Original text</Text>
            </View>
            {(statistics.priority_unsuccessfuls ?? []).map((p, i) => (
              <View
                key={`pu-${p.requester_cm_id}-${p.target_cm_id}`}
                style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
              >
                <Text style={styles.cellWide}>{p.requester_name}</Text>
                <Text style={styles.cellWide}>{p.target_name}</Text>
                <Text style={styles.cellWide}>{p.raw_text}</Text>
              </View>
            ))}
          </>
        )}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
            `Page ${pageNumber} of ${totalPages} · Action Items`
          }
          fixed
        />
      </Page>

      {/* ── Page 3 — Bunks needing attention / Other issues / Unmet drill-down ── */}
      {(() => {
        const issuesList = issues ?? []
        const bunkLevelIssues = issuesList.filter((i) => BUNK_LEVEL_ISSUE_TYPES.has(i.type))
        const otherIssues = issuesList.filter(
          (i) => !BUNK_LEVEL_ISSUE_TYPES.has(i.type) && !SUPPRESSED_ISSUE_TYPES.has(i.type)
        )
        const unmetDetail = statistics.unsatisfied_material_parent_detail ?? []

        if (bunkLevelIssues.length === 0 && otherIssues.length === 0 && unmetDetail.length === 0) {
          return null
        }

        // Group bunk-level issues by extracted bunk name
        const bunkMap = new Map<string, typeof bunkLevelIssues>()
        for (const issue of bunkLevelIssues) {
          const bunk = extractBunkName(issue.message)
          const arr = bunkMap.get(bunk) ?? []
          arr.push(issue)
          bunkMap.set(bunk, arr)
        }
        const issuesByBunk = [...bunkMap.entries()].sort(([a], [b]) => a.localeCompare(b))

        // Group other issues by type
        const otherMap = new Map<string, typeof otherIssues>()
        for (const issue of otherIssues) {
          const arr = otherMap.get(issue.type) ?? []
          arr.push(issue)
          otherMap.set(issue.type, arr)
        }
        const groupedOther = [...otherMap.entries()]

        const sortedUnmet = [...unmetDetail].sort((a, b) =>
          a.requester_name.localeCompare(b.requester_name)
        )

        return (
          <Page size="LETTER" style={styles.page} wrap>
            {issuesByBunk.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>
                  Bunks needing attention ({issuesByBunk.length})
                </Text>
                {issuesByBunk.map(([bunkName, items]) => (
                  <View key={bunkName} style={styles.tableRow} wrap={false}>
                    <Text style={[styles.cell, { fontWeight: 700 }]}>{bunkName}</Text>
                    <Text style={[styles.cell, { flex: 3 }]}>
                      {items.map((it) => it.type.replace(/_/g, ' ')).join(', ')}
                    </Text>
                  </View>
                ))}
              </>
            )}

            {groupedOther.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Other issues</Text>
                {groupedOther.map(([type, items]) => (
                  <View key={type} style={styles.tableRow} wrap={false}>
                    <Text style={styles.cell}>{type.replace(/_/g, ' ')}</Text>
                    <Text style={styles.cell}>{items.length}</Text>
                  </View>
                ))}
              </>
            )}

            {sortedUnmet.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Unmet parent requests</Text>
                {sortedUnmet.map((r) => (
                  <View
                    key={`${r.requester_cm_id}-${r.target_cm_id}`}
                    style={styles.tableRow}
                    wrap={false}
                  >
                    <Text style={styles.cell}>{r.requester_name}</Text>
                    <Text style={styles.cell}>wanted {r.target_name}</Text>
                    <Text style={styles.cell}>
                      {r.requester_bunk_name} vs {r.target_bunk_name}
                    </Text>
                  </View>
                ))}
              </>
            )}

            <Text
              style={styles.footer}
              render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
                `Page ${pageNumber} of ${totalPages}`
              }
              fixed
            />
          </Page>
        )
      })()}

      {/* ── Pages 4–N — Full impossibility detail (one page, wraps) ── */}
      {Object.keys(impossibilityReport.by_reason).length > 0 && (
        <Page size="LETTER" style={styles.page} wrap>
          <Text style={styles.sectionTitle}>Impossibility detail</Text>
          {Object.entries(impossibilityReport.by_reason).map(([code, items]) => {
            const list = items as Array<{
              request_id: string
              reason_code: string
              reason_message: string
              request_type: string
              requester: { cm_id: number; name: string; grade: number; gender: string }
              requestee: { cm_id: number; name: string; grade: number; gender: string } | null
              detail: Record<string, unknown>
              bucket: string | null
            }>
            return (
              <View key={code} style={styles.reasonGroup} wrap>
                <Text style={styles.reasonHead}>{friendlyReasonLabel(code)} ({list.length})</Text>
                <View style={styles.tableHead}>
                  <Text style={styles.cell}>Requester</Text>
                  <Text style={styles.cell}>Target</Text>
                  <Text style={styles.cell}>Source</Text>
                </View>
                {list.map((it, idx) => (
                  <View key={`${code}-${idx}`} style={styles.tableRow} wrap={false}>
                    <Text style={styles.cell}>
                      {it.requester?.name
                        ? `${it.requester.name} (${it.requester.grade}${it.requester.gender ? `, ${it.requester.gender}` : ''})`
                        : '—'}
                    </Text>
                    <Text style={styles.cell}>
                      {it.requestee?.name
                        ? `${it.requestee.name} (${it.requestee.grade}${it.requestee.gender ? `, ${it.requestee.gender}` : ''})`
                        : '—'}
                    </Text>
                    <Text style={styles.cell}>{it.request_type ?? '—'}</Text>
                  </View>
                ))}
              </View>
            )
          })}
          <Text
            style={styles.footer}
            render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
            fixed
          />
        </Page>
      )}

      {/* ── Last page — Full unmet alphabetical list ── */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.sectionTitle}>Unmet Parent Requests (full list)</Text>
        {unmetParents.length === 0 ? (
          <Text style={styles.emptyNote}>All parent requests were satisfied.</Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {unmetParents.map((p) => (
              <View
                key={`unmet-${p.cm_id}`}
                style={{
                  width: '30%',
                  padding: 4,
                  borderWidth: 0.5,
                  borderColor: STONE_200,
                  borderRadius: 2,
                }}
              >
                <Text style={{ fontSize: 8 }}>{p.name}</Text>
              </View>
            ))}
          </View>
        )}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
            `Page ${pageNumber} of ${totalPages} · Full Unmet List`
          }
          fixed
        />
      </Page>
    </Document>
  )
}
