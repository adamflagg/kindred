/// <reference path="../pb_data/types.d.ts" />
/**
 * Seed the intermediate containers that make PARTIAL merges expressible, and
 * fix two missing bathroom groups.
 *
 * WHY. A merge binds a set of atomic rooms into one bookable slot. History
 * proves six real merges; two of them are partial — `Tenaya 1and2` and
 * `Tioga 1and2` each bind 2 rooms of a 4-room building. The unit tree was flat
 * (one container per building, all rooms as direct children), so neither could
 * be described as "the complete child set of a container". This inserts the
 * missing middle level:
 *
 *   Tioga (container)
 *   |-- Tioga Upstairs (container)   <- new
 *   |   |-- Tioga 1
 *   |   +-- Tioga 2
 *   +-- Tioga Downstairs (container) <- new
 *       |-- Tioga 3
 *       +-- Tioga 4
 *
 * ...and the same for Tenaya. Merging {1,2}, {3,4} or all four is then each
 * the complete child set of exactly one container; {2,3} is not, which is
 * correct — those were never a room pairing.
 *
 * THE LAYOUT, staff-confirmed. Rooms 1 and 2 are bedrooms inside one upstairs
 * apartment that also has a shared bathroom, living room and kitchen — a
 * normal house floorplan. Rooms 3 and 4 are individual bedrooms off a
 * downstairs lobby, and the third door off that lobby is their shared
 * bathroom. So BOTH pairs share a bathroom; what differs is how much living
 * space an unmerged split imposes on two families, which is why the container
 * carries the description and the bedrooms stay bedrooms.
 *
 * THE BATHROOM FIX. Only the 1+2 pairs carried a bathroom_group. Per spec
 * §3.2.1 a `shared` unit upgrades to `private` only when a merge covers every
 * member of its group, and a `shared` unit with NO group can never upgrade at
 * all. So merging 3+4 left the slot reading `shared`, and a family with a
 * medical private-bathroom need would not be matched to it — the same physical
 * outcome as merging 1+2, scored differently purely because of absent data.
 *
 * Containers are never bookable and never counted (is_container true), so
 * these four rows add no capacity. They deliberately carry no `sleeps`: a
 * container's capacity is its children's, and summing over containers is a
 * known way to overstate the site (408 beds against a true 389).
 *
 * Idempotent: every insert and update checks current state first.
 */

migrate(
  (app) => {
    const findUnit = (code) => {
      try {
        return app.findFirstRecordByFilter('lodging_units', 'code = {:code}', { code });
      } catch (e) {
        // findFirstRecordByFilter returns sql.ErrNoRows verbatim when nothing
        // matches. Anything else (malformed filter, DB lock) is real and must
        // not be swallowed into a "not seeded yet" signal.
        if (String(e).indexOf('no rows in result set') === -1) throw e;
        return null;
      }
    };

    const collection = app.findCollectionByNameOrId('lodging_units');

    // [intermediate code, display name, parent building code, [child codes],
    //  bathroom_group to ensure on those children, shared-space note]
    const GROUPS = [
      [
        'gt-tioga-upstairs',
        'Tioga Upstairs',
        'gt-tioga',
        ['gt-tioga-1', 'gt-tioga-2'],
        'gt-tioga-12',
        'Two bedrooms in one apartment sharing a bathroom, living room and kitchen.',
      ],
      [
        'gt-tioga-downstairs',
        'Tioga Downstairs',
        'gt-tioga',
        ['gt-tioga-3', 'gt-tioga-4'],
        'gt-tioga-34',
        'Two bedrooms off a shared entry lobby; the bathroom is the third door off that lobby.',
      ],
      [
        'gt-tenaya-upstairs',
        'Tenaya Upstairs',
        'gt-tenaya',
        ['gt-tenaya-1', 'gt-tenaya-2'],
        'gt-tenaya-12',
        'Two bedrooms in one apartment sharing a bathroom, living room and kitchen.',
      ],
      [
        'gt-tenaya-downstairs',
        'Tenaya Downstairs',
        'gt-tenaya',
        ['gt-tenaya-3', 'gt-tenaya-4'],
        'gt-tenaya-34',
        'Two bedrooms off a shared entry lobby; the bathroom is the third door off that lobby.',
      ],
    ];

    for (const [code, name, buildingCode, childCodes, bathroomGroup, note] of GROUPS) {
      const building = findUnit(buildingCode);
      if (!building) continue; // building absent on this DB; nothing to nest under

      let container = findUnit(code);
      if (!container) {
        container = new Record(collection);
        container.set('code', code);
        container.set('name', name);
        container.set('area', building.get('area'));
        container.set('parent_unit', building.id);
        container.set('is_container', true);
        // Never bookable, so allocation is irrelevant, but the column has no
        // per-field default and an empty select matches neither availability
        // branch. Mirror the building rather than leaving it blank.
        container.set('allocation_default', building.get('allocation_default') || 'family_pool');
        container.set('is_active', true);
        container.set('is_confirmed', false);
        container.set('bathroom', 'none');
        container.set('notes', note);
        container.set('map_x', building.get('map_x'));
        container.set('map_y', building.get('map_y'));
        app.save(container);
      }

      for (const childCode of childCodes) {
        const child = findUnit(childCode);
        if (!child) continue;
        let dirty = false;
        if (child.get('parent_unit') !== container.id) {
          child.set('parent_unit', container.id);
          dirty = true;
        }
        if (!child.get('bathroom_group')) {
          child.set('bathroom_group', bathroomGroup);
          dirty = true;
        }
        if (dirty) app.save(child);
      }
    }
  },
  (app) => {
    // Down: re-parent the rooms onto their building, drop the containers, and
    // clear only the bathroom groups this migration introduced. The 1+2 groups
    // predate it and must survive.
    const findUnit = (code) => {
      try {
        return app.findFirstRecordByFilter('lodging_units', 'code = {:code}', { code });
      } catch (e) {
        if (String(e).indexOf('no rows in result set') === -1) throw e;
        return null;
      }
    };

    const UNDO = [
      ['gt-tioga-upstairs', 'gt-tioga', ['gt-tioga-1', 'gt-tioga-2'], null],
      ['gt-tioga-downstairs', 'gt-tioga', ['gt-tioga-3', 'gt-tioga-4'], 'gt-tioga-34'],
      ['gt-tenaya-upstairs', 'gt-tenaya', ['gt-tenaya-1', 'gt-tenaya-2'], null],
      ['gt-tenaya-downstairs', 'gt-tenaya', ['gt-tenaya-3', 'gt-tenaya-4'], 'gt-tenaya-34'],
    ];

    for (const [code, buildingCode, childCodes, groupToClear] of UNDO) {
      const building = findUnit(buildingCode);
      for (const childCode of childCodes) {
        const child = findUnit(childCode);
        if (!child) continue;
        if (building) child.set('parent_unit', building.id);
        if (groupToClear && child.get('bathroom_group') === groupToClear) {
          child.set('bathroom_group', '');
        }
        app.save(child);
      }
      const container = findUnit(code);
      if (container) app.delete(container);
    }
  }
);
