/// <reference path="../pb_data/types.d.ts" />
// Increase field length limits for historical sync compatibility (year 2017 data).
// Several fields had values exceeding the original max limits.

migrate((app) => {
  // staff_applications: 3 fields
  const staffApps = app.findCollectionByNameOrId("staff_applications")

  // ref_1_relationship: 100 -> 1000
  staffApps.fields.add(new Field({
    type: "text",
    name: "ref_1_relationship",
    required: false,
    presentable: false,
    min: 0,
    max: 1000,
    pattern: ""
  }))

  // jewish_community: 2000 -> 4000
  staffApps.fields.add(new Field({
    type: "text",
    name: "jewish_community",
    required: false,
    presentable: false,
    min: 0,
    max: 4000,
    pattern: ""
  }))

  // activity_program: 2000 -> 4000
  staffApps.fields.add(new Field({
    type: "text",
    name: "activity_program",
    required: false,
    presentable: false,
    min: 0,
    max: 4000,
    pattern: ""
  }))

  app.save(staffApps)
}, (app) => {
  // Restore original limits

  const staffApps = app.findCollectionByNameOrId("staff_applications")
  staffApps.fields.add(new Field({
    type: "text",
    name: "ref_1_relationship",
    required: false,
    presentable: false,
    min: 0,
    max: 100,
    pattern: ""
  }))
  staffApps.fields.add(new Field({
    type: "text",
    name: "jewish_community",
    required: false,
    presentable: false,
    min: 0,
    max: 2000,
    pattern: ""
  }))
  staffApps.fields.add(new Field({
    type: "text",
    name: "activity_program",
    required: false,
    presentable: false,
    min: 0,
    max: 2000,
    pattern: ""
  }))
  app.save(staffApps)
})
