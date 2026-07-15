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

/** Android needs a channel before anything can be delivered; iOS ignores this. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("reminders", {
    name: "Re-assessment reminders",
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
