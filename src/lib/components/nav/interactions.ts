/**
 * Svelte action: invoke `handler` when a pointer event lands outside `node`.
 * Used to dismiss open dropdowns and the mobile drawer. Registered in the
 * capture phase so it sees clicks before they're stopped by inner handlers.
 */
export function clickOutside(node: HTMLElement, handler: () => void) {
  const onPointerDown = (event: Event) => {
    if (!node.contains(event.target as Node)) {
      handler();
    }
  };

  document.addEventListener("pointerdown", onPointerDown, true);

  return {
    destroy() {
      document.removeEventListener("pointerdown", onPointerDown, true);
    },
  };
}

/**
 * Keep keyboard focus within `container` while it's open (a minimal focus
 * trap for the mobile drawer). Returns the Tab/Shift+Tab handler to wire to the
 * container's `keydown`.
 */
export function trapFocus(container: HTMLElement, event: KeyboardEvent) {
  if (event.key !== "Tab") return;

  const focusables = [
    ...container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.offsetParent !== null || el === document.activeElement);

  if (focusables.length === 0) return;

  const first = focusables[0];
  const last = focusables.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
