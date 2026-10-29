/// <reference path="../pb_data/types.d.ts" />
/**
 * financial_aid_applications: the registration aid ask, one column pair per program (IN-BUCKETS, owner 2026-10-28).
 *
 * CampMinder asks for financial assistance on two registration forms: the camper one (CA-FinancialAssistanceInterest
 * and CA-FinancialAssistanceAmount) and the adult-weekend one (WW-FA and WW-FA Amount). Both were written into the
 * same two columns, interest_expressed and registration_request_amount, and the first value won, so a person with
 * both kept only one. The owner's ruling makes them separate buckets, each judged on its own facts, so each keeps
 * its own pair here:
 *   - camper_interest_expressed / camper_registration_request_amount: the CA- answers only;
 *   - adult_weekend_interest_expressed / adult_weekend_registration_request_amount: the WW- answers only.
 *
 * ADD ONLY. The legacy pair keeps being written exactly as before: 2026, the tie-off season, reads it, and so does
 * everything outside aid intake. The FA applications sync (sync/financial_aid_applications.go) fills the new columns
 * on its next run (its change check compares them, so every row with an ask is rewritten once); until then they read
 * false and 0, which only the 2027-on readers see.
 *
 * Number limits are null (unbounded), as registration_request_amount's: `max: 0` on a number field would reject
 * every positive ask.
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("financial_aid_applications");
  collection.fields.add(new Field({ type: "bool", name: "camper_interest_expressed", required: false, presentable: false }));
  collection.fields.add(new Field({ type: "number", name: "camper_registration_request_amount", required: false, presentable: false, min: null, max: null, onlyInt: false }));
  collection.fields.add(new Field({ type: "bool", name: "adult_weekend_interest_expressed", required: false, presentable: false }));
  collection.fields.add(new Field({ type: "number", name: "adult_weekend_registration_request_amount", required: false, presentable: false, min: null, max: null, onlyInt: false }));
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("financial_aid_applications");
  collection.fields.removeByName("camper_interest_expressed");
  collection.fields.removeByName("camper_registration_request_amount");
  collection.fields.removeByName("adult_weekend_interest_expressed");
  collection.fields.removeByName("adult_weekend_registration_request_amount");
  app.save(collection);
});
