/// <reference path="../pb_data/types.d.ts" />
/**
 * Year-first indexes for the Camperships layer-1 reads (`year = Y` slices of persons and attendees),
 * which today scan all 28,720 persons / 36,878 attendees because neither table has an index that
 * starts with year. Additive only.
 */
const PERSONS_IDX = "CREATE INDEX `idx_persons_year_household_id` ON `persons` (`year`, `household_id`)";
const ATTENDEES_IDX = "CREATE INDEX `idx_attendees_year_status_id` ON `attendees` (`year`, `status_id`)";

migrate((app) => {
  const persons = app.findCollectionByNameOrId("persons");
  persons.indexes.push(PERSONS_IDX);
  app.save(persons);
  const attendees = app.findCollectionByNameOrId("attendees");
  attendees.indexes.push(ATTENDEES_IDX);
  app.save(attendees);
}, (app) => {
  const persons = app.findCollectionByNameOrId("persons");
  persons.indexes = persons.indexes.filter((i) => i !== PERSONS_IDX);
  app.save(persons);
  const attendees = app.findCollectionByNameOrId("attendees");
  attendees.indexes = attendees.indexes.filter((i) => i !== ATTENDEES_IDX);
  app.save(attendees);
});
