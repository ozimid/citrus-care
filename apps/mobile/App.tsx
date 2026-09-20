import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { LocalEngineProvider } from "./src/components/LocalEngineProvider";
import { TabBar, type Tab } from "./src/components/TabBar";
import { recoverInterruptedWalk } from "./src/lib/photo-queue-io";
import { useTheme } from "./src/lib/theme-io";
import { CaptureScreen } from "./src/screens/CaptureScreen";
import { PlantsScreen } from "./src/screens/PlantsScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";

// Root (D-17): no accounts, no sign-in — everything lives on the phone, so the
// app opens straight to the tabbed main screen. Navigation is a conditional
// render + tab state; stacked flows (capture, plant detail) are Modals, so no
// nav library is needed yet.

export default function App() {
  const { t } = useTheme();
  const [tab, setTab] = useState<Tab>("plants");
  const [capturing, setCapturing] = useState(false);
  // Bumped when an assessment persists so the Plants tab behind the capture
  // modal reloads and the new score is visible the moment the modal closes.
  const [plantsVersion, setPlantsVersion] = useState(0);

  // D-W2: once per process, before any capture — a walk the last process
  // died in the middle of is reconciled against the stores and inbox
  // orphans are swept. Best-effort inside; nothing here can block the app.
  useEffect(() => {
    void recoverInterruptedWalk();
  }, []);

  return (
    // The on-device engine (D-17) loads once here, above the tabs, so the model
    // session outlives tab switches and the capture modal.
    <LocalEngineProvider>
      <View style={[styles.fill, { backgroundColor: t.canvas }]}>
        <View style={styles.fill}>
          {tab === "plants" ? <PlantsScreen refreshToken={plantsVersion} /> : <ProfileScreen />}
        </View>
        <TabBar active={tab} onSelect={setTab} onAssess={() => setCapturing(true)} />
        {/* Full-screen capture flow over the tabs (design doc §3) — a Modal so
            no nav library is needed yet. */}
        <Modal
          visible={capturing}
          animationType="slide"
          // Hardware back bypasses CaptureScreen's close(): walk shots are
          // already durable (D-W2), so the only thing to keep is the Plants
          // tab's pending-walk card — refresh it on this exit too.
          onRequestClose={() => {
            setPlantsVersion((v) => v + 1);
            setCapturing(false);
          }}
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

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
