import { StatusBar } from "expo-status-bar";
import { Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";

// Welcome screen per the native design doc (Obsidian: "Design - Citrus Care Native App").
// Landing/login/signup collapse into this single screen; Google sign-in wiring
// (expo-auth-session -> Supabase signInWithIdToken) is the next implementation step.

const tokens = {
  light: { canvas: "#eef0ed", text: "#191c19", sub: "#5c635c", green: "#059669", onGreen: "#ffffff" },
  dark: { canvas: "#0d0f0d", text: "#f1f3f0", sub: "#a7ada5", green: "#34d399", onGreen: "#06281b" },
};

export default function App() {
  const scheme = useColorScheme();
  const t = tokens[scheme === "dark" ? "dark" : "light"];

  return (
    <View style={[styles.container, { backgroundColor: t.canvas }]}>
      <View style={[styles.mark, { backgroundColor: t.green }]}>
        <Text style={styles.markGlyph}>🍋</Text>
      </View>
      <Text style={[styles.title, { color: t.text }]}>Citrus Care</Text>
      <Text style={[styles.sub, { color: t.sub }]}>
        Snap a photo. Get a health score and a care plan in seconds.
      </Text>
      <Pressable
        style={[styles.cta, { backgroundColor: t.green }]}
        onPress={() => {
          // TODO: expo-auth-session Google flow -> supabase.auth.signInWithIdToken
        }}
      >
        <Text style={[styles.ctaText, { color: t.onGreen }]}>Continue with Google</Text>
      </Pressable>
      <Text style={[styles.foot, { color: t.sub }]}>
        Same account and plants as the web app.
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 14 },
  mark: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" },
  markGlyph: { fontSize: 40 },
  title: { fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
  sub: { fontSize: 15, textAlign: "center", lineHeight: 22, maxWidth: 280 },
  cta: { marginTop: 18, paddingVertical: 15, paddingHorizontal: 26, borderRadius: 10, minWidth: 260, alignItems: "center" },
  ctaText: { fontSize: 16, fontWeight: "600" },
  foot: { fontSize: 12, marginTop: 6 },
});
