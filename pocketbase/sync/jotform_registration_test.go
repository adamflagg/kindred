package sync

import (
	"slices"
	"testing"
)

func TestJotformJobRunsDailyWhenAKeyIsConfigured(t *testing.T) {
	t.Setenv("IS_DOCKER", "true")
	t.Setenv("JOTFORM_API_KEY", "test-key")
	if !slices.Contains(getDailySyncJobs(), serviceNameJotformSubmissions) {
		t.Error("P2: the Jotform pull runs on the daily cron once the enterprise account is live")
	}
	t.Setenv("JOTFORM_API_KEY", "")
	if slices.Contains(getDailySyncJobs(), serviceNameJotformSubmissions) {
		t.Error("with no key the daily cron must skip the job rather than fail it every night")
	}
	if slices.Contains(GetDefaultUnifiedSyncJobs(true, true), serviceNameJotformSubmissions) {
		t.Error("still never part of a full run")
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
