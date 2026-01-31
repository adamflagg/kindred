/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create quest_registrations table
 * Dependencies: attendees, person_custom_values
 *
 * Extracts Quest-* and Q-* custom fields for Quest program participants.
 * Contains 45+ fields covering signatures, questionnaires, social/emotional,
 * medical/physical, development, and Quest bus info.
 *
 * Unique key: (person_id, year) - one record per Quest participant per year
 * Computed by Go: pocketbase/sync/quest_registrations.go
 */

migrate((app) => {
  const attendeesCol = app.findCollectionByNameOrId("attendees");

  const collection = new Collection({
    type: "base",
    name: "quest_registrations",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      // === Core Identity ===
      {
        type: "relation",
        name: "attendee",
        required: true,
        presentable: false,
        collectionId: attendeesCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "number",
        name: "person_id",
        required: true,
        presentable: false,
        min: 1,
        max: 999999999,
        onlyInt: true
      },
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: 2010,
        max: 2100,
        onlyInt: true
      },

      // === Signatures ===
      {
        type: "text",
        name: "parent_signature",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "quester_signature",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "preferred_name",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },

      // === Questionnaire ===
      {
        type: "text",
        name: "why_come",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "most_looking_forward",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "least_looking_forward",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "biggest_accomplishment",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "biggest_disappointment",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "whose_decision",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "if_returning",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "biggest_hope",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "biggest_concern",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },

      // === Social/Emotional ===
      {
        type: "text",
        name: "make_friends_ease",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "make_friends_explain",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "separation_reaction",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "separation_explain",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "away_before",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "away_explain",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "express_frustration",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "what_makes_angry",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "cooperates_with_limits",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "techniques_limits",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },

      // === Medical/Physical ===
      {
        type: "text",
        name: "any_medications",
        required: false,
        presentable: false,
        min: 0,
        max: 1000,
        pattern: ""
      },
      {
        type: "text",
        name: "physical_limitations",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "physical_limit_explain",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "fears_anxieties",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "situations_transitions",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "bad_camp_experiences",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },

      // === Development/Maturity ===
      {
        type: "text",
        name: "child_matured",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "change_since_last_year",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "extracurricular",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "cook_chores",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "cook_chores_explain",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "decision_attend",
        required: false,
        presentable: false,
        min: 0,
        max: 1000,
        pattern: ""
      },
      {
        type: "text",
        name: "how_can_help",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "how_much_child",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "has_quester_before",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "special_needs",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "concerns_for_child",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "anything_else",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
      },

      // === Bar/Bat Mitzvah ===
      {
        type: "bool",
        name: "bar_mitzvah_year",
        required: false,
        presentable: false
      },
      {
        type: "text",
        name: "bar_mitzvah_where",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "bar_mitzvah_month",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },

      // === Other ===
      {
        type: "text",
        name: "backpack_info",
        required: false,
        presentable: false,
        min: 0,
        max: 1000,
        pattern: ""
      },

      // === Quest Bus ===
      {
        type: "text",
        name: "bus_pickup_name",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "bus_pickup_phone",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },
      {
        type: "text",
        name: "bus_pickup_relationship",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "text",
        name: "bus_alt_pickup",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "bus_alt_phone",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },

      // === Timestamps ===
      {
        type: "autodate",
        name: "created",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: false
      },
      {
        type: "autodate",
        name: "updated",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: true
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_quest_registrations_unique` ON `quest_registrations` (`person_id`, `year`)",
      "CREATE INDEX `idx_quest_registrations_attendee` ON `quest_registrations` (`attendee`)",
      "CREATE INDEX `idx_quest_registrations_year` ON `quest_registrations` (`year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("quest_registrations");
  app.delete(collection);
});
