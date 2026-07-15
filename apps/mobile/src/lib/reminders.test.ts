import { describe, expect, it } from "vitest";
import {
  REMINDER_INTERVALS,
  cancelReminder,
  formatReminderDate,
  mapScheduledReminders,
  reminderContent,
  reminderDate,
  scheduleReminder,
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
