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
  // An overdue plant must still fire in the future: never the past due date,
  // and always inside the window.
  const date = wateringReminderFireDate(input.dueAt, now);

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

export interface WateringDecisionInput {
  /** Due date from wateringPlan().nextWaterDueAt. */
  dueAt: Date;
  now: Date;
  /** Whether notification permission is ALREADY granted. Never "can we ask". */
  permissionGranted: boolean;
  /** ISO fireDate of this plant's existing watering reminder, if any. */
  scheduledFor: string | null;
}

export type WateringReminderDecision =
  | { action: "schedule"; date: Date }
  | { action: "skip"; reason: "no-permission" | "already-scheduled" };

/** The fire time a plan implies: never in the past, always inside the window. */
export function wateringReminderFireDate(dueAt: Date, now: Date): Date {
  const from = dueAt.getTime() > now.getTime() ? dueAt : new Date(now.getTime() + 60_000);
  return clampToWateringWindow(from);
}

/**
 * Should the background sync touch this plant's watering notification? Pure, so
 * the two rules that matter are testable without an OS:
 *
 * 1. No permission → do nothing. The sync path runs on every card render, and
 *    prompting there would break the contextual-opt-in rule (permission is only
 *    ever requested on the user's own "Remind me" tap).
 * 2. Already scheduled for the same moment → do nothing, rather than cancel and
 *    re-create an identical notification on every render.
 */
export function wateringReminderDecision(input: WateringDecisionInput): WateringReminderDecision {
  if (!input.permissionGranted) return { action: "skip", reason: "no-permission" };
  const date = wateringReminderFireDate(input.dueAt, input.now);
  if (input.scheduledFor !== null && new Date(input.scheduledFor).getTime() === date.getTime()) {
    return { action: "skip", reason: "already-scheduled" };
  }
  return { action: "schedule", date };
}

/** This plant's currently scheduled watering reminders (identifier + fireDate). */
async function existingWateringReminders(
  scheduler: ReminderScheduler,
  plantId: string,
): Promise<Array<{ identifier: string; fireDate: string | null }>> {
  // Best-effort everywhere: a lookup failure must never surface to the user.
  try {
    const all = await scheduler.getScheduled();
    return all.filter((req) => isWateringReminderFor(req, plantId)).map((req) => ({
      identifier: req.identifier,
      fireDate: typeof req.content.data?.fireDate === "string" ? req.content.data.fireDate : null,
    }));
  } catch (e) {
    console.error("[existingWateringReminders] lookup failed:", (e as Error).message);
    return [];
  }
}

/**
 * Keep a plant's watering notification in step with its current plan WITHOUT
 * ever prompting — the counterpart to scheduleWateringReminder (which is the
 * user's explicit tap and may prompt). Safe to call on every card render.
 */
export async function syncWateringReminder(
  scheduler: ReminderScheduler,
  input: ScheduleWateringInput,
): Promise<ScheduleOutcome> {
  const permission = await scheduler.getPermissions();
  if (!permission.granted) return { ok: false, reason: "permission-denied" };

  const now = input.now ?? new Date();
  const existing = await existingWateringReminders(scheduler, input.plantId);
  const decision = wateringReminderDecision({
    dueAt: input.dueAt,
    now,
    permissionGranted: true,
    scheduledFor: existing[0]?.fireDate ?? null,
  });
  if (decision.action === "skip") {
    // Permission is granted by the check above, so the only skip left is
    // "already-scheduled" — a success: the reminder the plan wants is in place.
    return { ok: true, id: existing[0].identifier, date: wateringReminderFireDate(input.dueAt, now) };
  }

  for (const req of existing) await scheduler.cancel(req.identifier);
  const id = await scheduler.schedule({
    content: {
      ...wateringReminderContent(input.plantName, input.reason),
      data: {
        plantId: input.plantId,
        plantName: input.plantName,
        fireDate: decision.date.toISOString(),
        kind: WATERING_REMINDER_KIND,
      },
    },
    trigger: { type: "date", date: decision.date },
  });
  return { ok: true, id, date: decision.date };
}

/** Drop this plant's watering reminders — the "Watered today" tap, which makes
 * any pending nudge stale. Best-effort and silent: cancelling a notification is
 * never worth an error in front of the user. Returns the ids it cancelled. */
export async function cancelWateringReminders(
  scheduler: ReminderScheduler,
  plantId: string,
): Promise<string[]> {
  const existing = await existingWateringReminders(scheduler, plantId);
  const cancelled: string[] = [];
  for (const req of existing) {
    try {
      await scheduler.cancel(req.identifier);
      cancelled.push(req.identifier);
    } catch (e) {
      console.error("[cancelWateringReminders] cancel failed:", (e as Error).message);
    }
  }
  return cancelled;
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
