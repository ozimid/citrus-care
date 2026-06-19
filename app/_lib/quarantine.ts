const CA_HLB_ZIPS = new Set([
  // Los Angeles, Orange, Riverside, San Bernardino, San Diego, Ventura counties
  "90631", "91706", "91745", "92324", "92801", "92805", "92065", "92056", "92354",
  "90001", "90002", "90022", "90201", "90262", "90280", "90601", "90602", "90603",
  "90604", "90605", "90606", "90640", "90650", "90660", "90701", "90703", "90706",
  "90712", "90713", "90715", "90805", "90807", "90808", "91702", "91710", "91731",
  "91732", "91733", "91744", "91746", "91748", "91754", "91755", "91761", "91762",
  "91763", "91764", "91765", "91766", "91767", "91768", "91770", "91773", "91775",
  "91776", "91780", "91786", "91789", "91790", "91791", "91792", "91801", "91803",
  "92335", "92336", "92337", "92501", "92503", "92504", "92505", "92506", "92507",
  "92508", "92509", "92518", "92551", "92553", "92555", "92557", "92821", "92831",
  "92832", "92833", "92835", "92840", "92841", "92843", "92844", "92845", "92865",
  "92866", "92867", "92868", "92869", "92870", "92879", "92880", "92881", "92882",
]);

// Helper to check if a Texas ZIP falls under the HLB quarantine (Cameron, Hidalgo, Harris, Fort Bend, Montgomery, etc.)
function isTexasQuarantined(zip: string): boolean {
  // Harris/Greater Houston: 770xx, 772xx, 773xx, 774xx, 775xx
  // Rio Grande Valley (Cameron/Hidalgo): 785xx
  return (
    zip.startsWith("770") ||
    zip.startsWith("772") ||
    zip.startsWith("773") ||
    zip.startsWith("774") ||
    zip.startsWith("775") ||
    zip.startsWith("785")
  );
}

export function isCitrus(plant: {
  plant_type: string;
  species?: string | null;
  name?: string | null;
  cultivar?: string | null;
}): boolean {
  if (plant.plant_type !== "tree") return false;

  const keywords = [
    "citrus",
    "lemon",
    "lime",
    "orange",
    "mandarin",
    "satsuma",
    "clementine",
    "tangerine",
    "kumquat",
    "grapefruit",
    "pomelo",
    "bergamot",
    "yuzu",
    "calamansi",
  ];

  const searchStr = `${plant.name ?? ""} ${plant.species ?? ""} ${plant.cultivar ?? ""}`.toLowerCase();
  return keywords.some((kw) => searchStr.includes(kw));
}

export function checkQuarantine(
  zipCode: string | null | undefined,
  plant: {
    plant_type: string;
    species?: string | null;
    name?: string | null;
    cultivar?: string | null;
  },
): { inQuarantine: boolean; state?: "CA" | "TX"; details?: string } {
  if (!zipCode) {
    return { inQuarantine: false };
  }

  const cleanZip = zipCode.trim();

  // Only run quarantine alerts for citrus varieties
  if (!isCitrus(plant)) {
    return { inQuarantine: false };
  }

  if (CA_HLB_ZIPS.has(cleanZip)) {
    return {
      inQuarantine: true,
      state: "CA",
      details: "California Department of Food and Agriculture (CDFA) HLB quarantine zone (5-mile radius around confirmed detections). Moving citrus foliage, clippings, and plants off-property is prohibited by law.",
    };
  }

  if (isTexasQuarantined(cleanZip)) {
    return {
      inQuarantine: true,
      state: "TX",
      details: "Texas Department of Agriculture (TDA) citrus quarantine zone. Transporting citrus plants or plant parts out of the quarantine area is strictly restricted to prevent the spread of Huanglongbing (HLB) and Asian Citrus Psyllid.",
    };
  }

  return { inQuarantine: false };
}
