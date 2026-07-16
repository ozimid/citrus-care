import { describe, expect, it } from "vitest";
import {
  REMINDER_INTERVALS,
  WATERING_WINDOW_END_HOUR,
  WATERING_WINDOW_START_HOUR,
  cancelReminder,
  cancelWateringReminders,
  clampToWateringWindow,
  formatReminderDate,
  mapScheduledReminders,
  reminderContent,
  reminderDate,
  scheduleReminder,
  scheduleWateringReminder,
  syncWateringReminder,
  wateringReminderContent,
  wateringReminderDecision,
  type ReminderScheduler,
  type ScheduledReminderRequest,
} from "./reminders";

const NOW = new Date("2026-07-14T10:00:00.000Z");

function makeScheduler(overrides: Partial<ReminderScheduler> = {}) {
  const scheduled: Array<{ content: unknown; trigger: unknown }> = [];
  const cancelled: string[] = [];
  const scheduler: ReminderScheduler = {
    getPermissions: async () => ({ granted: true, canAskAgain: true }),
    requestPermissions: async () => ({ granted: true, canAskAgain: true }),
    schedule: async (req) => {
      scheduled.push(req);
      return "notif-1";
    },
    cancel: async (id) => {
      cancelled.push(id);
    },
    getScheduled: async () => [],
    ...overrides,
  };
  return { scheduler, scheduled, cancelled };
}

describe("reminderDate", () => {
  it("computes 1w / 2w / 1m trigger dates from the assessment moment", () => {
    expect(reminderDate(NOW, "1w").toISOString()).toBe("2026-07-21T10:00:00.000Z");
    expect(reminderDate(NOW, "2w").toISOString()).toBe("2026-07-28T10:00:00.000Z");
    expect(reminderDate(NOW, "1m").toISOString()).toBe("2026-08-13T10:00:00.000Z"); // 30 days
  });

  it("exposes the three supported intervals", () => {
    expect(Object.keys(REMINDER_INTERVALS)).toEqual(["1w", "2w", "1m"]);
    expect(REMINDER_INTERVALS["2w"].days).toBe(14);
  });
});

describe("reminderContent", () => {
  it("names the plant in the design-doc style", () => {
    const content = reminderContent("Meyer Lemon");
    expect(content.title).toBe("Meyer Lemon is due for a check 🍋");
    expect(content.body).toBe("Snap a quick photo to see how it's doing.");
  });
});

describe("formatReminderDate", () => {
  it("renders a short month + day label for the CTA", () => {
    expect(formatReminderDate(new Date("2026-07-28T10:00:00.000Z"))).toBe("Jul 28");
    expect(formatReminderDate(new Date("2026-12-03T10:00:00.000Z"))).toBe("Dec 3");
  });
});

describe("scheduleReminder", () => {
  const INPUT = { plantId: "plant-1", plantName: "Meyer Lemon", interval: "2w" as const, now: NOW };

  it("schedules a date-triggered notification when permission is already granted", async () => {
    const { scheduler, scheduled } = makeScheduler();
    const outcome = await scheduleReminder(scheduler, INPUT);

    expect(outcome).toEqual({ ok: true, id: "notif-1", date: new Date("2026-07-28T10:00:00.000Z") });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toEqual({
      content: {
        title: "Meyer Lemon is due for a check 🍋",
        body: "Snap a quick photo to see how it's doing.",
        data: {
          plantId: "plant-1",
          plantName: "Meyer Lemon",
          fireDate: "2026-07-28T10:00:00.000Z",
        },
      },
      trigger: { type: "date", date: new Date("2026-07-28T10:00:00.000Z") },
    });
  });

  it("asks for permission at tap time (contextual opt-in) and proceeds on grant", async () => {
    let asked = 0;
    const { scheduler, scheduled } = makeScheduler({
      getPermissions: async () => ({ granted: false, canAskAgain: true }),
      requestPermissions: async () => {
        asked += 1;
        return { granted: true, canAskAgain: false };
      },
    });
    const outcome = await scheduleReminder(scheduler, INPUT);
    expect(asked).toBe(1);
    expect(outcome.ok).toBe(true);
    expect(scheduled).toHaveLength(1);
  });

  it("returns permission-denied without scheduling when the user declines", async () => {
    const { scheduler, scheduled } = makeScheduler({
      getPermissions: async () => ({ granted: false, canAskAgain: true }),
      requestPermissions: async () => ({ granted: false, canAskAgain: false }),
    });
    expect(await scheduleReminder(scheduler, INPUT)).toEqual({ ok: false, reason: "permission-denied" });
    expect(scheduled).toHaveLength(0);
  });

  it("does not re-prompt when the OS says it cannot ask again", async () => {
    let asked = 0;
    const { scheduler } = makeScheduler({
      getPermissions: async () => ({ granted: false, canAskAgain: false }),
      requestPermissions: async () => {
        asked += 1;
        return { granted: false, canAskAgain: false };
      },
    });
    expect(await scheduleReminder(scheduler, INPUT)).toEqual({ ok: false, reason: "permission-denied" });
    expect(asked).toBe(0);
  });
});

