// Client (jsdom) test setup: registers @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveClass, …) and their TypeScript augmentation of
// vitest's `expect`. Loaded by the "client" vitest project; living under src/
// means the type augmentation is also picked up by svelte-check / tsc.
import "@testing-library/jest-dom/vitest";
