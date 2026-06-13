import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import SeasonBadge from "./season-badge.svelte";
import TitleBadge from "./title-badge.svelte";

describe("title-badge", () => {
  it("maps a known ladder tier to its slug tone class", () => {
    const { container } = render(TitleBadge, { title: "Fleet Admiral" });
    const badge = container.querySelector(".badge");
    expect(badge).toHaveClass("tier-fleet-admiral");
    expect(badge?.textContent?.trim()).toBe("Fleet Admiral");
  });

  it("kebab-cases multi-word tiers consistently", () => {
    const { container } = render(TitleBadge, { title: "Cadet" });
    expect(container.querySelector(".badge")).toHaveClass("tier-cadet");
  });

  it("renders the neutral Unranked tone when there is no title", () => {
    const { container } = render(TitleBadge, { title: null });
    const badge = container.querySelector(".badge");
    expect(badge).toHaveClass("tier-unranked");
    expect(badge?.textContent?.trim()).toBe("Unranked");
  });

  it("shows an unknown title with its label but neutral (off-ladder) tone", () => {
    const { container } = render(TitleBadge, { title: "Warlord" });
    const badge = container.querySelector(".badge");
    expect(badge).toHaveClass("tier-unranked");
    expect(badge?.textContent?.trim()).toBe("Warlord");
  });
});

describe("season-badge closed-vs-open gating", () => {
  it("renders a champion badge with a medal for rank 1 of a closed season", () => {
    const { container } = render(SeasonBadge, { closed: true, rank: 1 });
    const badge = container.querySelector(".badge");
    expect(badge).toHaveClass("place-champion");
    expect(badge?.textContent).toContain("Season Champion");
    expect(container.querySelector("svg.medal")).toBeInTheDocument();
  });

  it("maps the podium placements to their tones", () => {
    expect(
      render(SeasonBadge, { closed: true, rank: 2 }).container.querySelector(
        ".badge",
      ),
    ).toHaveClass("place-runner-up");
    expect(
      render(SeasonBadge, { closed: true, rank: 3 }).container.querySelector(
        ".badge",
      ),
    ).toHaveClass("place-third");
  });

  it("renders nothing for an open (not yet closed) season", () => {
    const { container } = render(SeasonBadge, { closed: false, rank: 1 });
    expect(container.querySelector(".badge")).not.toBeInTheDocument();
  });

  it("renders nothing for a non-podium placement", () => {
    const { container } = render(SeasonBadge, { closed: true, rank: 4 });
    expect(container.querySelector(".badge")).not.toBeInTheDocument();
  });
});
