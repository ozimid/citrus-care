import { StatusBar } from "expo-status-bar";
import { useEffect, useReducer, useState } from "react";
import { ActivityIndicator, Modal, StyleSheet, View } from "react-native";
import { LocalEngineProvider } from "./src/components/LocalEngineProvider";
import { TabBar, type Tab } from "./src/components/TabBar";
import { authReducer, initialAuthState } from "./src/lib/auth-state";
import { supabase } from "./src/lib/supabase";
import { useTheme } from "./src/lib/theme";
import { CaptureScreen } from "./src/screens/CaptureScreen";
import { PlantsScreen } from "./src/screens/PlantsScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { WelcomeScreen } from "./src/screens/WelcomeScreen";

// Root: restores the persisted Supabase session, then renders Welcome
// (signed out) or the tabbed main app (signed in). Navigation is a
// conditional render + tab state on purpose — stacked flows (capture,
// plant detail) are Modals, so no nav library is needed yet.

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
  const [capturing, setCapturing] = useState(false);
  // Bumped when an assessment persists so the Plants tab behind the capture
  // modal reloads and the new score is visible the moment the modal closes.
  const [plantsVersion, setPlantsVersion] = useState(0);

  return (
    // The on-device engine (D-15 Stage 2) is scoped to the signed-in app so
    // the model session loads once and outlives tab switches and the capture
    // modal. Opt-in and lazy: signed-out users never touch executorch.
    <LocalEngineProvider>
      <View style={[styles.fill, { backgroundColor: t.canvas }]}>
        <View style={styles.fill}>
          {tab === "plants" ? (
            <PlantsScreen refreshToken={plantsVersion} />
          ) : (
            <ProfileScreen email={userEmail} />
          )}
        </View>
        <TabBar active={tab} onSelect={setTab} onAssess={() => setCapturing(true)} />
        {/* Full-screen capture flow over the tabs (design doc §3) — a Modal so
            no nav library is needed yet. */}
        <Modal
          visible={capturing}
          animationType="slide"
          onRequestClose={() => setCapturing(false)}
        >
          <CaptureScreen
            onClose={() => setCapturing(false)}
            onAssessed={() => setPlantsVersion((v) => v + 1)}
          />
        </Modal>
        <StatusBar style="auto" />
      </View>
    </LocalEngineProvider>
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
