import adapter from "@sveltejs/adapter-cloudflare";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { mdsvex } from "mdsvex";

const config = {
  extensions: [".svelte", ".md"],
  kit: {
    adapter: adapter(),
  },
  preprocess: [vitePreprocess(), mdsvex({ extensions: [".md"] })],
};

export default config;
