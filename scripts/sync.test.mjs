import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DEFAULT_PROYECTOS_ID,
  DEFAULT_REUNIONES_ID,
  buildProyectosFilter,
  buildReunionesFilter,
  collectItems,
  main,
  nextPayload,
  normalizeNotionId,
  pageToItem,
  pickId,
  planWrite,
  resolveProperties,
} from "./sync-notion.mjs";

const NOW = new Date("2026-10-20T12:00:00-06:00");

const reunionesSchema = {
  Nombre: { name: "Nombre", type: "title", title: {} },
  "Fecha de inicio": { name: "Fecha de inicio", type: "date", date: {} },
  Realizada: { name: "Realizada", type: "checkbox", checkbox: {} },
  Lugar: { name: "Lugar", type: "rich_text", rich_text: {} },
  Ministerio: { name: "Ministerio", type: "select", select: {} },
  Notas: { name: "Notas", type: "rich_text", rich_text: {} },
};

const proyectosSchema = {
  Nombre: { name: "Nombre", type: "title", title: {} },
  Plazo: { name: "Plazo", type: "date", date: {} },
  Inicio: { name: "Inicio", type: "date", date: {} },
  Estado: { name: "Estado", type: "status", status: {} },
  Área: { name: "Área", type: "select", select: {} },
  Notas: { name: "Notas", type: "rich_text", rich_text: {} },
};

const reunionesProps = resolveProperties(reunionesSchema, {
  title: "Nombre",
  date: "Fecha de inicio",
  checkbox: "Realizada",
});
assert.equal(reunionesProps.date.name, "Fecha de inicio");
assert.equal(reunionesProps.checkbox.name, "Realizada");

const fallback = resolveProperties(
  {
    Tema: { name: "Tema", type: "title", title: {} },
    Cuando: { name: "Cuando", type: "date", date: {} },
  },
  { title: "Nombre", date: "Fecha de inicio", checkbox: "Realizada" },
);
assert.equal(fallback.title.name, "Tema");
assert.equal(fallback.date.name, "Cuando");
assert.equal(fallback.checkbox, null);

const proyectosProps = resolveProperties(proyectosSchema, {
  title: "Nombre",
  date: "Plazo",
  status: "Estado",
  area: "Área",
});
assert.equal(proyectosProps.date.name, "Plazo");
assert.equal(proyectosProps.area.name, "Área");

function page(properties, url = "https://www.notion.so/abc123") {
  return { object: "page", url, properties, archived: false, in_trash: false };
}

const leaked = pageToItem(
  page({
    Nombre: { type: "title", title: [{ plain_text: "Junta privada" }] },
    "Fecha de inicio": {
      type: "date",
      date: { start: "2026-10-22T09:00:00-06:00", end: null },
    },
    Realizada: { type: "checkbox", checkbox: false },
    Lugar: { type: "rich_text", rich_text: [{ plain_text: "Oficina secreta" }] },
    Ministerio: { type: "select", select: { name: "Educación" } },
    Notas: { type: "rich_text", rich_text: [{ plain_text: "nota confidencial" }] },
  }),
  reunionesProps,
  "reunion",
);
assert.deepEqual(Object.keys(leaked), ["name", "start", "type", "url"]);
assert.equal(JSON.stringify(leaked).includes("Oficina secreta"), false);
assert.equal(JSON.stringify(leaked).includes("nota confidencial"), false);
assert.equal(JSON.stringify(leaked).includes("Educación"), false);
assert.equal(leaked.type, "reunion");

assert.equal(
  pageToItem(
    page({
      Nombre: { type: "title", title: [{ plain_text: "Ya hecha" }] },
      "Fecha de inicio": { type: "date", date: { start: "2026-10-22" } },
      Realizada: { type: "checkbox", checkbox: true },
    }),
    reunionesProps,
    "reunion",
  ),
  null,
);

assert.equal(
  pageToItem(
    page({
      Nombre: { type: "title", title: [{ plain_text: "Sin fecha" }] },
      Plazo: { type: "date", date: null },
      Estado: { type: "status", status: { name: "En proceso" } },
    }),
    proyectosProps,
    "evento",
  ),
  null,
);

const ongoing = pageToItem(
  page({
    Nombre: { type: "title", title: [{ plain_text: "Feria viva" }] },
    Plazo: { type: "date", date: { start: "2026-09-01", end: "2026-11-20" } },
    Estado: { type: "status", status: { name: "En proceso" } },
    Área: { type: "select", select: { name: "SII" } },
    Notas: { type: "rich_text", rich_text: [{ plain_text: "no publicar" }] },
  }),
  proyectosProps,
  "evento",
);
assert.equal(ongoing.area, "SII");
assert.equal(ongoing.end, "2026-11-20");
assert.equal(JSON.stringify(ongoing).includes("no publicar"), false);

