// Runs before first paint (loaded synchronously in <head>): light is the default; a reader who picked dark keeps it
// (kept in localStorage), so the other theme never flashes.
try { const t = localStorage.getItem("te-theme"); document.documentElement.dataset.theme = t === "dark" ? "dark" : "light"; } catch { document.documentElement.dataset.theme = "light"; }
