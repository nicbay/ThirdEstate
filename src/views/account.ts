// /compte — the reader's civic profile, as a short quest: seven things to do on the site, each worth points,
// five ranks from the balcony to the Assembly. Creating an account is the last step: it keeps the progress on every
// device. Signed in, the same page is the reader's own space (their town, MP, candidate, quiz) and holds the
// account settings: political-data consent, export, sign-out, deletion.
import "../styles/account.css";
import { L } from "../i18n";
import { cloudEnabled, getHome, listScenarios, signOut } from "../lib/cloud";
import { foxSvg } from "../lib/fox";
import { pixelIcon, type PixelIcon } from "../lib/pixel-icons";
import {
  deleteAccount, exportAccount, getHousehold, getMyCandidate, getMyMp, getQuizResult, onProfile, politicalConsent,
  sendSignupLink, setPoliticalConsent, signedInUser, syncState,
} from "../lib/profile";
import { toast } from "../lib/toast";
import { esc } from "../util";

interface Quest { id: string; icon: PixelIcon; xp: number; done: boolean; title: [string, string]; done_: [string, string]; todo: [string, string]; href: string }

// Five ranks, named with words that are the same for everyone (no masculine/feminine form to choose), from a first
// visit to the last rank, which borrows the site's name and Sieyès's answer: "What is the Third Estate? Everything."
const RANKS: { min: number; fr: string; en: string; note: [string, string] }[] = [
  { min: 0, fr: "Novice", en: "Newcomer", note: ["Vous faites vos premiers pas dans la vie publique.", "You are taking your first steps in public life."] },
  { min: 20, fr: "Témoin", en: "Witness", note: ["Vous savez qui vous représente là où vous vivez.", "You know who represents you where you live."] },
  { min: 45, fr: "Vigie", en: "Lookout", note: ["Vous comparez les idées, pas seulement les visages.", "You compare ideas, not just faces."] },
  { min: 70, fr: "Pilier", en: "Pillar", note: ["Vous avez fait vos calculs et choisi qui suivre.", "You have run the numbers and chosen whom to follow."] },
  { min: 100, fr: "Tiers état", en: "Third Estate", note: ["« Qu’est-ce que le tiers état ? Tout. » Et tout est gardé sur vos appareils.", "“What is the Third Estate? Everything.” And it is all kept on your devices."] },
];
const SEEN_KEY = "te-quests-seen";

async function quests(): Promise<Quest[]> {
  const home = getHome(), mp = getMyMp(), quiz = getQuizResult(), cand = getMyCandidate();
  const scenarios = await listScenarios().catch(() => []);
  return [
    { id: "town", icon: "home", xp: 15, done: !!home?.code, title: ["Votre commune", "Your town"], done_: [home?.commune ?? "", home?.commune ?? ""], todo: ["Dites où vous habitez : maire, conseil, écoles, sécurité.", "Say where you live: mayor, council, schools, safety."], href: home?.code ? `#/ville/${home.code}` : "#/explorer" },
    { id: "mp", icon: "parliament", xp: 10, done: !!mp, title: ["Votre député", "Your MP"], done_: [mp?.name ?? "", mp?.name ?? ""], todo: ["Découvrez qui vous représente, et comment il ou elle vote.", "Find out who represents you, and how they vote."], href: mp ? `#/depute/${mp.id}` : home?.code ? `#/ville/${home.code}` : "#/assemblee/deputes" },
    { id: "quiz", icon: "ballot", xp: 20, done: !!quiz, title: ["Le quiz", "The quiz"], done_: quiz?.top ? [`Plus proche : ${quiz.top.name}, ${Math.round(100 * quiz.top.score)} %`, `Closest: ${quiz.top.name}, ${Math.round(100 * quiz.top.score)}%`] : ["Fait", "Done"], todo: ["Quel candidat vous ressemble ? Une vingtaine de questions.", "Which candidate is closest to you? About twenty questions."], href: quiz ? `#/quiz/${quiz.code}` : "#/quiz" },
    { id: "cand", icon: "star", xp: 15, done: !!cand, title: ["Un candidat à suivre", "A candidate to follow"], done_: [cand?.name ?? "", cand?.name ?? ""], todo: ["Choisissez qui suivre : ses sondages et son programme en un coup d’œil.", "Pick someone to follow: their polls and program at a glance."], href: cand ? `#/candidat/${cand.slug}` : "#/2027" },
    { id: "sim", icon: "chart", xp: 10, done: scenarios.length > 0, title: ["Votre second tour", "Your runoff"], done_: [`${scenarios.length} scénario${scenarios.length > 1 ? "s" : ""}`, `${scenarios.length} scenario${scenarios.length > 1 ? "s" : ""}`], todo: ["Composez un second tour et enregistrez-le.", "Build a runoff and save it."], href: "#/simulateur" },
    { id: "budget", icon: "coin", xp: 10, done: !!getHousehold(), title: ["Votre budget", "Your budget"], done_: ["Calculé", "Worked out"], todo: ["Ce qu’un programme changerait pour votre foyer.", "What a program would change for your household."], href: "#/programmes/melenchon/simulateur" },
    { id: "account", icon: "shield", xp: 20, done: !!signedInUser(), title: ["Votre compte", "Your account"], done_: [signedInUser()?.email ?? "", signedInUser()?.email ?? ""], todo: ["Gardez tout cela sur tous vos appareils.", "Keep all of this on every device."], href: "#signup" },
  ];
}

