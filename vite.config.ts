import { defineConfig } from "vite";

// NEXT_PUBLIC_* is what Vercel's Supabase integration sets; VITE_* is what you'd set by hand.
// Both carry only public values (the Supabase URL and anon key).
export default defineConfig({
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
});
