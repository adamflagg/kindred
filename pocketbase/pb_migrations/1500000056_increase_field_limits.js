/// <reference path="../pb_data/types.d.ts" />
// Increase field length limits for historical sync compatibility (year 2017 data).
// Several fields had values exceeding the original max limits.

migrate((app) => {
  // financial_aid_applications.special_circumstances: 5000 -> 10000
  const financialAid = app.findCollectionByNameOrId("financial_aid_applications")
  financialAid.fields.add(new Field({
    type: "text",
    name: "special_circumstances",
    required: false,
    presentable: false,
    min: 0,
    max: 10000,
    pattern: ""
  }))
  app.save(financialAid)

  // household_demographics.away_phone: 200 -> 400
  const householdDemo = app.findCollectionByNameOrId("household_demographics")
  householdDemo.fields.add(new Field({
    type: "text",
    name: "away_phone",
    required: false,
    presentable: false,
    min: 0,
    max: 400,
    pattern: ""
  }))
  app.save(householdDemo)

  // quest_registrations.preferred_name: 100 -> 200
  const questReg = app.findCollectionByNameOrId("quest_registrations")
  questReg.fields.add(new Field({
    type: "text",
    name: "preferred_name",
    required: false,
    presentable: false,
    min: 0,
    max: 200,
    pattern: ""
  }))
  app.save(questReg)

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

  const financialAid = app.findCollectionByNameOrId("financial_aid_applications")
  financialAid.fields.add(new Field({
    type: "text",
    name: "special_circumstances",
    required: false,
    presentable: false,
    min: 0,
    max: 5000,
    pattern: ""
  }))
  app.save(financialAid)

  const householdDemo = app.findCollectionByNameOrId("household_demographics")
  householdDemo.fields.add(new Field({
    type: "text",
    name: "away_phone",
    required: false,
    presentable: false,
    min: 0,
    max: 200,
    pattern: ""
  }))
  app.save(householdDemo)

  const questReg = app.findCollectionByNameOrId("quest_registrations")
  questReg.fields.add(new Field({
    type: "text",
    name: "preferred_name",
    required: false,
    presentable: false,
    min: 0,
    max: 100,
    pattern: ""
  }))
  app.save(questReg)

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
