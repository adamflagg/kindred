/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: rename session_type enum value `training` → `scit`
 *
 * Affects two collections sharing the enum (camp_sessions, camper_history).
 * Camp parlance uses SCIT (Specialist + Counselor In-Training) for the
 * combined CIT/SIT bucket; the legacy "training" label was an internal name.
 *
 * Step 1: backfill existing rows from "training" to "scit" via raw SQL
 * (bypasses select-field validation so the update can land before the
 * schema's allowed-values list is tightened).
 * Step 2: upsert the select field on both collections with the new
 * values array.
 */

migrate(
  (app) => {
    // Backfill data first — raw SQL skips API-layer validation
    app
      .db()
      .newQuery(
        `UPDATE camp_sessions SET session_type = 'scit' WHERE session_type = 'training'`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `UPDATE camper_history SET session_type = 'scit' WHERE session_type = 'training'`,
      )
      .execute();

    const newValues = [
      "main",
      "embedded",
      "ag",
      "family",
      "quest",
      "scit",
      "bmitzvah",
      "tli",
      "adult",
      "school",
      "hebrew",
      "teen",
      "other",
    ];

    const campSessions = app.findCollectionByNameOrId("camp_sessions");
    campSessions.fields.add(
      new Field({
        type: "select",
        name: "session_type",
        required: true,
        presentable: false,
        values: newValues,
        maxSelect: 1,
      }),
    );
    app.save(campSessions);

    const camperHistory = app.findCollectionByNameOrId("camper_history");
    camperHistory.fields.add(
      new Field({
        type: "select",
        name: "session_type",
        required: true,
        presentable: false,
        values: newValues,
        maxSelect: 1,
      }),
    );
    app.save(camperHistory);
  },
  (app) => {
    // Backfill data first — mirrors the up path so a mid-rollback failure
    // can't strand 'scit' rows under a schema that no longer accepts them.
    app
      .db()
      .newQuery(
        `UPDATE camp_sessions SET session_type = 'training' WHERE session_type = 'scit'`,
      )
      .execute();
    app
      .db()
      .newQuery(
        `UPDATE camper_history SET session_type = 'training' WHERE session_type = 'scit'`,
      )
      .execute();

    const oldValues = [
      "main",
      "embedded",
      "ag",
      "family",
      "quest",
      "training",
      "bmitzvah",
      "tli",
      "adult",
      "school",
      "hebrew",
      "teen",
      "other",
    ];

    const campSessions = app.findCollectionByNameOrId("camp_sessions");
    campSessions.fields.add(
      new Field({
        type: "select",
        name: "session_type",
        required: true,
        presentable: false,
        values: oldValues,
        maxSelect: 1,
      }),
    );
    app.save(campSessions);

    const camperHistory = app.findCollectionByNameOrId("camper_history");
    camperHistory.fields.add(
      new Field({
        type: "select",
        name: "session_type",
        required: true,
        presentable: false,
        values: oldValues,
        maxSelect: 1,
      }),
    );
    app.save(camperHistory);
  },
);
