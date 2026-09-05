import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "@/components/ThemeToggle";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ThemeToggle", () => {
  it("has one tab stop at the saved preference and lets Tab leave the group", async () => {
    localStorage.setItem("theme", "dark");
    const user = userEvent.setup();
    render(
      <>
        <ThemeToggle />
        <button type="button">After theme controls</button>
      </>,
    );

    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeVisible();
    const dark = screen.getByRole("radio", { name: "Dark" });
    expect(dark).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("tabindex", "-1");
    expect(dark).toHaveAttribute("tabindex", "0");

    await user.tab();
    expect(dark).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "After theme controls" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(dark).toHaveFocus();
  });

  it("moves focus and selection with arrows, wraps, and supports Home and End", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.tab();
    expect(screen.getByRole("radio", { name: "System" })).toHaveFocus();

    const moves = [
      ["{ArrowRight}", "Dark"],
      ["{ArrowRight}", "Light"],
      ["{ArrowLeft}", "Dark"],
      ["{ArrowDown}", "Light"],
      ["{ArrowUp}", "Dark"],
      ["{Home}", "Light"],
      ["{End}", "Dark"],
      ["{ArrowLeft}", "System"],
    ];
    for (const [key, label] of moves) {
      await user.keyboard(key);
      const selected = screen.getByRole("radio", { name: label });
      expect(selected).toHaveFocus();
      expect(selected).toBeChecked();
      expect(selected).toHaveAttribute("tabindex", "0");
      expect(screen.getAllByRole("radio", { checked: true })).toHaveLength(1);
      expect(localStorage.getItem("theme")).toBe(label.toLowerCase());
    }
  });

  it("persists pointer selection across remounts and applies the system theme", async () => {
    const user = userEvent.setup();
    const view = render(<ThemeToggle />);

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
    view.unmount();
    render(<ThemeToggle />);
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(localStorage.getItem("theme")).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");
    await user.click(screen.getByRole("radio", { name: "System" }));
    expect(localStorage.getItem("theme")).toBe("system");
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    expect(document.documentElement).toHaveClass("dark");
  });
});
