import { describe, expect, it } from "vitest";
import type { StoredPlant } from "./plant-store";
import { CSV_COLUMNS, plantsToCsv, sortForSpreadsheet, type CsvPlantRow } from "./csv-export";

// F39 Phase 6c — the plant ↔ tag ↔ zone map as a spreadsheet. Research §5:
// tags fade, blow away and get chewed, so "you need a backup system in a safe
// spot"; the JSON backup restores the app, the CSV is the human-readable map
// the user can print or keep in a sheet. Never a restore path, never a digest.

// Written as the escape, never a literal: an invisible U+FEFF in source is
// silently stripped by formatters and editors.
const BOM = "\uFEFF";
const HEADER = CSV_COLUMNS.join(",");

function plant(overrides: Partial<StoredPlant> = {}): StoredPlant {
  return {
    id: "m1abc-x0000001",
    name: "Meyer lemon",
    plant_type: "citrus",
    species: "Citrus × meyeri",
    cultivar: null,
    location: "Back fence",
    zip_code: "94110",
    cover_assessment_id: null,
    care_profile: null,
    created_at: "2026-03-01T10:00:00.000Z",
    ...overrides,
  };
}

function row(overrides: Partial<CsvPlantRow> = {}): CsvPlantRow {
  return {
    plant: plant(),
    lastAssessedAt: "2026-09-01T08:30:00.000Z",
    lastScore: 78,
    assessments: 4,
    photos: 3,
    ...overrides,
  };
}

/** Split the document into its CRLF-terminated lines (the BOM stripped). */
function lines(csv: string): string[] {
  expect(csv.startsWith(BOM)).toBe(true);
  const body = csv.slice(BOM.length);
  expect(body.endsWith("\r\n")).toBe(true);
  return body.slice(0, -2).split("\r\n");
}

describe("CSV_COLUMNS", () => {
  it("is the exact, ordered contract the header is written from", () => {
    expect(CSV_COLUMNS).toEqual([
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
    ]);
  });
});