const seen = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]")); } catch { return new Set(); } };
const markSeen = (ids: string[]) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(ids)); } catch { /* private mode */ } };

/** Pixel progress: 20 blocks, filled one by one. */
const blocks = (pct: number) => `<span class="ac-blocks" aria-hidden="true">${Array.from({ length: 20 }, (_, i) => `<i class="${i < Math.round(pct / 5) ? "on" : ""}" style="--i:${i}"></i>`).join("")}</span>`;

export async function renderAccount(app: HTMLElement) {
  const qs = await quests();
  const xp = qs.filter((q) => q.done).reduce((n, q) => n + q.xp, 0);
  const rank = [...RANKS].reverse().find((r) => xp >= r.min)!;
  const next = RANKS.find((r) => r.min > xp);
  const old = seen();
  const fresh = qs.filter((q) => q.done && !old.has(q.id)).map((q) => q.id);
  markSeen(qs.filter((q) => q.done).map((q) => q.id));
  const user = signedInUser();
  const nextQuest = qs.find((q) => !q.done && q.id !== "account") ?? qs.find((q) => !q.done);

  app.innerHTML = `
    <section class="page account">
      <div class="page-head">
        <p class="eyebrow">${user ? L("Votre espace", "Your space") : L("Votre profil citoyen", "Your civic profile")}</p>
        <h1>${user ? L("Votre profil citoyen", "Your civic profile") : L("Jusqu’où irez-vous ?", "How far will you go?")}</h1>
        <p class="dek">${L("Sept choses à faire sur Third Estate, de votre commune à votre second tour. Chacune rapporte des points ; le compte garde tout sur vos appareils.", "Seven things to do on Third Estate, from your town to your own runoff. Each one earns points; an account keeps it all on your devices.")}</p>
      </div>

      <section class="card ac-rank" aria-labelledby="ac-rank-h">
        <div class="ac-fox">${foxSvg(72, false)}</div>
        <div class="ac-rank-in">
          <p class="ac-k" id="ac-rank-h">${L("Votre rang", "Your rank")}</p>
          <p class="ac-title">${esc(L(rank.fr, rank.en))}</p>
          <p class="muted">${esc(L(...rank.note))}</p>
          <p class="ac-meter">${blocks(xp)}<b><span data-count="${xp}">${xp}</span>/100</b></p>
          <p class="small muted">${next ? L(`Plus que ${next.min - xp} points avant le rang « ${next.fr} ».`, `${next.min - xp} more points to reach the rank of “${next.en}”.`) : L("Vous avez atteint le rang le plus élevé.", "You have reached the top rank.")}${nextQuest ? ` <a href="${esc(nextQuest.href)}">${L("Prochaine étape : ", "Next step: ")}${esc(L(...nextQuest.title))} →</a>` : ""}</p>
        </div>
      </section>

      <section aria-labelledby="ac-q-h">
        <h2 id="ac-q-h">${L("Les étapes", "The steps")} <small class="muted">${qs.filter((q) => q.done).length}/${qs.length}</small></h2>
        <ol class="ac-quests">${qs.map((q, i) => `<li class="${q.done ? "is-done" : ""}${fresh.includes(q.id) ? " is-new" : ""}" style="--i:${i}">
          <a href="${esc(q.href)}">
            <span class="ac-ic">${pixelIcon(q.icon, 24)}</span>
            <span class="ac-txt"><b>${esc(L(...q.title))}</b><small>${esc(q.done ? (L(...q.done_) || L("Fait", "Done")) : L(...q.todo))}</small></span>
            <span class="ac-xp">${q.done ? `<span class="ac-check" aria-label="${L("fait", "done")}">✓</span>` : ""}+${q.xp}</span>
            ${fresh.includes(q.id) ? `<span class="ac-new">${L("Nouveau", "New")}</span>` : ""}
          </a></li>`).join("")}</ol>
      </section>

      <section class="card ac-signup" id="signup" aria-labelledby="ac-s-h">
        ${user ? signedInHtml() : signupHtml()}
      </section>
    </section>`;

  if (fresh.length && old.size) toast(L(`${fresh.length} étape${fresh.length > 1 ? "s" : ""} franchie${fresh.length > 1 ? "s" : ""} depuis votre dernière visite.`, `${fresh.length} step${fresh.length > 1 ? "s" : ""} completed since your last visit.`), { uniqueID: "ac-fresh" });
  bind(app);
  // a reader who signs in or saves something while here sees it at once (one subscription, dropped on leaving)
  offProfile?.();
  offProfile = onProfile(() => {
    if (!app.querySelector(":scope > .account")) { offProfile?.(); offProfile = null; return; }
    clearTimeout(redraw);
    redraw = window.setTimeout(() => void renderAccount(app), 150);
  });
}
let offProfile: (() => void) | null = null;
let redraw = 0;

