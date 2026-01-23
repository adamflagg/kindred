/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_staff")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_staff_person_year` ON `staff` (\n  `year`,\n  `person`\n)",
      "CREATE INDEX `idx_staff_year` ON `staff` (`year`)",
      "CREATE INDEX `idx_staff_status_id` ON `staff` (`status_id`)",
      "CREATE INDEX `idx_u3pImixJrJ` ON `staff` (`person`)"
    ]
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_staff")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_staff_person_year` ON `staff` (`person_id`, `year`)",
      "CREATE INDEX `idx_staff_year` ON `staff` (`year`)",
      "CREATE INDEX `idx_staff_status_id` ON `staff` (`status_id`)"
    ]
  }, collection)

  return app.save(collection)
})
