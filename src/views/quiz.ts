// "Qui vous ressemble ?": the quiz behind the masthead's call to action (#/quiz).
// Placeholder until the quiz itself lands: it says so plainly and points to what already exists.
import { L } from "../i18n";

export function renderQuiz(app: HTMLElement) {
  app.innerHTML = `
    <section class="page">
      <header class="page-head">
        <p class="eyebrow">${L("2027 · Le quiz", "2027 · The quiz")}</p>
        <h1>${L("Qui vous ressemble, parmi les candidats et les députés ?", "Who is most like you, among the candidates and MPs?")}</h1>
        <p class="dek">${L("Une vingtaine de questions tirées des vrais votes de l’Assemblée, et vous saurez de quels élus vous êtes le plus proche. Le quiz est en préparation.", "About twenty questions drawn from real Assembly votes, and you will see which officials you are closest to. The quiz is being built.")}</p>
      </header>
      <section class="card">
        <header class="card-head"><h2>${L("En attendant", "Meanwhile")}</h2></header>
        <nav class="subnav"><a href="#/simulateur">${L("Simuler le second tour", "Simulate the runoff")}</a><a href="#/assemblee/loyaute">${L("Qui vote avec son groupe", "Who votes with their group")}</a><a href="#/assemblee/themes">${L("Ce que disent les députés", "What MPs say")}</a><a href="#/2027">${L("Où en est la course", "Where the race stands")}</a></nav>
      </section>
    </section>`;
}
