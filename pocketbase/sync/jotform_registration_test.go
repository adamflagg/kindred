package sync

import (
	"slices"
	"testing"
)

func TestJotformJobIsManualOnlyUntilTheEnterpriseMove(t *testing.T) {
	t.Parallel()
	var meta *JobMeta
	for i := range syncJobMeta {
		if syncJobMeta[i].ID == serviceNameJotformSubmissions {
			meta = &syncJobMeta[i]
		}
	}
	if meta == nil {
		t.Fatal("jotform_submissions has no syncJobMeta row")
	}
	if meta.Cadences != 0 {
		t.Error("P1: no cron may run the Jotform pull before the enterprise-account move (P2 adds CadenceDaily)")
	}
	if meta.Triggers != TriggerIndividualRoute || !meta.CurrentYearOnly {
		t.Errorf("want TriggerIndividualRoute only and CurrentYearOnly, got %+v", *meta)
	}
	if slices.Contains(GetDefaultUnifiedSyncJobs(true, true), serviceNameJotformSubmissions) {
		t.Error("the Jotform pull must not join a full run")
	}
}

func TestJotformTablesAreNeverExported(t *testing.T) {
	t.Parallel()
	written, ok := SyncJobToCollections[serviceNameJotformSubmissions]
	if !ok {
		t.Fatal("jotform_submissions missing from SyncJobToCollections")
	}
	exports := append(GetReadableYearExports(), GetReadableGlobalExports()...)
	for _, cfg := range exports {
		if slices.Contains(written, cfg.Collection) {
			t.Errorf("%s holds every Jotform answer (medical included) and must never reach a sheet", cfg.Collection)
		}
	}
}
