/**
 * Panel showing bunking status, assignments, and request satisfaction
 */
import { Link } from 'react-router';
import { Heart, Home, Clock, CheckCircle, Sparkles } from 'lucide-react';
import CamperLink from '../CamperLink';
import { sessionNameToUrl } from '../../utils/sessionUtils';
import type { Camper } from '../../types/app-types';
import type { EnhancedBunkRequest } from '../../hooks/camper/useAllBunkRequests';
import type { SatisfactionMap } from '../../hooks/camper/types';

interface BunkingStatusPanelProps {
  camper: Camper;
  sessionShortName: string;
  allBunkRequests: EnhancedBunkRequest[];
  agePreferenceRequests: EnhancedBunkRequest[];
  satisfactionData: SatisfactionMap;
  satisfactionLoading: boolean;
}

export function BunkingStatusPanel({
  camper,
  sessionShortName,
  allBunkRequests,
  agePreferenceRequests,
  satisfactionData,
  satisfactionLoading,
}: BunkingStatusPanelProps) {
  // Calculate satisfaction summary
  const countableRequests = allBunkRequests.filter(
    (r) =>
      r.status !== 'pending' &&
      ((r.request_type === 'bunk_with' || r.request_type === 'not_bunk_with')
        ? r.requestee_id && r.requestee_id > 0
        : r.request_type === 'age_preference'
          ? !!r.age_preference_target
          : false)
  );
  const totalCount = countableRequests.length;
  const satisfiedCount = countableRequests.filter(
    (r) => satisfactionData[r.id]?.status === 'satisfied'
  ).length;
  const hasSatisfactionData =
    !satisfactionLoading && Object.keys(satisfactionData).length > 0;

  // Filter person-based requests (not age preference)
  const personRequests = allBunkRequests.filter(
    (r) => r.request_type !== 'age_preference'
  );

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
      {/* Header with integrated session/bunk status */}
      <div className="px-6 py-4 bg-amber-50/50 dark:bg-amber-950/40 border-b border-amber-100 dark:border-amber-900/50">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Heart className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-display font-bold text-foreground">
                Bunking Status
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {sessionShortName}
              </p>
            </div>
          </div>

          {/* Current Assignment Badge */}
          <div className="flex-shrink-0">
            {camper.expand?.assigned_bunk ? (
              <Link
                to={`/summer/session/${sessionNameToUrl(camper.expand?.session?.name || '')}/board`}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-forest-50 dark:bg-forest-900/30 border border-forest-200 dark:border-forest-800 hover:bg-forest-100 dark:hover:bg-forest-900/50 transition-colors"
              >
                <Home className="w-4 h-4 text-forest-600 dark:text-forest-400" />
                <span className="font-semibold text-forest-700 dark:text-forest-300 hover:text-forest-800 dark:hover:text-forest-200">
                  {camper.expand.assigned_bunk.name}
                </span>
              </Link>
            ) : (
              <span className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <Clock className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  Awaiting Assignment
                </span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* Request Satisfaction Summary */}
        {totalCount > 0 && hasSatisfactionData && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/40 text-sm">
            <span className="text-muted-foreground">Request satisfaction:</span>
            <span
              className={`font-semibold ${
                satisfiedCount === totalCount
                  ? 'text-green-600 dark:text-green-400'
                  : satisfiedCount > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-red-600 dark:text-red-400'
              }`}
            >
              {satisfiedCount}/{totalCount} met
            </span>
            {satisfiedCount === totalCount && totalCount > 0 && (
              <CheckCircle className="w-4 h-4 text-green-500" />
            )}
          </div>
        )}

        {/* Bunk Requests - Compact list */}
        {personRequests.length > 0 ? (
          <div className="space-y-1.5">
            {personRequests.map((request, idx) => {
              const isBunkWith = request.request_type === 'bunk_with';
              const isConfirmed =
                request.status === 'resolved' &&
                request.requestee_id &&
                request.requestee_id > 0;

              // Determine display name
              const displayName =
                request.requestedPersonName ||
                (request as unknown as { requested_person_name?: string })
                  .requested_person_name ||
                (request.requestee_id && request.requestee_id < 0
                  ? `Person ${request.requestee_id}`
                  : 'Unknown');

              // Get satisfaction status
              const satisfaction = satisfactionData[request.id];
              const showSatisfaction =
                request.status === 'resolved' &&
                request.requestee_id &&
                request.requestee_id > 0;

              return (
                <div
                  key={request.id || idx}
                  className="flex items-center gap-2 text-sm py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50"
                >
                  {/* Status indicator */}
                  <div
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      request.status === 'resolved'
                        ? 'bg-green-500'
                        : request.status === 'declined'
                          ? 'bg-red-500'
                          : 'bg-amber-500'
                    }`}
                  />

                  {/* Request type */}
                  <span
                    className={`font-medium ${isBunkWith ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}
                  >
                    {isBunkWith ? 'Bunk with' : 'Not with'}
                  </span>

                  <span className="text-muted-foreground/60">→</span>

                  {/* Target camper link */}
                  <CamperLink
                    personCmId={request.requestee_id}
                    displayName={displayName}
                    isConfirmed={!!isConfirmed}
                  />

                  {/* Mutual badge */}
                  {request.is_reciprocal && (
                    <span className="px-1.5 py-0.5 text-xs font-medium bg-forest-100 dark:bg-forest-900/30 text-forest-700 dark:text-forest-400 rounded">
                      mutual
                    </span>
                  )}

                  {/* Satisfaction status */}
                  {showSatisfaction && (
                    <span className="ml-auto flex items-center">
                      {satisfactionLoading ? (
                        <span className="inline-block w-3 h-3 border border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
                      ) : satisfaction?.status === 'satisfied' ? (
                        <span
                          className="px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium"
                          title={satisfaction.detail}
                        >
                          Met
                        </span>
                      ) : satisfaction?.status === 'not_satisfied' ? (
                        <span
                          className="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs font-medium"
                          title={satisfaction.detail}
                        >
                          Unmet
                        </span>
                      ) : null}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-4 text-center">
            <p className="text-sm text-muted-foreground">
              No bunk requests on file
            </p>
          </div>
        )}

        {/* Age Preference */}
        {agePreferenceRequests.length > 0 &&
          agePreferenceRequests[0]?.age_preference_target && (
            <AgePreferenceNote
              request={agePreferenceRequests[0]}
              satisfaction={satisfactionData[agePreferenceRequests[0].id]}
              satisfactionLoading={satisfactionLoading}
            />
          )}
      </div>
    </div>
  );
}

function AgePreferenceNote({
  request,
  satisfaction,
  satisfactionLoading,
}: {
  request: EnhancedBunkRequest;
  satisfaction: { status: string; detail?: string } | undefined;
  satisfactionLoading: boolean;
}) {
  const prefersOlder = request.age_preference_target === 'older';

  return (
    <div className="flex items-center gap-2 pt-3 border-t border-border text-sm px-3">
      <Sparkles className="w-4 h-4 flex-shrink-0 text-amber-500" />
      <span className="text-muted-foreground">
        Prefers bunking with{' '}
        <span className="font-medium text-foreground">
          {prefersOlder ? 'older' : 'younger'}
        </span>{' '}
        campers
      </span>

      {/* Satisfaction status */}
      <span className="ml-auto" title={satisfaction?.detail}>
        {satisfactionLoading ? (
          <span className="inline-block w-3 h-3 border border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
        ) : satisfaction?.status === 'satisfied' ? (
          <span className="px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium">
            Met
          </span>
        ) : satisfaction?.status === 'not_satisfied' ? (
          <span className="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs font-medium">
            Unmet
          </span>
        ) : null}
      </span>
    </div>
  );
}

export default BunkingStatusPanel;
