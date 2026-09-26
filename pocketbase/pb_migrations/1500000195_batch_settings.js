/// <reference path="../pb_data/types.d.ts" />
/**
 * Enable PocketBase's batch API (campership sub-project 4a, kindred#2865).
 *
 * POST /api/batch runs its sub-requests in ONE transaction: all commit or none
 * do, with the Go record hooks inside it. The financial-aid write helper
 * (bunking/financial_aid/change_log.py::commit_aid_writes) uses it so that a
 * staff write and its aid_change_log row always commit together. PocketBase
 * ships with batch OFF (and /api/batch answering 403).
 *
 * Enabling it grants no access: every sub-request still passes its
 * collection's API rules, exactly as the same request sent alone would.
 *
 * Limits:
 * - maxRequests 2000: the largest known operation, "make Round 1 offers", is
 *   about 500 decisions, each a write plus its log row (about 1000
 *   sub-requests). 2000 keeps it in ONE atomic batch with room to grow.
 *   Measured on v0.40.4: 600 creates committed in about 0.11 s.
 * - timeout 30 s: a batch holds SQLite's write lock while it runs, so this is a
 *   ceiling on how long a runaway batch can block the sync, not a typical
 *   duration (PocketBase's default of 3 s is too tight for 2000 writes with hooks).
 * - maxBodySize 32 MiB: 2000 sub-requests with small JSON snapshots are a few
 *   MB; the cap stops a malformed caller long before PocketBase's ~128 MB default.
 *
 * bunking/pocketbase_batch.py pins MAX_BATCH_REQUESTS and
 * BATCH_TIMEOUT_SECONDS to this file, and rbac/batch_booted_test.go asserts the
 * booted settings. Change all three together.
 *
 * Nothing else writes batch settings: kindred-init (docker/init-entrypoint.sh)
 * only upserts the superuser and patches the users collection's OAuth2 config.
 * Down restores PocketBase's own defaults (core/settings_model.go).
 */

migrate((app) => {
  const settings = app.settings();
  settings.batch.enabled = true;
  settings.batch.maxRequests = 2000;
  settings.batch.timeout = 30;
  settings.batch.maxBodySize = 32 * 1024 * 1024;
  app.save(settings);
}, (app) => {
  const settings = app.settings();
  settings.batch.enabled = false;
  settings.batch.maxRequests = 50;
  settings.batch.timeout = 3;
  settings.batch.maxBodySize = 0;
  app.save(settings);
});