describe("cancelReminder", () => {
  it("cancels by notification id", async () => {
    const { scheduler, cancelled } = makeScheduler();
    await cancelReminder(scheduler, "notif-7");
    expect(cancelled).toEqual(["notif-7"]);
  });
});

describe("mapScheduledReminders", () => {
  it("maps our reminder requests to list rows sorted by fire date", () => {
    const requests: ScheduledReminderRequest[] = [
      {
        identifier: "b",
        content: { title: "Kaffir Lime is due for a check 🍋", data: { plantId: "p2", plantName: "Kaffir Lime", fireDate: "2026-08-13T10:00:00.000Z" } },
      },
      {
        identifier: "a",
        content: { title: "Meyer Lemon is due for a check 🍋", data: { plantId: "p1", plantName: "Meyer Lemon", fireDate: "2026-07-28T10:00:00.000Z" } },
      },
    ];
    expect(mapScheduledReminders(requests)).toEqual([
      { id: "a", plantName: "Meyer Lemon", dateLabel: "Jul 28" },
      { id: "b", plantName: "Kaffir Lime", dateLabel: "Aug 13" },
    ]);
  });

  it("ignores notifications that are not plant reminders", () => {
    const requests: ScheduledReminderRequest[] = [
      { identifier: "x", content: { title: "Something else", data: {} } },
      { identifier: "y", content: {} },
    ];
    expect(mapScheduledReminders(requests)).toEqual([]);
  });
});

// F20 — watering notifications. Local, like the re-assessment reminders above,
// and scheduled from the deterministic due date the watering math produced.
// Local-time assertions below are built from local Date parts, so they hold in
// any timezone the developer/CI happens to run in.

describe("clampToWateringWindow", () => {
  it("exposes a civilised 9:00-18:00 window", () => {
    expect(WATERING_WINDOW_START_HOUR).toBe(9);
    expect(WATERING_WINDOW_END_HOUR).toBe(18);
  });

  it("leaves a time already inside the window alone", () => {
    const inside = new Date(2026, 6, 20, 13, 30);
    expect(clampToWateringWindow(inside)).toEqual(inside);
  });

  it("pushes an early-morning due time forward to 9am the same day", () => {
    const out = clampToWateringWindow(new Date(2026, 6, 20, 5, 15));
    expect([out.getFullYear(), out.getMonth(), out.getDate()]).toEqual([2026, 6, 20]);
    expect([out.getHours(), out.getMinutes(), out.getSeconds()]).toEqual([9, 0, 0]);
  });

  it("defers an evening due time to 9am the NEXT day — no 11pm buzz", () => {
    const out = clampToWateringWindow(new Date(2026, 6, 20, 22, 40));
    expect([out.getFullYear(), out.getMonth(), out.getDate()]).toEqual([2026, 6, 21]);
    expect(out.getHours()).toBe(9);
  });

  it("rolls a late due time across a month boundary correctly", () => {
    const out = clampToWateringWindow(new Date(2026, 6, 31, 20, 0));
    expect([out.getFullYear(), out.getMonth(), out.getDate()]).toEqual([2026, 7, 1]);
    expect(out.getHours()).toBe(9);
  });

  it("treats 18:00 exactly as outside the window", () => {
    expect(clampToWateringWindow(new Date(2026, 6, 20, 18, 0)).getDate()).toBe(21);
    expect(clampToWateringWindow(new Date(2026, 6, 20, 17, 59)).getDate()).toBe(20);
  });
});

describe("wateringReminderContent", () => {
  it("leads with the plant and carries the reason the math produced", () => {
    const c = wateringReminderContent("Mr Lemon", "Hot week (34°C) — water 3 days sooner");
    expect(c.title).toContain("Mr Lemon");
    expect(c.title.toLowerCase()).toContain("water");
    expect(c.body).toBe("Hot week (34°C) — water 3 days sooner");
  });
});

