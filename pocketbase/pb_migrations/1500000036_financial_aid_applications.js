/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create financial_aid_applications collection
 * Dependencies: persons, households
 *
 * Stores extracted and structured financial aid application data from
 * person_custom_values (FA- and CA- prefixed fields). One row per camper per year.
 * Used for FA reporting, analytics, and award tracking.
 *
 * Computed by Go: pocketbase/sync/financial_aid_applications.go
 * Exported to Google Sheets: {year}-financial-aid-applications
 *
 * Source data: 70 CampMinder custom fields (69 Camper partition + 1 Adult partition)
 * - Interest indicators: CA-FinancialAssistanceInterest, CA-Donation*, CA-FinancialAssistanceAmount
 * - Application fields: FA-* prefix (contact info, income, assets, expenses, programs, etc.)
 * - Amount requested fields: Summer/Quest, Family Camp, B'nai Mitzvah
 */

const COLLECTION_ID_FA_APPLICATIONS = "col_fa_applications";

migrate((app) => {
  const personsCol = app.findCollectionByNameOrId("persons");
  const householdsCol = app.findCollectionByNameOrId("households");

  const collection = new Collection({
    id: COLLECTION_ID_FA_APPLICATIONS,
    type: "base",
    name: "financial_aid_applications",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      // === Identity (4 fields) ===
      {
        type: "relation",
        name: "person",
        required: true,
        presentable: true,
        collectionId: personsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "relation",
        name: "household",
        required: false,
        presentable: false,
        collectionId: householdsCol.id,
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
        max: null,
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

      // === Interest Indicators (4 fields from CA- prefix) ===
      {
        type: "bool",
        name: "interest_expressed",
        required: false,
        presentable: false
      },
      {
        type: "text",
        name: "donation_preference",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "donation_other",
        required: false,
        presentable: false,
        min: 0,
        max: 1000,
        pattern: ""
      },
      {
        type: "number",
        name: "amount_awarded",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },

      // === Contact Parent 1 (11 fields) ===
      {
        type: "text",
        name: "contact_first_name",
        required: false,
        presentable: true,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "contact_last_name",
        required: false,
        presentable: true,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "contact_email",
        required: false,
        presentable: false,
        min: 0,
        max: 300,
        pattern: ""
      },
      {
        type: "text",
        name: "contact_phone",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },
      {
        type: "text",
        name: "contact_address",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "contact_city",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "text",
        name: "contact_state",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "text",
        name: "contact_zip",
        required: false,
        presentable: false,
        min: 0,
        max: 20,
        pattern: ""
      },
      {
        type: "text",
        name: "contact_country",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "text",
        name: "contact_marital_status",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "text",
        name: "contact_jewish",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },

      // === Parent 2 (3 fields) ===
      {
        type: "text",
        name: "parent_2_name",
        required: false,
        presentable: false,
        min: 0,
        max: 300,
        pattern: ""
      },
      {
        type: "text",
        name: "parent_2_marital_status",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "text",
        name: "parent_2_jewish",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },

      // === Financial Data - Income (6 fields) ===
      {
        type: "number",
        name: "total_gross_income",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "number",
        name: "expected_gross_income",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "number",
        name: "total_adjusted_income",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "number",
        name: "total_exemptions",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        type: "bool",
        name: "unemployment",
        required: false,
        presentable: false
      },
      {
        type: "bool",
        name: "still_unemployed",
        required: false,
        presentable: false
      },

      // === Financial Data - Assets/Savings (4 fields) ===
      {
        type: "number",
        name: "non_retirement_savings",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "number",
        name: "retirement_accounts",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "number",
        name: "student_debt",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "bool",
        name: "owns_home",
        required: false,
        presentable: false
      },

      // === Financial Data - Expenses (4 fields) ===
      {
        type: "number",
        name: "total_medical_expenses",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "number",
        name: "total_edu_expenses",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "number",
        name: "total_housing_expenses",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "number",
        name: "total_rent",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },

      // === Family Info (4 fields) ===
      {
        type: "number",
        name: "num_children",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        onlyInt: true
      },
      {
        type: "bool",
        name: "single_parent",
        required: false,
        presentable: false
      },
      {
        type: "text",
        name: "camper_name",
        required: false,
        presentable: false,
        min: 0,
        max: 300,
        pattern: ""
      },
      {
        type: "text",
        name: "special_circumstances",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
      },

      // === Jewish Affiliations (4 fields) ===
      {
        type: "bool",
        name: "affiliated_jcc",
        required: false,
        presentable: false
      },
      {
        type: "text",
        name: "child_affiliated_synagogue",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "children_jewish_day_school",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "bool",
        name: "russian_speaking",
        required: false,
        presentable: false
      },

      // === Government/External Aid (8 fields) ===
      {
        type: "bool",
        name: "gov_subsidies",
        required: false,
        presentable: false
      },
      {
        type: "text",
        name: "gov_subsidies_detail",
        required: false,
        presentable: false,
        min: 0,
        max: 1000,
        pattern: ""
      },
      {
        type: "text",
        name: "synagogue_grant",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "one_happy_camper",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "other_financial_support",
        required: false,
        presentable: false,
        min: 0,
        max: 1000,
        pattern: ""
      },
      {
        type: "number",
        name: "other_support_amount",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "text",
        name: "other_support_expectations",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "financial_support",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },

      // === Program Requests (9 fields) ===
      {
        type: "text",
        name: "summer_program",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "number",
        name: "summer_amount_requested",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "text",
        name: "fc_program",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "number",
        name: "fc_amount_requested",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "text",
        name: "tbm_program",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "number",
        name: "tbm_amount_requested",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "number",
        name: "num_programs",
        required: false,
        presentable: false,
        min: 0,
        max: 20,
        onlyInt: true
      },
      {
        type: "number",
        name: "num_sessions",
        required: false,
        presentable: false,
        min: 0,
        max: 20,
        onlyInt: true
      },
      {
        type: "number",
        name: "amount_requested",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },

      // === COVID/Disaster Relief (8 fields - historical, may deprecate) ===
      {
        type: "bool",
        name: "covid_childcare",
        required: false,
        presentable: false
      },
      {
        type: "number",
        name: "covid_childcare_amount",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "text",
        name: "covid_expenses",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "covid_expenses_additional",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "number",
        name: "covid_expenses_amount",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "text",
        name: "fire",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "bool",
        name: "fire_affected",
        required: false,
        presentable: false
      },
      {
        type: "text",
        name: "fire_detail",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
      },

      // === Admin/Status (5 fields) ===
      {
        type: "number",
        name: "deposit_paid",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "number",
        name: "deposit_paid_adult",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        type: "text",
        name: "applicant_signature",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "bool",
        name: "income_confirmed",
        required: false,
        presentable: false
      },
      {
        type: "bool",
        name: "amount_confirmed",
        required: false,
        presentable: false
      },

      // === Metadata (2 fields) ===
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
      "CREATE UNIQUE INDEX `idx_fa_apps_unique` ON `financial_aid_applications` (`person`, `year`)",
      "CREATE INDEX `idx_fa_apps_year` ON `financial_aid_applications` (`year`)",
      "CREATE INDEX `idx_fa_apps_household` ON `financial_aid_applications` (`household`, `year`)",
      "CREATE INDEX `idx_fa_apps_person_id` ON `financial_aid_applications` (`person_id`, `year`)",
      "CREATE INDEX `idx_fa_apps_awarded` ON `financial_aid_applications` (`year`, `amount_awarded`) WHERE `amount_awarded` > 0",
      "CREATE INDEX `idx_fa_apps_interest` ON `financial_aid_applications` (`year`, `interest_expressed`) WHERE `interest_expressed` = 1"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("financial_aid_applications");
  app.delete(collection);
});
