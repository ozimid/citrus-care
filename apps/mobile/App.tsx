import { StatusBar } from "expo-status-bar";
import { useEffect, useReducer, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { TabBar, type Tab } from "./src/components/TabBar";
import { authReducer, initialAuthState } from "./src/lib/auth-state";
import { supabase } from "./src/lib/supabase";
import { useTheme } from "./src/lib/theme";
import { PlantsScreen } from "./src/screens/PlantsScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { WelcomeScreen } from "./src/screens/WelcomeScreen";

// Root: restores the persisted Supabase session, then renders Welcome
// (signed out) or the tabbed main app (signed in). Navigation is a
// conditional render + tab state on purpose — no nav library until a
// stacked flow (plant detail) actually needs one.

export default function App() {
  const [auth, dispatch] = useReducer(authReducer, initialAuthState);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      dispatch({ type: "SESSION_CHANGED", email: session ? (session.user.email ?? "") : null });
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      dispatch({ type: "SESSION_CHANGED", email: session ? (session.user.email ?? "") : null });
    });
    return () => subscription.unsubscribe();
  }, []);

  if (auth.phase === "restoring") return <Restoring />;
  if (auth.phase !== "signedIn") {
    return <WelcomeScreen phase={auth.phase} error={auth.error} dispatch={dispatch} />;
  }
  return <Main userEmail={auth.userEmail} />;
}

function Main({ userEmail }: { userEmail: string | null }) {
  const { t } = useTheme();
  const [tab, setTab] = useState<Tab>("plants");

  return (
    <View style={[styles.fill, { backgroundColor: t.canvas }]}>
      <View style={styles.fill}>
        {tab === "plants" ? <PlantsScreen /> : <ProfileScreen email={userEmail} />}
      </View>
      <TabBar active={tab} onSelect={setTab} />
      <StatusBar style="auto" />
    </View>
  );
}

function Restoring() {
  const { t } = useTheme();
  return (
    <View style={[styles.fill, styles.center, { backgroundColor: t.canvas }]}>
      <ActivityIndicator color={t.green} />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
});
