// Thin expo-notifications wiring for the tested reminder logic in
// reminders.ts (same split as photo.ts vs photo-io.ts). Untested by design —
// exercised via `expo export` bundling (README policy).

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { ReminderScheduler } from "./reminders";

// Show reminders even if the app happens to be foregrounded when one fires.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Android needs a channel before anything can be delivered; iOS ignores this.
 * Re-assessment and F20 watering reminders share the one channel (id kept as
 * "reminders" — changing it would orphan existing installs' settings). */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("reminders", {
    name: "Plant reminders",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export const notificationScheduler: ReminderScheduler = {
  async getPermissions() {
    const p = await Notifications.getPermissionsAsync();
    return { granted: p.granted, canAskAgain: p.canAskAgain };
  },
  async requestPermissions() {
    const p = await Notifications.requestPermissionsAsync();
    return { granted: p.granted, canAskAgain: p.canAskAgain };
  },
  async schedule(req) {
    await ensureAndroidChannel();
    return Notifications.scheduleNotificationAsync({
      content: req.content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: req.trigger.date,
        channelId: "reminders",
      },
    });
  },
  async cancel(id) {
    await Notifications.cancelScheduledNotificationAsync(id);
  },
  async getScheduled() {
    return Notifications.getAllScheduledNotificationsAsync();
  },
};

/** #5 — once-per-night guard for weather alerts. The list re-syncs on every
 * load, and a tonight-alert's "evening before" slot is already past, so
 * without this mark each refresh would re-fire the notification at now+60s
 * (adversarial critic). Best-effort on both ends. */
const WEATHER_ALERT_MARK_KEY = "citrus.weather-alert-mark.v1";

export async function loadWeatherAlertMark(): Promise<string | null> {
  try {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    return await AsyncStorage.getItem(WEATHER_ALERT_MARK_KEY);
  } catch (e) {
    console.error("[reminders-io] alert mark read failed:", (e as Error).message);
    return null;
  }
}

export async function saveWeatherAlertMark(mark: string): Promise<void> {
  try {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    await AsyncStorage.setItem(WEATHER_ALERT_MARK_KEY, mark);
  } catch (e) {
    console.error("[reminders-io] alert mark save failed:", (e as Error).message);
  }
}
