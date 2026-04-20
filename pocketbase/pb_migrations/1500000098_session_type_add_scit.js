/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add "scit" to session_type select values
 *
 * Phase 1 of the teen-programs-metrics plan introduces a new "scit" session type
 * (Counselor In-Training + Specialist In-Training). The Go sync classifier now
 * emits "scit" for these programs, so both the camp_sessions.session_type and
 * camper_history.session_type select enums need to accept the new value.
 *
 * Re-adds the select field with the extended values list (fields.add() on an
 * existing field name updates it in place per PB v0.23+). No existing values
 * are removed or reordered.
 */

migrate(
  (app) => {
    // camp_sessions.session_type
    const campSessions = app.findCollectionByNameOrId("camp_sessions")
    campSessions.fields.add(new Field({
      type: "select",
      name: "session_type",
      required: true,
      presentable: false,
      values: ["main", "embedded", "ag", "family", "quest", "training", "bmitzvah", "tli", "adult", "school", "hebrew", "teen", "other", "scit"],
      maxSelect: 1
    }))
    app.save(campSessions)

    // camper_history.session_type
    const camperHistory = app.findCollectionByNameOrId("camper_history")
    camperHistory.fields.add(new Field({
      type: "select",
      name: "session_type",
      required: false,
      presentable: false,
      values: ["main", "embedded", "ag", "family", "quest", "training", "bmitzvah", "tli", "adult", "school", "hebrew", "teen", "other", "scit"],
      maxSelect: 1
    }))
    app.save(camperHistory)
  },
  (app) => {
    // Revert: drop "scit" from both enums
    const campSessions = app.findCollectionByNameOrId("camp_sessions")
    campSessions.fields.add(new Field({
      type: "select",
      name: "session_type",
      required: true,
      presentable: false,
      values: ["main", "embedded", "ag", "family", "quest", "training", "bmitzvah", "tli", "adult", "school", "hebrew", "teen", "other"],
      maxSelect: 1
    }))
    app.save(campSessions)

    const camperHistory = app.findCollectionByNameOrId("camper_history")
    camperHistory.fields.add(new Field({
      type: "select",
      name: "session_type",
      required: false,
      presentable: false,
      values: ["main", "embedded", "ag", "family", "quest", "training", "bmitzvah", "tli", "adult", "school", "hebrew", "teen", "other"],
      maxSelect: 1
    }))
    app.save(camperHistory)
  }
)
