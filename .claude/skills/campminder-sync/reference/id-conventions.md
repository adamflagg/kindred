# CampMinder ID vs PocketBase ID Conventions

## The Core Principle

**CampMinder IDs are the identity layer. PocketBase IDs are implementation details.**

Every record synced from CampMinder has two IDs:
- **CampMinder ID (`cm_id` or `person_id`)**: Stable identifier from the source system. Used for all cross-table lookups and relationships.
- **PocketBase ID (`id`)**: Auto-generated 15-character alphanumeric string. Changes if a record is deleted and re-created. Never used for cross-table references in data fields.

## Field Naming Conventions

| Field | Type | Purpose |
|-------|------|---------|
| `cm_id` | int | The CampMinder ID for this record's primary entity |
| `person_id` | int | CampMinder person ID (on attendees, bunk_assignments, etc.) |
| `person` | relation | PocketBase relation field pointing to persons table (resolved from CM ID) |
| `session` | relation | PocketBase relation field pointing to camp_sessions table |
| `bunk` | relation | PocketBase relation field pointing to bunks table |
| `year` | int | Season/year identifier (from `CAMPMINDER_SEASON_ID`) |

**Pattern:** Data fields store CM IDs (`person_id = 12345`). Relation fields store PB IDs (`person = "abc123def456789"`). The relation fields are populated by resolving CM IDs at write time.

## How Relations Are Resolved

The `PopulateRelations()` utility on `BaseSyncService` resolves CM IDs to PB IDs:

```go
// 1. Store the CM ID as data
recordData["person_id"] = personCMID

// 2. Define relations to resolve
relations := []RelationConfig{
    {FieldName: "session", Collection: "camp_sessions", CMID: sessionCMID, Required: true},
    {FieldName: "person", Collection: "persons", CMID: personCMID, Required: false},
}

// 3. PopulateRelations looks up each CM ID in PocketBase and sets the PB ID
if err := s.PopulateRelations(recordData, relations); err != nil {
    return fmt.Errorf("populating relations: %w", err)
}
// After this, recordData["session"] = "pb_id_of_session"
// and recordData["person"] = "pb_id_of_person" (if found)
```

### Required vs Optional Relations

- `Required: true` -- If the CM ID can't be resolved to a PB ID, `PopulateRelations` returns an error. Use for mandatory foreign keys (e.g., every attendee must have a session).
- `Required: false` -- If the CM ID can't be resolved, the field is silently skipped. Use for optional associations (e.g., a person record that hasn't been synced yet).

## LookupRelation Internals

`LookupRelation(collection, cmID, fieldName)` queries PocketBase:
```go
filter := fmt.Sprintf("cm_id = %d", cmID)
// For year-scoped collections, automatically adds:
// filter += fmt.Sprintf(" && year = %d", year)
```

This is why year isolation is critical -- without the year filter, `cm_id = 12345` might match records from multiple years.

## Composite Keys

Some tables have multi-field uniqueness. The composite key format is `{field1}:{field2}`:

```go
// Attendees: unique by person + session
key := fmt.Sprintf("%d:%d", personCMID, sessionCMID)

// Bunk assignments: unique by person + bunk + session
key := fmt.Sprintf("%d:%d:%d", personCMID, bunkCMID, sessionCMID)
```

For year isolation, the base utilities automatically append `|{year}`:
```go
// Internal storage key: "12345:67890|2026"
s.TrackProcessedCompositeKey(key, year)
```

## Reverse Lookups

When you have a PB ID and need the CM ID (uncommon, but needed for building composite keys from existing records):

```go
cmID, found := s.LookupCMIDByPBID("persons", pbID)
```

For batch reverse lookups:
```go
mappings, err := s.BuildRecordCMIDMappings("attendees", filter, map[string]string{
    "person":  "persons",
    "session": "camp_sessions",
})
// mappings[recordPBID]["personCMID"] = 12345
// mappings[recordPBID]["sessionCMID"] = 67890
```

## Common Mistakes

| Mistake | What happens | Fix |
|---------|-------------|-----|
| Store PB ID in `person_id` field | Breaks after re-sync (PB IDs change) | Always store CM ID in data fields |
| Use `person_id` as a PB relation | PocketBase errors (wrong ID format) | Use `person` (relation) for PB joins |
| Skip `PopulateRelations` | Relation fields empty, PB joins fail | Always call for every relation field |
| Forget year in `LookupRelation` | Returns wrong-year record | `LookupRelation` auto-adds year for known collections |
| Hardcode PB IDs in tests | Tests break when PB regenerates IDs | Use CM IDs and resolve in test setup |