function signupHtml() {
  if (!cloudEnabled()) return `<h2 id="ac-s-h">${L("Les comptes arrivent", "Accounts are coming")}</h2><p class="muted">${L("La création de compte n’est pas disponible pour le moment. Votre progression reste gardée dans ce navigateur.", "Accounts are not available right now. Your progress stays in this browser.")}</p>`;
  return `
    <h2 id="ac-s-h">${L("Dernière étape : gardez votre progression", "Last step: keep your progress")} <span class="ac-xp-tag">+20</span></h2>
    <ul class="ac-perks">
      <li>${pixelIcon("globe", 12)} ${L("Retrouvez votre commune, votre député et vos scénarios sur tous vos appareils.", "Find your town, your MP and your scenarios on every device.")}</li>
      <li>${pixelIcon("shield", 12)} ${L("Pas de mot de passe : un lien de connexion par courriel.", "No password: a sign-in link by email.")}</li>
      <li>${pixelIcon("cross", 12)} ${L("Votre adresse n’est jamais transmise à un tiers. Supprimable en un clic.", "Your address is never passed to anyone else. Deleted in one click.")}</li>
    </ul>
    <form class="ac-form" novalidate>
      <label for="ac-email">${L("Votre adresse électronique", "Your email address")}</label>
      <div class="ac-row"><input id="ac-email" type="email" autocomplete="email" required placeholder="${L("vous@exemple.fr", "you@example.com")}" />
        <button type="submit" class="button">${L("Recevoir mon lien", "Send my link")}</button></div>
      <label class="ac-check-row"><input type="checkbox" id="ac-terms" required /> <span>${L("J’accepte que Third Estate garde mon adresse et mon profil (commune, budget, scénarios) pour me les rendre sur mes appareils.", "I agree that Third Estate keeps my address and profile (town, budget, scenarios) to give them back to me on my devices.")} <a href="#/mentions-legales#donnees">${L("Ce que cela couvre", "What this covers")}</a></span></label>
      <label class="ac-check-row"><input type="checkbox" id="ac-political" /> <span>${L("Facultatif : garder aussi le candidat que je suis et mon résultat au quiz. Ce sont des opinions politiques ; sans cette case, ils restent seulement dans ce navigateur. Vous pourrez changer d’avis à tout moment.", "Optional: also keep the candidate I follow and my quiz result. These are political opinions; without this box they stay in this browser only. You can change your mind at any time.")}</span></label>
      <p class="ac-msg small" role="status"></p>
    </form>`;
}

