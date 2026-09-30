/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_grantors.pays_after_camp_aid -- a grantor fact (D143): this funder pays whatever the camp's
 * award leaves, so its grants never lower the award.
 *
 * A last-dollar funder fills the gap LAST: CampMinder shows it posted at the full session
 * price, then reversed and reposted for what the camp's award left. Fed to the calculator like any
 * other outside grant, that first full-price line would cut the camp's Round 1 award to $0. With
 * this flag set, the register still lists the grant (money totals, development's all-money
 * figures, the budget's below-the-line outside grants); only the calculator bridge
 * (api/services/financial_aid_grants_register.py grant_inputs_by_request) leaves it out.
 *
 * A pays-after grantor is also full_coverage (FastAPI refuses the one without the other).
 * Additive: every existing grantor reads false, which is today's behaviour. Staff data written
 * by FastAPI; the collection's rules stay null.
 */
migrate((app) => {
  const grantors = app.findCollectionByNameOrId("aid_grantors");
  grantors.fields.add(new Field({ type: "bool", name: "pays_after_camp_aid", required: false, presentable: false }));
  app.save(grantors);
}, (app) => {
  const grantors = app.findCollectionByNameOrId("aid_grantors");
  grantors.fields.removeByName("pays_after_camp_aid");
  app.save(grantors);
});
