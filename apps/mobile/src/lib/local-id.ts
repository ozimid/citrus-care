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