function signedInHtml() {
  const u = signedInUser()!;
  const st = syncState();
  const status = st === "saving" ? L("Enregistrement…", "Saving…") : st === "error" ? L("Échec de l’enregistrement : vos données restent dans ce navigateur, nouvel essai à la prochaine modification.", "Saving failed: your data stays in this browser, and saving is retried on the next change.") : L("Profil enregistré dans votre compte.", "Profile saved to your account.");
  return `
    <h2 id="ac-s-h">${L("Votre compte", "Your account")}</h2>
    <p>${L("Connecté avec", "Signed in as")} <b>${esc(u.email ?? "")}</b>. <span class="muted small">${esc(status)}</span></p>
    <label class="ac-check-row"><input type="checkbox" id="ac-pol-toggle"${politicalConsent() ? " checked" : ""} /> <span>${L("Garder dans mon compte le candidat que je suis et mon résultat au quiz (opinions politiques). Décocher les efface du compte ; ils restent dans ce navigateur.", "Keep the candidate I follow and my quiz result in my account (political opinions). Unticking erases them from the account; they stay in this browser.")}</span></label>
    <div class="ac-actions">
      <button type="button" class="button" data-ac="export">${L("Télécharger mes données", "Download my data")}</button>
      <button type="button" class="qz-btn" data-ac="signout">${L("Se déconnecter", "Sign out")}</button>
      <button type="button" class="qz-btn ac-danger" data-ac="delete">${L("Supprimer mon compte", "Delete my account")}</button>
    </div>`;
}

function bind(app: HTMLElement) {
  const form = app.querySelector<HTMLFormElement>(".ac-form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.querySelector<HTMLInputElement>("#ac-email")!.value.trim();
    const msg = form.querySelector<HTMLElement>(".ac-msg")!;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = L("Cette adresse ne semble pas valide.", "This address doesn’t look valid."); return; }
    if (!form.querySelector<HTMLInputElement>("#ac-terms")!.checked) { msg.textContent = L("Cochez la première case pour créer votre compte.", "Tick the first box to create your account."); return; }
    const btn = form.querySelector<HTMLButtonElement>("button")!;
    btn.disabled = true;
    msg.textContent = L("Envoi…", "Sending…");
    try {
      await sendSignupLink(email, form.querySelector<HTMLInputElement>("#ac-political")!.checked);
      form.outerHTML = `<div class="ac-sent">${foxSvg(48, false)}<div><p><b>${L("Lien envoyé.", "Link sent.")}</b> ${L(`Ouvrez le courriel envoyé à ${esc(email)} et cliquez sur le lien, de préférence sur cet appareil : vos ${"20"} points vous y attendent.`, `Open the email sent to ${esc(email)} and click the link, ideally on this device: your 20 points are waiting.`)}</p><p class="small muted">${L("Rien reçu ? Regardez dans les indésirables, ou réessayez dans une minute.", "Nothing yet? Check your spam folder, or try again in a minute.")}</p></div></div>`;
    } catch (err) {
      btn.disabled = false;
      msg.textContent = /rate|limit|security purposes/i.test(String((err as Error).message)) ? L("Trop de demandes : réessayez dans quelques minutes.", "Too many requests: try again in a few minutes.") : L("L’envoi a échoué. Réessayez dans un instant.", "Sending failed. Try again in a moment.");
    }
  });
  app.querySelector<HTMLInputElement>("#ac-pol-toggle")?.addEventListener("change", (e) => void setPoliticalConsent((e.target as HTMLInputElement).checked));
  app.querySelectorAll<HTMLButtonElement>("[data-ac]").forEach((b) => b.addEventListener("click", async () => {
    const act = b.dataset.ac;
    if (act === "signout") { await signOut(); toast(L("Déconnecté. Vos données restent dans ce navigateur.", "Signed out. Your data stays in this browser.")); }
    if (act === "export") {
      const url = URL.createObjectURL(await exportAccount());
      const a = Object.assign(document.createElement("a"), { href: url, download: "third-estate-mes-donnees.json" });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    if (act === "delete") {
      if (!confirm(L("Supprimer votre compte ? Votre profil et vos scénarios enregistrés seront effacés définitivement. Ce qui est dans ce navigateur reste.", "Delete your account? Your profile and saved scenarios will be erased for good. What is in this browser stays."))) return;
      try { await deleteAccount(); toast(L("Compte supprimé.", "Account deleted.")); }
      catch { toast(L("La suppression a échoué. Écrivez à contact@thirdestate.fr.", "Deletion failed. Write to contact@thirdestate.fr.")); }
    }
  }));
}
