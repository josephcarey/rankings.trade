import { fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";

import ThemeToggle from "./theme-toggle.svelte";

afterEach(() => {
  delete document.documentElement.dataset.theme;
  // eslint-disable-next-line unicorn/no-document-cookie -- test cleanup of the theme cookie
  document.cookie = "theme=; Path=/; Max-Age=0";
});

describe("theme-toggle", () => {
  it("renders the three modes with the current one checked", () => {
    const { getByRole } = render(ThemeToggle, { mode: "dark" });
    expect((getByRole("radio", { name: "Light" }) as HTMLInputElement).checked).toBe(
      false,
    );
    expect((getByRole("radio", { name: "Dark" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      (getByRole("radio", { name: "System" }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("applies the chosen mode to <html> and persists it to the cookie", async () => {
    const { getByRole } = render(ThemeToggle, { mode: "system" });

    await fireEvent.click(getByRole("radio", { name: "Dark" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.cookie).toContain("theme=dark");
  });

  it("exposes an accessible group label", () => {
    const { getByRole } = render(ThemeToggle, { mode: "system", label: "Theme" });
    expect(getByRole("group", { name: "Theme" })).toBeInTheDocument();
  });
});