describe("scheduleWateringReminder", () => {
  const NOW_LOCAL = new Date(2026, 6, 20, 10, 0);
  const INPUT = {
    plantId: "plant-1",
    plantName: "Mr Lemon",
    dueAt: new Date(2026, 6, 27, 11, 0),
    reason: "Every 7 days",
    now: NOW_LOCAL,
  };

  it("schedules at the due date when it already falls inside the window", async () => {
    const { scheduler, scheduled } = makeScheduler();
    const outcome = await scheduleWateringReminder(scheduler, INPUT);

    expect(outcome.ok).toBe(true);
    expect(scheduled).toHaveLength(1);
    const req = scheduled[0] as { content: { data: Record<string, unknown> }; trigger: { date: Date } };
    expect(req.trigger.date).toEqual(new Date(2026, 6, 27, 11, 0));
    expect(req.content.data).toMatchObject({ plantId: "plant-1", kind: "watering" });
  });

  it("moves a due date landing at night into the next morning's window", async () => {
    const { scheduler, scheduled } = makeScheduler();
    await scheduleWateringReminder(scheduler, { ...INPUT, dueAt: new Date(2026, 6, 27, 23, 0) });
    const date = (scheduled[0] as { trigger: { date: Date } }).trigger.date;
    expect([date.getDate(), date.getHours()]).toEqual([28, 9]);
  });

  it("schedules an already-overdue plant into the NEXT window, never in the past", async () => {
    const { scheduler, scheduled } = makeScheduler();
    const outcome = await scheduleWateringReminder(scheduler, {
      ...INPUT,
      dueAt: new Date(2026, 6, 1, 9, 0), // long overdue
    });
    expect(outcome.ok).toBe(true);
    const date = (scheduled[0] as { trigger: { date: Date } }).trigger.date;
    expect(date.getTime()).toBeGreaterThan(NOW_LOCAL.getTime());
  });

  it("replaces the plant's previous watering reminder instead of stacking them", async () => {
    const existing: ScheduledReminderRequest[] = [
      {
        identifier: "old-watering",
        content: { data: { plantId: "plant-1", plantName: "Mr Lemon", fireDate: "x", kind: "watering" } },
      },
      {
        identifier: "other-plant",
        content: { data: { plantId: "plant-2", plantName: "Fig", fireDate: "x", kind: "watering" } },
      },
      {
        identifier: "reassess",
        content: { data: { plantId: "plant-1", plantName: "Mr Lemon", fireDate: "x" } },
      },
    ];
    const { scheduler, scheduled, cancelled } = makeScheduler({ getScheduled: async () => existing });
    await scheduleWateringReminder(scheduler, INPUT);

    // Only this plant's watering reminder is replaced; the re-assessment
    // reminder and other plants' reminders survive.
    expect(cancelled).toEqual(["old-watering"]);
    expect(scheduled).toHaveLength(1);
  });

  it("does not schedule when notification permission is denied", async () => {
    const { scheduler, scheduled } = makeScheduler({
      getPermissions: async () => ({ granted: false, canAskAgain: false }),
    });
    expect(await scheduleWateringReminder(scheduler, INPUT)).toEqual({
      ok: false,
      reason: "permission-denied",
    });
    expect(scheduled).toHaveLength(0);
  });
});

// The card re-computes a plant's plan on every open, and the due date moves
// whenever the weather does. Keeping the scheduled notification in step must
// NEVER be the thing that pops a permission dialog — that only ever happens on
// the user's own "Remind me" tap (design doc open question 2). Hence a separate
// decision this sync path can make without touching the OS.