assert.equal(
  pageToItem(
    page({
      Nombre: { type: "title", title: [{ plain_text: "Cerrada" }] },
      Plazo: { type: "date", date: { start: "2026-10-25" } },
      Estado: { type: "status", status: { name: "Finalizadas" } },
    }),
    proyectosProps,
    "evento",
  ),
  null,
);

assert.equal(
  pageToItem(
    page({
      Nombre: { type: "title", title: [{ plain_text: "Cerrada" }] },
      Plazo: { type: "date", date: { start: "2026-10-25" } },
      Estado: { type: "status", status: { name: "finalizadas" } },
    }),
    proyectosProps,
    "evento",
  ),
  null,
);

const reunionesFilter = buildReunionesFilter(reunionesProps, NOW);
assert.equal(reunionesFilter.and[0].property, "Fecha de inicio");
assert.equal(reunionesFilter.and[0].date.on_or_after, "2026-10-19");
assert.equal(reunionesFilter.and[1].date.on_or_before, "2026-12-21");
assert.deepEqual(reunionesFilter.and[2].checkbox, { does_not_equal: true });

const proyectosFilter = buildProyectosFilter(proyectosProps, NOW);
assert.equal(proyectosFilter.and[0].property, "Plazo");
assert.equal(proyectosFilter.and[1].date.on_or_before, "2026-12-21");
assert.deepEqual(proyectosFilter.and[2].status, { does_not_equal: "Finalizadas" });

const selectStatus = resolveProperties(
  {
    Nombre: { name: "Nombre", type: "title" },
    Plazo: { name: "Plazo", type: "date" },
    Estado: { name: "Estado", type: "select" },
  },
  { title: "Nombre", date: "Plazo", status: "Estado", area: "Área" },
);
assert.equal(buildProyectosFilter(selectStatus, NOW).and[2].select.does_not_equal, "Finalizadas");

assert.equal(normalizeNotionId(DEFAULT_REUNIONES_ID), "8724ac27-a5eb-4b5c-9a1a-0b1053caf0b1");
assert.equal(normalizeNotionId(DEFAULT_PROYECTOS_ID), "c61397ba-a7a9-827c-bcf0-815ef33f7e7f");
assert.equal(pickId("", "", DEFAULT_PROYECTOS_ID), DEFAULT_PROYECTOS_ID);
assert.equal(pickId(" variable ", "", DEFAULT_PROYECTOS_ID), "variable");
assert.equal(pickId("", "secreto", DEFAULT_PROYECTOS_ID), "secreto");

const payload = nextPayload([leaked, ongoing], NOW);
assert.equal(payload.example, undefined);
assert.equal(payload.updatedAt, "2026-10-20T12:00:00-06:00");
assert.equal(planWrite(JSON.stringify(payload), payload), null);
assert.match(planWrite(JSON.stringify({ ...payload, example: true }), payload), /"items"/);
assert.match(planWrite("{no json", payload), /Junta privada/);
assert.match(planWrite(null, payload), /Feria viva/);

