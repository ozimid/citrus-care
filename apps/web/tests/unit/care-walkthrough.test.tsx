import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CareWalkthrough } from "@/components/landing/CareWalkthrough";

describe("CareWalkthrough", () => {
  it("opens with a clearly labeled sample journey and one tabbable tab", () => {
    render(<CareWalkthrough />);

    expect(screen.getByText("Example plant care journey")).toBeVisible();
    expect(screen.getByText("Sample data, not a live analysis.")).toBeVisible();
    expect(screen.getByText("Meyer lemon")).toBeVisible();
    expect(screen.getByText(/sample plant/i)).toBeVisible();
    expect(screen.getByRole("tablist", { name: "Explore the care loop" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Photo" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Photo" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Insights" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tab", { name: "Progress" })).toHaveAttribute("tabindex", "-1");
    expect(within(screen.getByRole("tabpanel", { name: "Photo" })).getByRole("heading", { name: "Start with a photo" })).toBeVisible();
  });

  it("switches panels on click and labels insights and scores as samples", async () => {
    const user = userEvent.setup();
    render(<CareWalkthrough />);

    await user.click(screen.getByRole("tab", { name: "Insights" }));
    const insights = screen.getByRole("tabpanel", { name: "Insights" });
    expect(within(insights).getByRole("heading", { name: "Understand the likely causes" })).toBeVisible();
    expect(within(insights).getByText(/sample insight/i)).toBeVisible();
    expect(within(insights).getByText(/yellowing has several possible causes/i)).toBeVisible();
    expect(within(insights).getByText(/check soil moisture first/i)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Start with a photo" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Progress" }));
    const progress = screen.getByRole("tabpanel", { name: "Progress" });
    expect(within(progress).getByRole("heading", { name: "See what changes over time" })).toBeVisible();
    expect(within(progress).getByText(/sample scores/i)).toHaveTextContent("48 → 62 → 76");
    expect(within(progress).getByText(/actual trends may go up or down/i)).toBeVisible();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("keeps every panel available for intrinsic sizing while only the selected panel is accessible", async () => {
    const user = userEvent.setup();
    render(<CareWalkthrough />);
    const panels = screen.getAllByRole("tabpanel", { hidden: true });

    expect(panels[1]).toHaveTextContent("Understand the likely causes");
    expect(panels[2]).toHaveTextContent("See what changes over time");
    expect(panels[1]).toHaveAttribute("inert");
    expect(panels[1]).toHaveAttribute("aria-hidden", "true");
    expect(panels[1]).toHaveAttribute("tabindex", "-1");
    expect(screen.getAllByRole("tabpanel")).toEqual([panels[0]]);

    await user.click(screen.getByRole("tab", { name: "Insights" }));
    expect(panels[0]).toHaveTextContent("Start with a photo");
    expect(panels[0]).toHaveAttribute("inert");
    expect(panels[1]).not.toHaveAttribute("inert");
    expect(panels[1]).toHaveAttribute("tabindex", "0");
    expect(screen.getAllByRole("tabpanel")).toEqual([panels[1]]);
    await user.tab();
    expect(panels[1]).toHaveFocus();
  });

  it("selects and focuses tabs with arrow keys, including wraparound, Home, and End", async () => {
    const user = userEvent.setup();
    render(<CareWalkthrough />);
    const photo = screen.getByRole("tab", { name: "Photo" });
    const insights = screen.getByRole("tab", { name: "Insights" });
    const progress = screen.getByRole("tab", { name: "Progress" });

    await user.tab();
    expect(photo).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(insights).toHaveFocus();
    expect(insights).toHaveAttribute("aria-selected", "true");
    expect(photo).toHaveAttribute("tabindex", "-1");
    await user.keyboard("{End}");
    expect(progress).toHaveFocus();
    expect(progress).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(photo).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(progress).toHaveFocus();
    await user.keyboard("{Home}");
    expect(photo).toHaveFocus();
    expect(photo).toHaveAttribute("aria-selected", "true");
    await user.tab();
    expect(screen.getByRole("tabpanel", { name: "Photo" })).toHaveFocus();
  });
});
