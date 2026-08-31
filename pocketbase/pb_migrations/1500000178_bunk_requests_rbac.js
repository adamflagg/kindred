/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Gate bunk_requests reads behind bunking.manage
 * Fixes: kindred#2623 — bunk_requests was readable by ANY authenticated
 * user, and unlike its "processed requests are sanitised" siblings, it
 * carries the full unedited request narrative in `original_text`. Measured
 * read-only against the prod snapshot (counts only, no content read):
 * 3,200 rows, 100% carrying non-empty original_text, 351 over 100
 * characters, longest 1,139.
 *
 * Every sibling read-gates already: original_bunk_requests
 * (1500000020_original_bunk_requests.js:25-26), bunk_request_sources
 * (1500000026_bunk_request_sources.js:30-31), debug_parse_results
 * (denyAll, 1500000027_debug_parse_results.js:27-28). bunk_requests was the
 * one left on a bare "authenticated, any role" check since its creation
 * (1500000018_bunk_requests.js) and nothing later tightened it —
 * 1500000074_rbac_tier1_rules.js's four Tier-1 lists do not name it.
 *
 * ⚖️ OWNER RULING 2026-08-31: gate on bunking.manage, the same rule this
 * collection's write rules already carry, and the same rule
 * original_bunk_requests uses for read. NOT bunking.view — that permission
 * was removed system-wide by 1500000077_rbac_simplify_rules.js, is absent
 * from both Permission enums (bunking/rbac/permissions.py,
 * frontend/src/constants/permissions.ts), and is held by no role
 * (bunking-staff, the only bunking role, holds
 * ["bunking.manage", "sheets.export"]). Gating on bunking.view would have
 * made this table admin-only in practice and broken the board for the
 * role this data is for.
 *
 * ⚠️ Known and accepted consequence of that ruling: none of the eleven
 * current readers (CamperTooltip, CamperRequestSummary, CamperDetailsPanel,
 * RequestReviewPanel, AllCamperRequestsModal, CreateRequestModal,
 * SessionList, hooks/session/useSessionData.ts,
 * hooks/camper/useAllBunkRequests.ts, hooks/useCohortRequestRelations.ts,
 * providers/BunkRequestProvider.tsx) carries any permission check today —
 * the routes that host them sit behind a bare <ProtectedRoute> with no
 * Permission requirement. Registrar, Finance, and any zero-role user
 * therefore lose the pending-request badge, camper tooltips, and request
 * panels on the board after this change.
 *
 * Degradation, verified per read path (2026-08-31): every consumer goes
 * EMPTY, none shows a visible error. Two swallow the 403 outright —
 * useBunkRequestsCount's getRequestsCount try/catch returns 0 (the badge
 * reads 0), and BunkRequestProvider's queryFn try/catch returns []. The
 * other four let it reject into React Query but destructure `data = []` /
 * `= EMPTY` and never read isError, so they render as "no requests":
 * CamperDetailsPanel:412, RequestReviewPanel:292, useAllBunkRequests:41,
 * useCohortRequestRelations:61. Those four are also SLOW to settle —
 * utils/queryClient.ts's retry predicate excludes only 401, so a 403 is
 * retried three times (1s/2s/4s backoff) first. Tightening that predicate
 * is deliberately NOT done here: queryClient.ts is a shared default for
 * every query in the app and is out of this migration's scope.
 *
 * This is a deliberate, reviewed product change (not a bug to paper over)
 * — no frontend reader is touched by this migration.
 */

const BUNK_REQUESTS_RBAC_RULE =
  '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"';

migrate((app) => {
  const collection = app.findCollectionByNameOrId("bunk_requests");

  collection.listRule = BUNK_REQUESTS_RBAC_RULE;
  collection.viewRule = BUNK_REQUESTS_RBAC_RULE;

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("bunk_requests");

  collection.listRule = '@request.auth.id != ""';
  collection.viewRule = '@request.auth.id != ""';

  app.save(collection);
});
