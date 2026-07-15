import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { checkQuarantine } from "@citrus/shared";
import { bandColor } from "../lib/health";
import { RADIUS, type Tokens } from "../lib/theme";

// HLB quarantine alert (web QuarantineAlert parity): shown on the plant
// detail screen when checkQuarantine (shared module) flags the plant's ZIP.
// Amber = the shared "fair" band color, matching the web's amber alert.

interface Props {
  plant: {
    plant_type: string;
    species?: string | null;
    name?: string | null;
    cultivar?: string | null;
    zip_code?: string | null;
  };
  t: Tokens;
  scheme: "light" | "dark";
}

const HOTLINES = { CA: "1-800-491-1899", TX: "1-800-835-5832" } as const;
const WEBSITES = {
  CA: "https://www.cdfa.ca.gov/plant/pe/InteriorExclusion/hlb.html",
  TX: "https://texasagriculture.gov/Keep-Texas-Citrus-Healthy",
} as const;

export function QuarantineCard({ plant, t, scheme }: Props) {
  const result = checkQuarantine(plant.zip_code, plant);
  if (!result.inQuarantine || !result.state) return null;

  const amber = bandColor("fair", scheme);
  const hotline = HOTLINES[result.state];
  const website = WEBSITES[result.state];

  const open = (url: string) =>
    Linking.openURL(url).catch((e) =>
      console.error("[QuarantineCard] could not open link:", (e as Error).message),
    );

  return (
    <View style={[styles.card, { borderColor: amber, backgroundColor: amber + "14" }]}>
      <Text style={[styles.title, { color: amber }]}>
        ⚠️ Active Citrus Quarantine Zone ({result.state})
      </Text>
      <Text style={[styles.details, { color: t.text }]}>{result.details}</Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Call ${result.state} hotline ${hotline}`}
          onPress={() => open(`tel:${hotline.replace(/-/g, "")}`)}
          style={[styles.button, { backgroundColor: amber }]}
        >
          <Text style={styles.buttonText}>
            📞 Call {result.state} Hotline ({hotline})
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Official quarantine info"
          onPress={() => open(website)}
          style={[styles.button, styles.buttonOutline, { borderColor: amber }]}
        >
          <Text style={[styles.buttonText, { color: amber }]}>🌐 Official Quarantine Info</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: RADIUS,
    padding: 14,
    gap: 8,
  },
  title: { fontSize: 14, fontWeight: "700" },
  details: { fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  button: {
    borderRadius: RADIUS - 3,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  buttonOutline: { backgroundColor: "transparent", borderWidth: 1 },
  buttonText: { color: "#ffffff", fontSize: 12, fontWeight: "600" },
});