describe("wateringReminderDecision", () => {
  const NOW_LOCAL = new Date(2026, 6, 20, 10, 0);
  const DUE = new Date(2026, 6, 27, 11, 0);

  it("schedules at the clamped due date when permission is already granted", () => {
    expect(
      wateringReminderDecision({
        dueAt: DUE,
        now: NOW_LOCAL,
        permissionGranted: true,
        scheduledFor: null,
      }),
    ).toEqual({ action: "schedule", date: DUE });
  });

  it("stays silent when permission was never granted — the sync path must not prompt", () => {
    expect(
      wateringReminderDecision({
        dueAt: DUE,
        now: NOW_LOCAL,
        permissionGranted: false,
        scheduledFor: null,
      }),
    ).toEqual({ action: "skip", reason: "no-permission" });
  });

  it("leaves an identical existing reminder alone instead of re-scheduling it", () => {
    expect(
      wateringReminderDecision({
        dueAt: DUE,
        now: NOW_LOCAL,
        permissionGranted: true,
        scheduledFor: DUE.toISOString(),
      }),
    ).toEqual({ action: "skip", reason: "already-scheduled" });
  });

  it("re-schedules when the due date moved (weather changed, or the plant was watered)", () => {
    const decision = wateringReminderDecision({
      dueAt: new Date(2026, 6, 25, 11, 0),
      now: NOW_LOCAL,
      permissionGranted: true,
      scheduledFor: DUE.toISOString(),
    });
    expect(decision).toEqual({ action: "schedule", date: new Date(2026, 6, 25, 11, 0) });
  });

  it("clamps an out-of-hours due date into the window before comparing", () => {
    const decision = wateringReminderDecision({
      dueAt: new Date(2026, 6, 27, 23, 0),
      now: NOW_LOCAL,
      permissionGranted: true,
      scheduledFor: null,
    });
    expect(decision).toEqual({ action: "schedule", date: new Date(2026, 6, 28, 9, 0) });
  });

  it("pulls an overdue plant into the next window rather than firing in the past", () => {
    const decision = wateringReminderDecision({
      dueAt: new Date(2026, 6, 1, 9, 0),
      now: NOW_LOCAL,
      permissionGranted: true,
      scheduledFor: null,
    });
    expect(decision).toEqual({ action: "schedule", date: new Date(2026, 6, 20, 10, 1) });
  });
});

describe("syncWateringReminder", () => {
  const NOW_LOCAL = new Date(2026, 6, 20, 10, 0);
  const INPUT = {
    plantId: "plant-1",
    plantName: "Mr Lemon",
    dueAt: new Date(2026, 6, 27, 11, 0),
    reason: "Every 7 days",
    now: NOW_LOCAL,
  };

  it("never asks for permission — it only acts on one already granted", async () => {
    let asked = 0;
    const { scheduler, scheduled } = makeScheduler({
      getPermissions: async () => ({ granted: false, canAskAgain: true }),
      requestPermissions: async () => {
        asked += 1;
        return { granted: true, canAskAgain: false };
      },
    });
    expect(await syncWateringReminder(scheduler, INPUT)).toEqual({
      ok: false,
      reason: "permission-denied",
    });
    expect(asked).toBe(0);
    expect(scheduled).toHaveLength(0);
  });

  it("replaces the plant's stale watering reminder when the due date moved", async () => {
    const existing: ScheduledReminderRequest[] = [
      {
        identifier: "stale",
        content: {
          data: { plantId: "plant-1", plantName: "Mr Lemon", fireDate: new Date(2026, 6, 22, 9, 0).toISOString(), kind: "watering" },
        },
      },
    ];
    const { scheduler, scheduled, cancelled } = makeScheduler({ getScheduled: async () => existing });
    const outcome = await syncWateringReminder(scheduler, INPUT);
    expect(outcome.ok).toBe(true);
    expect(cancelled).toEqual(["stale"]);
    expect(scheduled).toHaveLength(1);
  });

  it("does nothing when the plant's reminder already matches the plan", async () => {
    const existing: ScheduledReminderRequest[] = [
      {
        identifier: "current",
        content: {
          data: { plantId: "plant-1", plantName: "Mr Lemon", fireDate: new Date(2026, 6, 27, 11, 0).toISOString(), kind: "watering" },
        },
      },
    ];
    const { scheduler, scheduled, cancelled } = makeScheduler({ getScheduled: async () => existing });
    await syncWateringReminder(scheduler, INPUT);
    expect(scheduled).toHaveLength(0);
    expect(cancelled).toEqual([]);
  });
});

describe("cancelWateringReminders", () => {
  it("drops only this plant's watering reminders — tapping 'Watered today' must not silence the rest", async () => {
    const existing: ScheduledReminderRequest[] = [
      { identifier: "w1", content: { data: { plantId: "plant-1", kind: "watering" } } },
      { identifier: "w2", content: { data: { plantId: "plant-2", kind: "watering" } } },
      { identifier: "reassess", content: { data: { plantId: "plant-1", plantName: "Mr Lemon", fireDate: "x" } } },
    ];
    const { scheduler, cancelled } = makeScheduler({ getScheduled: async () => existing });
    expect(await cancelWateringReminders(scheduler, "plant-1")).toEqual(["w1"]);
    expect(cancelled).toEqual(["w1"]);
  });

  it("swallows a lookup failure — cancelling is best-effort, never a user-visible error", async () => {
    const { scheduler } = makeScheduler({
      getScheduled: async () => {
        throw new Error("OS said no");
      },
    });
    expect(await cancelWateringReminders(scheduler, "plant-1")).toEqual([]);
  });
});
