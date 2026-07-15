import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../lib/theme";

// Bottom tab bar with a center camera FAB per the native design doc §3:
// Plants · Assess (FAB, disabled until the capture flow ships) · Profile.

export type Tab = "plants" | "profile";

interface Props {
  active: Tab;
  onSelect: (tab: Tab) => void;
}

export function TabBar({ active, onSelect }: Props) {
  const { t } = useTheme();

  return (
    <View style={[styles.bar, { backgroundColor: t.card, borderTopColor: t.border }]}>
      <TabButton
        label="Plants"
        glyph="🪴"
        selected={active === "plants"}
        onPress={() => onSelect("plants")}
      />
      <View style={styles.fabSlot}>
        <View
          accessibilityLabel="Assess — coming soon"
          style={[styles.fab, { backgroundColor: t.green, opacity: 0.4 }]}
        >
          <Text style={styles.fabGlyph}>📷</Text>
        </View>
        <Text style={[styles.fabHint, { color: t.sub }]}>Soon</Text>
      </View>
      <TabButton
        label="Profile"
        glyph="👤"
        selected={active === "profile"}
        onPress={() => onSelect("profile")}
      />
    </View>
  );
}

function TabButton({
  label,
  glyph,
  selected,
  onPress,
}: {
  label: string;
  glyph: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.tab}
    >
      <Text style={styles.tabGlyph}>{glyph}</Text>
      <Text style={[styles.tabLabel, { color: selected ? t.green : t.sub }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingBottom: 24,
    paddingHorizontal: 12,
  },
  tab: { alignItems: "center", gap: 2, minWidth: 72, paddingVertical: 4 },
  tabGlyph: { fontSize: 20 },
  tabLabel: { fontSize: 11, fontWeight: "600" },
  fabSlot: { alignItems: "center", gap: 2, marginTop: -26 },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  fabGlyph: { fontSize: 24 },
  fabHint: { fontSize: 10, fontWeight: "600" },
});
