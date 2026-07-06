/**
 * Keep only records whose person is an enrolled attendee.
 *
 * Staff hold `bunk_assignments` rows (assigned to a cabin) but have no
 * `attendees` row, so they are not enrolled campers. Any camper count or
 * scenario comparison derived from raw assignments must intersect against the
 * enrolled person set to exclude staff (#1787, #1747, #1791). This is the single
 * place that intersection logic lives on the frontend — call it with whatever
 * person key both sides share (a PocketBase relation id, or a CampMinder cm_id).
 *
 * @param records      Rows to filter (bunk assignments, normalized campers, …).
 * @param personKey    Extracts the person key used to match enrollment.
 * @param enrolledKeys Person keys of enrolled attendees, in the same key space
 *                     as `personKey`.
 */
export function filterToEnrolled<T>(
  records: readonly T[],
  personKey: (record: T) => string | number | null | undefined,
  enrolledKeys: ReadonlySet<string | number>
): T[] {
  return records.filter((record) => {
    const key = personKey(record)
    return key != null && enrolledKeys.has(key)
  })
}
