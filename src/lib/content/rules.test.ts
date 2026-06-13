import type { Component } from "svelte";

import { describe, expect, it } from "vitest";

import type { MarkdownModule, MarkdownModules, RuleTopic } from "./rules";

import { buildTopicIndex, findModule, slugFromPath, toTopic } from "./rules";

/** A stand-in compiled component; the helpers never invoke it. */
const noopComponent = (() => {
  /* no-op */
}) as unknown as Component;

const moduleWith = (
  metadata?: Record<string, unknown>,
): MarkdownModule =>
  metadata === undefined
    ? { default: noopComponent }
    : { default: noopComponent, metadata };

describe("slugFromPath", () => {
  it("derives the basename without extension", () => {
    expect(slugFromPath("/src/content/rules/leagues.md")).toBe("leagues");
  });

  it("handles a bare filename", () => {
    expect(slugFromPath("ratings.md")).toBe("ratings");
  });
});

describe("toTopic", () => {
  it("builds serializable metadata from valid frontmatter", () => {
    const topic = toTopic(
      "leagues",
      moduleWith({ order: 2, summary: "How leagues work", title: "Leagues" }),
    );

    expect(topic).toEqual({
      order: 2,
      slug: "leagues",
      summary: "How leagues work",
      title: "Leagues",
    });
  });

  it("defaults a missing order so the topic still lists", () => {
    const topic = toTopic(
      "about",
      moduleWith({ summary: "Overview", title: "About" }),
    );

    expect(topic?.order).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("returns null when the title is missing or empty", () => {
    expect(toTopic("x", moduleWith({ summary: "s" }))).toBeNull();
    expect(toTopic("x", moduleWith({ summary: "s", title: "" }))).toBeNull();
  });

  it("returns null when the summary is missing", () => {
    expect(toTopic("x", moduleWith({ title: "Title" }))).toBeNull();
  });

  it("returns null when metadata is absent", () => {
    expect(toTopic("x", moduleWith())).toBeNull();
  });
});

describe("buildTopicIndex", () => {
  const modules: MarkdownModules = {
    "/src/content/rules/about.md": moduleWith({
      summary: "Overview",
      title: "About",
    }),
    "/src/content/rules/leagues.md": moduleWith({
      order: 2,
      summary: "Leagues",
      title: "Leagues",
    }),
    "/src/content/rules/broken.md": moduleWith({ title: "No summary" }),
    "/src/content/rules/ratings.md": moduleWith({
      order: 1,
      summary: "Ratings",
      title: "Ratings",
    }),
  };

  it("sorts by order then title and omits invalid topics", () => {
    const index: RuleTopic[] = buildTopicIndex(modules);

    expect(index.map((topic) => topic.slug)).toEqual([
      "ratings",
      "leagues",
      "about",
    ]);
  });

  it("returns an empty list for no modules", () => {
    expect(buildTopicIndex({})).toEqual([]);
  });
});

describe("findModule", () => {
  const modules: MarkdownModules = {
    "/src/content/rules/leagues.md": moduleWith({
      summary: "Leagues",
      title: "Leagues",
    }),
  };

  it("returns the module matching a slug", () => {
    expect(findModule(modules, "leagues")).toBe(
      modules["/src/content/rules/leagues.md"],
    );
  });

  it("returns undefined when no topic matches", () => {
    expect(findModule(modules, "missing")).toBeUndefined();
  });
});
