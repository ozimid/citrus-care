// F39 Phase 6c — the plant ↔ tag ↔ zone ↔ last-assessment map as a
// spreadsheet (pure half; csv-export-io.ts builds the rows and shares the
// file). Research §5: tags fade, blow away and get chewed — "you need a backup
// system in a safe spot" — and every professional system keeps the map
// outside the tags. The JSON backup is the RESTORE path; this CSV is the
// human-readable map the user can print, sort or paste into their own sheet.
//
// What never leaves: a bound code is exported as a COUNT, not a digest, so a
// sticker's identity cannot be reconstructed from the sheet (D-W4/D-W13).
// Photos are counted, not carried. The document follows RFC 4180: CRLF
// records, fields quoted only when they hold a comma, a quote or a line
// break, embedded quotes doubled. A UTF-8 BOM up front makes Excel read
// "Citrus × meyeri" as UTF-8 instead of the locale codepage.

import { isWalkOrder, type StoredPlant } from "./plant-store";
import { compareWalkPosition, compareZones } from "./walk-order";

/** The header, in order. A column added here is a contract change — the
 * user's own spreadsheets may key on these names. */
export const CSV_COLUMNS = [
  "id",
  "name",
  "zone",
  "walk_order",
  "tag",
  "codes",
  "plant_type",
  "species",
  "cultivar",
  "location",
  "zip_code",
  "created_at",
  "last_assessed_at",
  "last_score",
  "assessments",
  "photos",
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

/** One plant plus the counts the io derives from the assessment store and the
 * photo index — the pure half never walks the stores itself. */
export interface CsvPlantRow {
  plant: StoredPlant;
  /** ISO instant of the newest assessment (its effective time), null = never. */
  lastAssessedAt: string | null;
  lastScore: number | null;
  assessments: number;
  photos: number;
}

// The escape, never a literal: an invisible U+FEFF in source is silently
// stripped by formatters and editors, and the loss is invisible in review.
const UTF8_BOM = "\uFEFF";
const CRLF = "\r\n";

/** A spreadsheet reads a cell starting with = + - @ (or a tab / CR) as the
 * start of a FORMULA — the classic CSV-injection footgun. It is the user's own
 * data, but "- back row" as a location is ordinary and the sheet is what they
 * print, mail and paste elsewhere, so the cell is prefixed with a single quote
 * and shown as the text they typed. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** RFC 4180 §2.5–2.7: quote when the field holds a separator, a quote or a
 * line break; double every embedded quote. Anything else is written bare.
 * (Quoting is not protection from a formula — Excel evaluates a quoted cell
 * too — so the prefix goes on first and the quoting rule is untouched.) */
function csvField(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value : "";
}

/** A finite number as digits; anything else (null, NaN, a repaired-away walk
 * order) is an empty cell — a sheet must never read "null" or "NaN". */
function numeric(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function count(value: number): string {
  return Number.isFinite(value) && value >= 0 ? String(Math.trunc(value)) : "0";
}

function cells(row: CsvPlantRow): Record<CsvColumn, string> {
  const { plant } = row;
  return {
    id: plant.id,
    name: plant.name,
    zone: text(plant.zone),
    walk_order: isWalkOrder(plant.walk_order) ? String(plant.walk_order) : "",
    tag: text(plant.tag),
    // The count, never the digests (D-W4): a sticker's identity stays on the phone.
    codes: String(plant.codes?.length ?? 0),
    plant_type: plant.plant_type,
    species: text(plant.species),
    cultivar: text(plant.cultivar),
    location: text(plant.location),
    zip_code: text(plant.zip_code),
    created_at: plant.created_at,
    last_assessed_at: text(row.lastAssessedAt),
    last_score: numeric(row.lastScore),
    assessments: count(row.assessments),
    photos: count(row.photos),
  };
}

/** The whole document: BOM, header, one CRLF-terminated record per row in the
 * order given (sortForSpreadsheet puts them in walk order). Empty input is a
 * valid sheet — BOM + header — so an export with zero plants still opens. */
export function plantsToCsv(rows: ReadonlyArray<CsvPlantRow>): string {
  const header = CSV_COLUMNS.map(csvField).join(",");
  const records = rows.map((row) => {
    const values = cells(row);
    return CSV_COLUMNS.map((column) => csvField(values[column])).join(",");
  });
  return `${UTF8_BOM}${[header, ...records].join(CRLF)}${CRLF}`;
}

/** Walk order for the sheet — the same order the Plants list and the
 * viewfinder use: zones alphabetical (numeric-aware), unzoned plants last,
 * then walk position, then name. Returns a new array; the input is untouched. */
export function sortForSpreadsheet(rows: ReadonlyArray<CsvPlantRow>): CsvPlantRow[] {
  return [...rows].sort((a, b) => {
    const byZone = compareZones(a.plant.zone ?? null, b.plant.zone ?? null);
    if (byZone !== 0) return byZone;
    return compareWalkPosition(
      { walkOrder: a.plant.walk_order, name: a.plant.name },
      { walkOrder: b.plant.walk_order, name: b.plant.name },
    );
  });
}
