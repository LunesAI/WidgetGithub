import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  analyzeItem,
  countdownLabel,
  prepareItems,
  renderWidget,
} from "../proximo.js";

const NOW = new Date("2026-10-20T12:00:00-06:00");

const sample = JSON.parse(await readFile(new URL("../data/proximo.json", import.meta.url), "utf8"));

function item(partial) {
  return {
    name: "Actividad",
    start: "2026-10-22",
    type: "reunion",
    url: "https://www.notion.so/ejemplo",
    ...partial,
  };
}

const html = renderWidget(sample, NOW);

assert.match(html, /📆 Próximo/);
assert.match(html, /Datos de ejemplo/);
assert.match(html, /class="countdown">en curso</);
assert.match(html, /Feria de ejemplo \(no es real\)/);
assert.match(html, /hasta el 20 de noviembre/);
assert.match(html, />Octubre</);
assert.match(html, />Noviembre</);
assert.doesNotMatch(html, />Diciembre</);
assert.match(html, /y 2 más…/);
assert.match(html, /🤝/);
assert.match(html, /🎯/);
assert.match(html, />SII</);
assert.match(html, />Taber</);
assert.match(html, /Reunión ficticia de la mañana/);
assert.match(html, /9:30 a\. m\./);
assert.match(html, /4:00 p\. m\./);
assert.match(html, /Actualizado: 20 oct 2026, 3:00 p\. m\./);
assert.equal((html.match(/class="dot"/g) || []).length, 3);
assert.doesNotMatch(html, /Cierre de muestra/);
assert.doesNotMatch(html, /Visita de ejemplo FAHM/);
assert.match(html, /target="_blank"/);
assert.match(html, /rel="noopener noreferrer"/);

const empty = renderWidget({ updatedAt: "2026-10-20T15:00:00-06:00", items: [] }, NOW);
assert.match(empty, /Sin reuniones próximas, buen momento para planificar 📅/);
assert.doesNotMatch(empty, /Datos de ejemplo/);
assert.doesNotMatch(empty, /class="featured"/);

const many = [];
for (let day = 0; day < 8; day += 1) {
  const date = new Date(Date.UTC(2026, 9, 20 + day));
  const iso = date.toISOString().slice(0, 10);
  many.push(
    item({
      name: `Elemento ${day + 1}`,
      start: iso,
      type: day % 2 === 0 ? "reunion" : "evento",
      area: day % 2 === 0 ? undefined : "Bless",
    }),
  );
}
const crowded = renderWidget({ items: many }, NOW);
assert.match(crowded, /Elemento 1/);
assert.match(crowded, /Elemento 6/);
assert.doesNotMatch(crowded, /Elemento 7/);
assert.doesNotMatch(crowded, /Elemento 8/);
assert.match(crowded, /y 2 más…/);

const today = renderWidget(
  { items: [item({ name: "Junta de hoy", start: "2026-10-20T08:00:00-06:00" })] },
  NOW,
);
assert.match(today, /¡Hoy!/);
assert.match(today, /martes 20 de octubre · 8:00 a\. m\./);

const tomorrow = renderWidget(
  { items: [item({ name: "Junta de mañana", start: "2026-10-21" })] },
  NOW,
);
assert.match(tomorrow, /mañana/);
assert.match(tomorrow, /miércoles 21 de octubre/);
assert.doesNotMatch(tomorrow, /faltan 1/);

const inThree = renderWidget(
  { items: [item({ name: "En tres días", start: "2026-10-23T18:00:00-06:00" })] },
  NOW,
);
assert.match(inThree, /faltan 3 días/);

const inEight = analyzeItem(item({ start: "2026-10-28" }), NOW);
assert.equal(inEight.soon, false);
assert.equal(inEight.include, true);

const past = analyzeItem(item({ start: "2026-10-19T09:00:00-06:00" }), NOW);
assert.equal(past.include, false);

const ongoing = analyzeItem(
  item({
    type: "evento",
    start: "2026-08-01",
    end: "2026-10-20",
    area: "SII",
  }),
  NOW,
);
assert.equal(ongoing.include, true);
assert.equal(ongoing.enCurso, true);
assert.equal(countdownLabel(ongoing), "en curso");

const ended = analyzeItem(
  item({ type: "evento", start: "2026-08-01", end: "2026-10-19" }),
  NOW,
);
assert.equal(ended.include, false);

const startsToday = analyzeItem(
  item({ type: "evento", start: "2026-10-20", end: "2026-10-25" }),
  NOW,
);
assert.equal(startsToday.enCurso, false);
assert.equal(countdownLabel(startsToday), "¡Hoy!");

const tooLate = analyzeItem(item({ start: "2026-12-21" }), NOW);
assert.equal(tooLate.include, false);
const edge = analyzeItem(item({ start: "2026-12-20" }), NOW);
assert.equal(edge.include, true);

const meetingRange = analyzeItem(
  item({ type: "reunion", start: "2026-10-01", end: "2026-10-30" }),
  NOW,
);
assert.equal(meetingRange.include, false);

const escaped = renderWidget(
  {
    items: [
      item({
        name: `Tom & <Jerry>`,
        area: undefined,
        url: "javascript:alert(1)",
      }),
    ],
  },
  NOW,
);
assert.match(escaped, /Tom &amp; &lt;Jerry&gt;/);
assert.doesNotMatch(escaped, /<Jerry>/);
assert.doesNotMatch(escaped, /javascript:alert/);

const ordered = prepareItems(
  [
    item({ name: "Tarde", start: "2026-10-22T15:00:00-06:00" }),
    item({ name: "En curso", type: "evento", start: "2026-09-02", end: "2026-11-01" }),
    item({ name: "Día", start: "2026-10-22" }),
  ],
  NOW,
).map((row) => row.item.name);
assert.deepEqual(ordered, ["En curso", "Día", "Tarde"]);

console.log("render.test.mjs: ok");
