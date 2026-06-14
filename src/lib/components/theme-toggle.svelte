<script lang="ts">
  import { applyThemeMode, type ThemeMode } from "../theme";

  type Props = {
    /** Current persisted mode (from SSR cookie). Two-way bindable. */
    mode?: ThemeMode;
    /** Render the compact, label-less variant (e.g. in the nav). */
    compact?: boolean;
    /** Accessible label for the control group. */
    label?: string;
  };

  let {
    mode = $bindable("system"),
    compact = false,
    label = "Theme",
  }: Props = $props();

  const options: { value: ThemeMode; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ];

  function select(next: ThemeMode) {
    mode = next;
    applyThemeMode(next);
  }
</script>

<fieldset class="theme-toggle" class:compact>
  <legend class:sr-only={compact}>{label}</legend>
  <div class="options">
    {#each options as option (option.value)}
      <label class="option">
        <input
          type="radio"
          name="theme-mode"
          value={option.value}
          checked={mode === option.value}
          onchange={() => select(option.value)}
        />
        <span>{option.label}</span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  .theme-toggle {
    border: none;
    margin: 0;
    padding: 0;
    min-inline-size: 0;
  }

  legend {
    padding: 0;
    margin-block-end: var(--size-2);
    font-size: var(--font-size-0);
    font-weight: var(--font-weight-7);
    color: var(--color-text-muted);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .options {
    display: inline-flex;
    gap: var(--size-1);
    padding: var(--size-1);
    border: var(--border-size-1) solid var(--color-text-muted);
    border-radius: var(--radius-3);
    background: var(--color-background);
  }

  .option {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-block-size: 44px;
    padding-inline: var(--size-3);
    border-radius: var(--radius-2);
    font-size: var(--font-size-0);
    font-weight: var(--font-weight-6);
    color: var(--color-text);
    cursor: pointer;
    transition:
      background 150ms ease,
      color 150ms ease;
  }

  .compact .option {
    min-block-size: 40px;
    padding-inline: var(--size-2);
  }

  /* Hide the native control but keep it focusable/operable. */
  .option input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .option:hover {
    color: var(--color-accent);
  }

  .option:has(input:checked) {
    background: var(--color-accent);
    color: var(--color-background);
  }

  .option:has(input:focus-visible) {
    outline: 0.1875rem solid var(--color-accent);
    outline-offset: 0.1875rem;
  }
</style>