describe("plantsToCsv — document shape", () => {
  it("starts with a UTF-8 BOM so spreadsheets read the accents", () => {
    const csv = plantsToCsv([row()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("writes the header in CSV_COLUMNS order as the first line", () => {
    expect(lines(plantsToCsv([row()]))[0]).toBe(HEADER);
  });

  it("empty input → BOM + header only", () => {
    expect(plantsToCsv([])).toBe(`${BOM}${HEADER}\r\n`);
  });

  it("uses CRLF line endings and never a bare LF between records", () => {
    const csv = plantsToCsv([row(), row({ plant: plant({ id: "m1abc-x0000002", name: "Lime" }) })]);
    const body = csv.slice(BOM.length);
    // Every LF is preceded by a CR — the only line breaks are CRLF.
    expect(body.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(lines(csv)).toHaveLength(3);
  });

  it("one line per plant, in input order", () => {
    const csv = plantsToCsv([
      row(),
      row({ plant: plant({ id: "m1abc-x0000002", name: "Lime" }) }),
      row({ plant: plant({ id: "m1abc-x0000003", name: "Kumquat" }) }),
    ]);
    const [, ...records] = lines(csv);
    expect(records.map((r) => r.split(",")[1])).toEqual(["Meyer lemon", "Lime", "Kumquat"]);
  });
});

describe("plantsToCsv — field values", () => {
  it("fills every column from the plant and its computed counts", () => {
    const csv = plantsToCsv([
      row({
        plant: plant({
          tag: "L3",
          zone: "NORTH",
          walk_order: 2,
          codes: ["a".repeat(64), "b".repeat(64)],
          cultivar: "Improved",
        }),
      }),
    ]);
    const [, record] = lines(csv);
    expect(record).toBe(
      [
        "m1abc-x0000001",
        "Meyer lemon",
        "NORTH",
        "2",
        "L3",
        "2",
        "citrus",
        "Citrus × meyeri",
        "Improved",
        "Back fence",
        "94110",
        "2026-03-01T10:00:00.000Z",
        "2026-09-01T08:30:00.000Z",
        "78",
        "4",
        "3",
      ].join(","),
    );
  });

  it("codes column is a COUNT — a digest never reaches the sheet", () => {
    const digest = "c0ffee".padEnd(64, "0");
    const csv = plantsToCsv([row({ plant: plant({ codes: [digest] }) })]);
    expect(csv).not.toContain(digest);
    expect(csv).not.toContain("c0ffee");
    const [, record] = lines(csv);
    expect(record.split(",")[CSV_COLUMNS.indexOf("codes")]).toBe("1");
  });

  it("absent or null optional fields are empty cells, never 'null'/'undefined'", () => {
    const csv = plantsToCsv([
      row({
        plant: plant({ species: null, location: null, zip_code: null }),
        lastAssessedAt: null,
        lastScore: null,
        assessments: 0,
        photos: 0,
      }),
    ]);
    const [, record] = lines(csv);
    const cells = record.split(",");
    expect(cells[CSV_COLUMNS.indexOf("zone")]).toBe("");
    expect(cells[CSV_COLUMNS.indexOf("walk_order")]).toBe("");
    expect(cells[CSV_COLUMNS.indexOf("tag")]).toBe("");
    expect(cells[CSV_COLUMNS.indexOf("codes")]).toBe("0");
    expect(cells[CSV_COLUMNS.indexOf("species")]).toBe("");
    expect(cells[CSV_COLUMNS.indexOf("cultivar")]).toBe("");
    expect(cells[CSV_COLUMNS.indexOf("location")]).toBe("");
    expect(cells[CSV_COLUMNS.indexOf("zip_code")]).toBe("");
    expect(cells[CSV_COLUMNS.indexOf("last_assessed_at")]).toBe("");
    expect(cells[CSV_COLUMNS.indexOf("last_score")]).toBe("");
    expect(cells[CSV_COLUMNS.indexOf("assessments")]).toBe("0");
    expect(cells[CSV_COLUMNS.indexOf("photos")]).toBe("0");
    expect(csv).not.toMatch(/null|undefined|NaN/);
  });

  it("a non-finite score or a repaired-away walk order is an empty cell", () => {
    const csv = plantsToCsv([
      row({ plant: plant({ walk_order: null }), lastScore: Number.NaN }),
    ]);
    const [, record] = lines(csv);
    const cells = record.split(",");
    expect(cells[CSV_COLUMNS.indexOf("walk_order")]).toBe("");
    expect(cells[CSV_COLUMNS.indexOf("last_score")]).toBe("");
  });
});

describe("plantsToCsv — RFC 4180 quoting", () => {
  it("quotes a field containing a comma", () => {
    const csv = plantsToCsv([row({ plant: plant({ name: "Lemon, front yard" }) })]);
    const [, record] = lines(csv);
    expect(record.startsWith('m1abc-x0000001,"Lemon, front yard",')).toBe(true);
  });

  it("quotes a field containing double quotes and doubles them", () => {
    const csv = plantsToCsv([row({ plant: plant({ name: 'The "big" lemon' }) })]);
    const [, record] = lines(csv);
    expect(record).toContain(',"The ""big"" lemon",');
  });

  it("quotes a field containing a newline (LF or CRLF) and keeps it inside the cell", () => {
    const csv = plantsToCsv([
      row({ plant: plant({ name: "Two\nlines", location: "By the\r\nshed" }) }),
    ]);
    const body = csv.slice(BOM.length);
    expect(body).toContain(',"Two\nlines",');
    expect(body).toContain(',"By the\r\nshed",');
    // The record still ends on its own CRLF after the quoted cells.
    expect(body.endsWith("\r\n")).toBe(true);
  });

  it("leaves a plain field unquoted", () => {
    const csv = plantsToCsv([row({ plant: plant({ name: "Plain lemon" }) })]);
    const [, record] = lines(csv);
    expect(record).toContain(",Plain lemon,");
    expect(record).not.toContain('"');
  });
});

// The sheet is the thing the user prints, mails and pastes elsewhere, so a
// cell must never be something a spreadsheet RUNS. It is their own data, but
// "- back row" as a location is ordinary, and Excel reads a leading = + - @
// (or a tab/CR) as the start of a formula.
describe("plantsToCsv — never a formula", () => {
  it("prefixes a cell that would open as a formula with a single quote", () => {
    const csv = plantsToCsv([
      row({
        plant: plant({ name: "=1+1", location: "- back row", tag: "@home", zone: "+NORTH" }),
      }),
    ]);
    const [, record] = lines(csv);
    const cells = record.split(",");
    expect(cells[CSV_COLUMNS.indexOf("name")]).toBe("'=1+1");
    expect(cells[CSV_COLUMNS.indexOf("location")]).toBe("'- back row");
    expect(cells[CSV_COLUMNS.indexOf("tag")]).toBe("'@home");
    expect(cells[CSV_COLUMNS.indexOf("zone")]).toBe("'+NORTH");
  });

  it("neutralizes a leading tab or CR too — quoting stays exactly RFC 4180's rule", () => {
    const csv = plantsToCsv([row({ plant: plant({ name: "\t=HYPERLINK(1)", location: "\rx" }) })]);
    const body = csv.slice(BOM.length);
    // A tab needs no quotes; the CR does, and the prefix sits inside them.
    expect(body).toContain(",'\t=HYPERLINK(1),");
    expect(body).toContain(",\"'\rx\",");
  });

  it("leaves an ordinary cell, a number and a date alone", () => {
    const csv = plantsToCsv([row({ plant: plant({ name: "Meyer lemon", zone: "ROW 2", walk_order: 3 }) })]);
    const [, record] = lines(csv);
    expect(record).not.toContain("'");
    expect(record.split(",")[CSV_COLUMNS.indexOf("walk_order")]).toBe("3");
    expect(record.split(",")[CSV_COLUMNS.indexOf("created_at")]).toBe("2026-03-01T10:00:00.000Z");
  });
});

describe("sortForSpreadsheet", () => {
  it("orders zones alphabetically (numeric-aware), unzoned last, then walk order, then name", () => {
    const rows = [
      row({ plant: plant({ id: "m1abc-x0000001", name: "Zed", zone: null, walk_order: null }) }),
      row({ plant: plant({ id: "m1abc-x0000002", name: "B", zone: "ROW 10", walk_order: 1 }) }),
      row({ plant: plant({ id: "m1abc-x0000003", name: "A", zone: "ROW 2", walk_order: 2 }) }),
      row({ plant: plant({ id: "m1abc-x0000004", name: "C", zone: "ROW 2", walk_order: 1 }) }),
      row({ plant: plant({ id: "m1abc-x0000005", name: "Alpha", zone: null, walk_order: null }) }),
      row({ plant: plant({ id: "m1abc-x0000006", name: "D", zone: "ROW 2", walk_order: null }) }),
    ];
    const sorted = sortForSpreadsheet(rows).map((r) => r.plant.name);
    expect(sorted).toEqual(["C", "A", "D", "B", "Alpha", "Zed"]);
    // Pure: the input is not reordered in place.
    expect(rows[0].plant.name).toBe("Zed");
  });
});
