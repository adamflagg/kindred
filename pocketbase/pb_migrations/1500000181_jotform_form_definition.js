/// <reference path="../pb_data/types.d.ts" />
/**
 * jotform_forms: the form's definition and how its mapping was resolved
 * (kindred#2828, one-step Jotform setup).
 *
 * The pull now reads each form's title and questions from Jotform itself, so
 * a form can be mapped before anyone submits, and resolves the field map per
 * role: staff-set, carried from an earlier year by identical wording, or
 * guessed from the wording.
 *
 *   questions       [{question_id, text, type, order}], the form's answerable
 *                   questions at the last pull. The admin's pickers read it.
 *   form_title      the title in Jotform, shown under the link so a wrong
 *                   year's form is noticed.
 *   field_map_meta  {role: {question_id, text, source, flag}}. source is
 *                   staff | carried | guessed; flag is wording_changed |
 *                   missing | needs_pick. For a staff role, text is the wording
 *                   when staff saved it, which is how a rewording is noticed.
 *
 * Additive only: existing rows keep their field_map, which the pull treats
 * as staff-set (only staff wrote it before this migration).
 *
 * Field properties are direct (never inside an options wrapper, which v0.23
 * ignores silently).
 */

migrate((app) => {
  const forms = app.findCollectionByNameOrId("jotform_forms");
  forms.fields.add(new Field({ type: "json", name: "questions", required: false, presentable: false, maxSize: 500000 }));
  forms.fields.add(new Field({ type: "text", name: "form_title", required: false, presentable: false, min: 0, max: 500, pattern: "" }));
  forms.fields.add(new Field({ type: "json", name: "field_map_meta", required: false, presentable: false, maxSize: 50000 }));
  app.save(forms);
}, (app) => {
  const forms = app.findCollectionByNameOrId("jotform_forms");
  forms.fields.removeByName("questions");
  forms.fields.removeByName("form_title");
  forms.fields.removeByName("field_map_meta");
  app.save(forms);
});
