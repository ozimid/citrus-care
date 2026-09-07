import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TutorialVideo } from "@/components/landing/TutorialVideo";

const videoPath = "/media/citrus-care-tutorial-v1.mp4";

afterEach(() => vi.restoreAllMocks());

describe("TutorialVideo", () => {
  it("shows the poster and download fallback without exposing a video source before Play", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<TutorialVideo />);
    const video = screen.getByLabelText("Citrus Care app tutorial");

    expect(screen.getByRole("heading", { name: "Watch how to use Citrus Care" })).toBeVisible();
    expect(video).toHaveAttribute("poster", "/media/citrus-care-tutorial-v1.webp");
    expect(video).toHaveAttribute("preload", "none");
    expect(video).not.toHaveAttribute("src");
    expect(video.querySelector("source")).toBeNull();
    expect(video.querySelector("track")).toBeNull();
    expect(video).not.toHaveAttribute("autoplay");
    expect(video).not.toHaveAttribute("controls");
    expect(screen.getByRole("button", { name: "Play tutorial" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Download video" })).toHaveAttribute("href", videoPath);
    expect(play).not.toHaveBeenCalled();
  });

  it("assigns the source and native controls before playing inside the click handler", async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      expect(this).toHaveAttribute("src", videoPath);
      expect(this).toHaveAttribute("controls");
      return Promise.resolve();
    });
    render(<TutorialVideo />);

    await user.click(screen.getByRole("button", { name: "Play tutorial" }));

    expect(play).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Citrus Care app tutorial")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Play tutorial" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("supports keyboard activation and transfers focus to the native player", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<TutorialVideo />);

    await user.tab();
    expect(screen.getByRole("button", { name: "Play tutorial" })).toHaveFocus();
    await user.keyboard("{Enter}");

    const video = screen.getByLabelText("Citrus Care app tutorial");
    expect(video).toHaveFocus();
    expect(video).toHaveAttribute("tabindex", "0");
    expect(video).not.toHaveAttribute("autoplay");
  });

  it("loads the English on-screen steps only when the user starts the video", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<TutorialVideo />);
    const video = screen.getByLabelText("Citrus Care app tutorial");
    expect(video.querySelector("track")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Play tutorial" }));

    const subtitles = video.querySelector("track");
    expect(subtitles).toHaveAttribute("kind", "subtitles");
    expect(subtitles).toHaveAttribute("src", "/media/citrus-care-tutorial-v1.vtt");
    expect(subtitles).toHaveAttribute("srclang", "en");
    expect(subtitles).toHaveAttribute("label", "English — on-screen steps");
    expect(subtitles).toHaveAttribute("default");
  });

  it.each(["rejection", "throw"])("handles a playback %s with an honest status and download fallback", async (failure) => {
    const user = userEvent.setup();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => {
      const error = new Error("Internal decoder detail");
      if (failure === "throw") throw error;
      return Promise.reject(error);
    });
    render(<TutorialVideo />);

    await user.click(screen.getByRole("button", { name: "Play tutorial" }));

    expect(screen.getByRole("status")).toHaveTextContent(/couldn.t start the video/i);
    expect(screen.getByRole("status")).not.toHaveTextContent("Internal decoder detail");
    expect(screen.getByRole("link", { name: "Download video" })).toHaveAttribute("href", videoPath);
    expect(screen.getByLabelText("Citrus Care app tutorial")).toHaveAttribute("controls");
  });

  it("reports a later media error and keeps the download link available", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<TutorialVideo />);
    await user.click(screen.getByRole("button", { name: "Play tutorial" }));

    fireEvent.error(screen.getByLabelText("Citrus Care app tutorial"));

    expect(screen.getByRole("status")).toHaveTextContent(/couldn.t load the video/i);
    expect(screen.getByRole("link", { name: "Download video" })).toBeVisible();
  });

  it("server-renders a disabled Play button and usable download fallback without JavaScript", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<TutorialVideo />);
    const server = within(container);

    expect(server.getByRole("button", { name: "Play tutorial" })).toBeDisabled();
    expect(server.getByRole("link", { name: "Download video" })).toHaveAttribute("href", videoPath);
    expect(server.getByLabelText("Citrus Care app tutorial")).not.toHaveAttribute("src");
    expect(container.querySelector("noscript")).toHaveTextContent(/download video/i);
  });
});