const reunionesId = "8724ac27-a5eb-4b5c-9a1a-0b1053caf0b1";
const proyectosId = "c61397ba-a7a9-827c-bcf0-815ef33f7e7f";
const dataSourceId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const requests = [];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchImpl = async (url, options = {}) => {
  const parsed = new URL(url);
  requests.push({
    path: parsed.pathname,
    method: options.method || "GET",
    body: options.body ? JSON.parse(options.body) : null,
    authorization: options.headers.Authorization,
  });
  if (parsed.pathname === `/v1/data_sources/${reunionesId}`) {
    return jsonResponse({ object: "error", message: "no es data source" }, 404);
  }
  if (parsed.pathname === `/v1/databases/${reunionesId}`) {
    return jsonResponse({
      object: "database",
      data_sources: [{ id: dataSourceId, name: "Reuniones" }],
    });
  }
  if (parsed.pathname === `/v1/data_sources/${dataSourceId}`) {
    return jsonResponse({ object: "data_source", id: dataSourceId, properties: reunionesSchema });
  }
  if (parsed.pathname === `/v1/data_sources/${dataSourceId}/query`) {
    const cursor = options.body && JSON.parse(options.body).start_cursor;
    if (!cursor) {
      return jsonResponse({
        results: [
          page(
            {
              Nombre: { type: "title", title: [{ plain_text: "Visible" }] },
              "Fecha de inicio": { type: "date", date: { start: "2026-10-22T09:00:00-06:00" } },
              Realizada: { type: "checkbox", checkbox: false },
              Notas: { type: "rich_text", rich_text: [{ plain_text: "secreto de actas" }] },
            },
            "https://www.notion.so/visible",
          ),
          page({
            Nombre: { type: "title", title: [{ plain_text: "Hecha" }] },
            "Fecha de inicio": { type: "date", date: { start: "2026-10-23" } },
            Realizada: { type: "checkbox", checkbox: true },
          }),
        ],
        has_more: true,
        next_cursor: "pagina-2",
      });
    }
    return jsonResponse({
      results: [
        page(
          {
            Nombre: { type: "title", title: [{ plain_text: "Fuera de ventana" }] },
            "Fecha de inicio": { type: "date", date: { start: "2027-05-01" } },
            Realizada: { type: "checkbox", checkbox: false },
          },
          "https://www.notion.so/lejos",
        ),
      ],
      has_more: false,
    });
  }
  if (parsed.pathname === `/v1/data_sources/${proyectosId}`) {
    return jsonResponse({ object: "data_source", id: proyectosId, properties: proyectosSchema });
  }
  if (parsed.pathname === `/v1/data_sources/${proyectosId}/query`) {
    return jsonResponse({
      results: [
        page(
          {
            Nombre: { type: "title", title: [{ plain_text: "Feria viva" }] },
            Plazo: { type: "date", date: { start: "2026-09-01", end: "2026-11-20" } },
            Estado: { type: "status", status: { name: "En proceso" } },
            Área: { type: "select", select: { name: "Taber" } },
          },
          "https://www.notion.so/feria",
        ),
        page({
          Nombre: { type: "title", title: [{ plain_text: "Sin plazo" }] },
          Plazo: { type: "date", date: null },
          Estado: { type: "status", status: { name: "En proceso" } },
        }),
        page({
          Nombre: { type: "title", title: [{ plain_text: "Ya finalizada" }] },
          Plazo: { type: "date", date: { start: "2026-10-22", end: "2026-10-30" } },
          Estado: { type: "status", status: { name: "Finalizadas" } },
          Área: { type: "select", select: { name: "FAHM" } },
        }),
      ],
      has_more: false,
    });
  }
  return jsonResponse({ message: "no encontrada" }, 404);
};

const items = await collectItems({
  token: "secret-token",
  reunionesId,
  proyectosId,
  fetchImpl,
  now: NOW,
});

assert.deepEqual(
  items.map((item) => item.name),
  ["Feria viva", "Visible"],
);
assert.equal(items[0].type, "evento");
assert.equal(items[0].area, "Taber");
assert.equal(items[1].type, "reunion");
assert.equal(JSON.stringify(items).includes("secreto de actas"), false);
assert.equal(JSON.stringify(items).includes("Hecha"), false);
assert.equal(JSON.stringify(items).includes("Ya finalizada"), false);
assert.equal(JSON.stringify(items).includes("Sin plazo"), false);
assert.equal(JSON.stringify(items).includes("Fuera de ventana"), false);
assert.equal(requests.some((request) => request.authorization === "Bearer secret-token"), true);
assert.equal(requests.some((request) => request.path.endsWith("/query") && request.body.start_cursor === "pagina-2"), true);

const logs = [];
const original = console.log;
console.log = (...args) => logs.push(args.join(" "));
const code = await main({ NOTION_TOKEN: "" });
console.log = original;
assert.equal(code, 0);
assert.match(logs.join("\n"), /NOTION_TOKEN no está configurado/);

const workflow = await readFile(
  new URL("../.github/workflows/actualizar-proximo.yml", import.meta.url),
  "utf8",
);
assert.match(workflow, /cron: "0 \* \* \* \*"/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /NOTION_TOKEN/);
assert.match(workflow, /NOTION_DATABASE_ID/);
assert.match(workflow, /NOTION_PROYECTOS_ID/);
assert.match(workflow, /exit 0/);
assert.match(workflow, /contents: write/);

const sample = JSON.parse(await readFile(new URL("../data/proximo.json", import.meta.url), "utf8"));
assert.equal(sample.example, true);
for (const item of sample.items) {
  assert.deepEqual(
    Object.keys(item).filter((key) => !["name", "start", "end", "type", "area", "url"].includes(key)),
    [],
  );
  assert.ok(item.type === "reunion" || item.type === "evento");
}

console.log("sync.test.mjs: ok");
