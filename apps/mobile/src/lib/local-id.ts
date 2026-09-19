// D-17: local record ids. With no Postgres there is no gen_random_uuid(), so
// the phone mints its own ids for plants and assessments. Deterministic given
// its inputs (testable, no crypto/uuid dep), collision-resistant via a
// timestamp + a [0,1) random — the same construction as photo-store's
// photoFileName, minus the extension.

/** `<time36>-<rand36>` — sortable-ish by creation time, unique in practice. */
export function newLocalId(nowMs: number, random: number): string {
  const time = nowMs.toString(36);
  const rand = Math.floor(random * 36 ** 8)
    .toString(36)
    .padStart(8, "0");
  return `${time}-${rand}`;
}

// D-W16: ids double as photo directory names, so anything that reaches a
// parser (AsyncStorage blob, backup file) is gated here before it can name a
// path. Two shapes only: newLocalId output, and the RFC-4122 UUIDs the
// Gemini-era rows still carry — dropping those would lose legacy thumbnails.
const LOCAL_ID_RE = /^[0-9a-z]{1,16}-[0-9a-z]{8}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True only for an id this app could have minted (local or legacy UUID). */
export function isSafeRecordId(id: unknown): id is string {
  return typeof id === "string" && id.length <= 64 && (LOCAL_ID_RE.test(id) || UUID_RE.test(id));
}

/** True only for a photo-store `photoFileName` — the one basename shape the
 * app ever writes, so nothing else can be joined onto a plant directory. */
export function isSafeBasename(name: unknown): name is string {
  return typeof name === "string" && /^[0-9a-z]{1,16}-[0-9a-z]{8}\.jpg$/.test(name);
}

/** The ONE "newest first" ordering: createdAt desc, then the record key desc.
 * Ids double as the tiebreak, so the timeline, the photo index, the comparison
 * anchor and the backup carrier all agree on "newest" when a walk lands two
 * shots of one plant in the same second — whatever order the JSON map came
 * back in. Callers pass their own key (assessment id, index key). */
export function newestFirst(aAt: string, aKey: string, bAt: string, bKey: string): number {
  if (aAt !== bAt) return aAt < bAt ? 1 : -1;
  return aKey < bKey ? 1 : aKey > bKey ? -1 : 0;
}
