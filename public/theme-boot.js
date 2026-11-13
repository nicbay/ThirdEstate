// Runs before first paint (loaded synchronously in <head>): apply the reader's chosen theme, if any, so a
// reader who picked light or dark against their system setting never sees the other one flash.
try { const t = localStorage.getItem("te-theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch { /* storage blocked: follow the system */ }
