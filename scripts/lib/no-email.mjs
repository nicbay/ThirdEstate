// Photo credits copied from Wikimedia sometimes contain the photographer's personal email address.
// The site credits the author by name; the address itself is removed.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
export const noEmail = (s) => (typeof s === "string" ? s.replace(EMAIL, "").replace(/\s{2,}/g, " ").trim() : s);
