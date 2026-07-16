// Re-assessment reminders (design doc §6): LOCAL notifications scheduled from
// the diagnosis screen — open question 6 resolved pragmatically as local-first
// (deleting the app loses reminders; server-driven push can come later).
// Pure, dependency-injected, tested; the expo-notifications wiring lives in
// reminders-io.ts. Permission is requested at the "remind me" tap, never at
// launch (design doc open question 2: contextual opt-in).

export type ReminderInterval = "1w" | "2w" | "1m";

export const REMINDER_INTERVALS: Record<ReminderInterval, { label: string; days: number }> = {
  "1w": { label: "in 1 week", days: 7 },
  "2w": { label: "in 2 weeks", days: 14 },
  "1m": { label: "in 1 month", days: 30 },
};

export function reminderDate(from: Date, interval: ReminderInterval): Date {
  return new Date(from.getTime() + REMINDER_INTERVALS[interval].days * 24 * 60 * 60 * 1000);
}

export function reminderContent(plantName: string): { title: string; body: string } {
  return {
    title: `${plantName} is due for a check 🍋`,
    body: "Snap a quick photo to see how it's doing.",
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jul 28" — UTC-based so the label matches the tested trigger math. */
export function formatReminderDate(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

export interface PermissionStatus {
  granted: boolean;
  canAskAgain: boolean;
}

export interface ReminderRequest {
  content: { title: string; body: string; data: Record<string, unknown> };
  trigger: { type: "date"; date: Date };
}

/** Structural slice of expo-notifications' NotificationRequest; the fire date
 * travels in content.data.fireDate because trigger shapes differ per platform. */
export interface ScheduledReminderRequest {
  identifier: string;
  content: { title?: string | null; data?: Record<string, unknown> | null };
}

export interface ReminderScheduler {
  getPermissions(): Promise<PermissionStatus>;
  requestPermissions(): Promise<PermissionStatus>;
  schedule(req: ReminderRequest): Promise<string>;
  cancel(id: string): Promise<void>;
  getScheduled(): Promise<ScheduledReminderRequest[]>;
}

export type ScheduleOutcome =
  | { ok: true; id: string; date: Date }
  | { ok: false; reason: "permission-denied" };

export interface ScheduleReminderInput {
  plantId: string;
  plantName: string;
  interval: ReminderInterval;
  /** Injectable clock for tests; defaults to now. */
  now?: Date;
}

export async function scheduleReminder(
  scheduler: ReminderScheduler,
  input: ScheduleReminderInput,
): Promise<ScheduleOutcome> {
  let permission = await scheduler.getPermissions();
  if (!permission.granted) {
    if (!permission.canAskAgain) return { ok: false, reason: "permission-denied" };
    permission = await scheduler.requestPermissions();
    if (!permission.granted) return { ok: false, reason: "permission-denied" };
  }

  const date = reminderDate(input.now ?? new Date(), input.interval);
  const id = await scheduler.schedule({
    content: {
      ...reminderContent(input.plantName),
      data: { plantId: input.plantId, plantName: input.plantName, fireDate: date.toISOString() },
    },
    trigger: { type: "date", date },
  });
  return { ok: true, id, date };
}

export async function cancelReminder(scheduler: ReminderScheduler, id: string): Promise<void> {
  await scheduler.cancel(id);
}

// ------------------------------------------------------------------
// F20 — watering reminders. Same local-notification machinery as the
// re-assessment reminders above, fired at the due date the deterministic
// watering math produced (src/lib/watering.ts). No server, no push.
// ------------------------------------------------------------------

/** Quiet hours: a watering nudge is only useful when you can act on it, so
 * notifications land between 09:00 and 18:00 local. */
export const WATERING_WINDOW_START_HOUR = 9;
export const WATERING_WINDOW_END_HOUR = 18;

/** Marks a notification as a watering reminder in its payload, so re-scheduling
 * can replace exactly this plant's watering nudge and leave the plant's
 * re-assessment reminder alone. */
export const WATERING_REMINDER_KIND = "watering";

/** Move a fire time into the next 09:00-18:00 local slot. Before 9 → 9am the
 * same day; 18:00 or later → 9am tomorrow; inside the window → unchanged. */
export function clampToWateringWindow(date: Date): Date {
  const hour = date.getHours();
  if (hour >= WATERING_WINDOW_START_HOUR && hour < WATERING_WINDOW_END_HOUR) return date;
  const out = new Date(date);
  if (hour >= WATERING_WINDOW_END_HOUR) {
    // setDate rolls month/year boundaries for us.
    out.setDate(out.getDate() + 1);
  }
  out.setHours(WATERING_WINDOW_START_HOUR, 0, 0, 0);
  return out;
}

export function wateringReminderContent(
  plantName: string,
  reason: string,
): { title: string; body: string } {
  return {
    title: `Time to water ${plantName} 💧`,
    body: reason,
  };
}

export interface ScheduleWateringInput {
  plantId: string;
  plantName: string;
  /** Due date from wateringPlan().nextWaterDueAt. */
  dueAt: Date;
  /** wateringPlan().reason — the notification body, so the nudge explains itself. */
  reason: string;
  now?: Date;
}

/** True for this plant's watering reminders only. */
function isWateringReminderFor(req: ScheduledReminderRequest, plantId: string): boolean {
  const data = req.content.data ?? {};
  return data.kind === WATERING_REMINDER_KIND && data.plantId === plantId;
}

/**
 * (Re)schedule a plant's watering notification. Any previous watering reminder
 * for the same plant is cancelled first — the due date moves every time the
 * weather or a "Watered today" tap changes the math, and stacked notifications
 * would nag with stale dates.
 */
export async function scheduleWateringReminder(
  scheduler: ReminderScheduler,
  input: ScheduleWateringInput,
): Promise<ScheduleOutcome> {
  let permission = await scheduler.getPermissions();
  if (!permission.granted) {
    if (!permission.canAskAgain) return { ok: false, reason: "permission-denied" };
    permission = await scheduler.requestPermissions();
    if (!permission.granted) return { ok: false, reason: "permission-denied" };
  }

  const now = input.now ?? new Date();
  // An overdue plant must still fire in the future: start from now, never the
  // past due date, then clamp into the window.
  const from = input.dueAt.getTime() > now.getTime() ? input.dueAt : new Date(now.getTime() + 60_000);
  const date = clampToWateringWindow(from);

  // Best-effort de-dupe: a failed lookup must not block the reminder.
  try {
    const existing = await scheduler.getScheduled();
    for (const req of existing) {
      if (isWateringReminderFor(req, input.plantId)) await scheduler.cancel(req.identifier);
    }
  } catch (e) {
    console.error("[scheduleWateringReminder] could not clear old reminders:", (e as Error).message);
  }

  const id = await scheduler.schedule({
    content: {
      ...wateringReminderContent(input.plantName, input.reason),
      data: {
        plantId: input.plantId,
        plantName: input.plantName,
        fireDate: date.toISOString(),
        kind: WATERING_REMINDER_KIND,
      },
    },
    trigger: { type: "date", date },
  });
  return { ok: true, id, date };
}

export interface ReminderListItem {
  id: string;
  plantName: string;
  dateLabel: string;
}

/** Scheduled-notification requests → Profile list rows. Non-reminder
 * notifications (no plantId/fireDate payload) are filtered out. */
export function mapScheduledReminders(requests: ScheduledReminderRequest[]): ReminderListItem[] {
  return requests
    .flatMap((req) => {
      const data = req.content.data ?? {};
      const plantName = data.plantName;
      const fireDate = data.fireDate;
      if (typeof plantName !== "string" || typeof fireDate !== "string") return [];
      return [{ id: req.identifier, plantName, fireDate, dateLabel: formatReminderDate(new Date(fireDate)) }];
    })
    .sort((a, b) => (a.fireDate < b.fireDate ? -1 : a.fireDate > b.fireDate ? 1 : 0))
    .map(({ id, plantName, dateLabel }) => ({ id, plantName, dateLabel }));
}
