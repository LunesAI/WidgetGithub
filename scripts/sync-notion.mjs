import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatIsoDate,
  formatTegucigalpaISO,
  prepareItems,
  shiftDays,
  windowBounds,
} from "../proximo.js";

export const DEFAULT_REUNIONES_ID = "8724ac27a5eb4b5c9a1a0b1053caf0b1";
export const DEFAULT_PROYECTOS_ID = "c61397baa7a9827cbcf0815ef33f7e7f";
const NOTION_VERSION = "2025-09-03";
const ALLOWED_KEYS = ["name", "start", "end", "type", "area", "url"];

function fold(value) {
  return String(value || "")
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .trim()
    .toLowerCase();
}

export function normalizeNotionId(id) {
  const hex = String(id || "")
    .replaceAll("-", "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(`Identificador de Notion inválido: ${id}`);
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function pickId(primary, secondary, fallback) {
  const value = [primary, secondary]
    .map((item) => String(item || "").trim())
    .find(Boolean);
  return value || fallback;
}

export function resolveProperties(properties, expected) {
  const entries = Object.entries(properties || {}).map(([key, value]) => ({
    key,
    name: value?.name || key,
    type: value?.type,
  }));

  function findByName(label, types) {
    if (!label) return null;
    const wanted = fold(label);
    const named = entries.filter(
      (entry) => fold(entry.name) === wanted || fold(entry.key) === wanted,
    );
    if (!types?.length) return named[0] || null;
    return named.find((entry) => types.includes(entry.type)) || null;
  }

  function firstOfType(type) {
    return entries.find((entry) => entry.type === type) || null;
  }

  return {
    title: findByName(expected.title, ["title"]) || firstOfType("title"),
    date: findByName(expected.date, ["date"]) || firstOfType("date"),
    checkbox: expected.checkbox
      ? findByName(expected.checkbox, ["checkbox"])
      : null,
    status: expected.status
      ? findByName(expected.status, ["status", "select"])
      : null,
    area: expected.area
      ? findByName(expected.area, ["select", "multi_select"])
      : null,
  };
}

function readProp(page, resolved) {
  if (!resolved) return null;
  const props = page.properties || {};
  return props[resolved.key] ?? props[resolved.name] ?? null;
}

function plainText(parts) {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => part?.plain_text || "")
    .join("")
    .trim();
}

function statusLabel(prop) {
  if (!prop) return "";
  if (prop.type === "status") return prop.status?.name || "";
  if (prop.type === "select") return prop.select?.name || "";
  return "";
}

function areaLabel(prop) {
  if (!prop) return "";
  if (prop.type === "select") return (prop.select?.name || "").trim();
  if (prop.type === "multi_select" && Array.isArray(prop.multi_select)) {
    return prop.multi_select
      .map((option) => option?.name)
      .filter(Boolean)
      .join(" · ")
      .trim();
  }
  return "";
}

export function pageToItem(page, resolved, type) {
  if (!page || page.object !== "page" || page.archived || page.in_trash) return null;

  const dateProp = readProp(page, resolved.date);
  const start = dateProp?.type === "date" ? dateProp.date?.start || "" : "";
  if (!start) return null;

  if (resolved.checkbox) {
    const box = readProp(page, resolved.checkbox);
    if (box?.type === "checkbox" && box.checkbox === true) return null;
  }

  if (resolved.status && fold(statusLabel(readProp(page, resolved.status))) === fold("Finalizadas")) {
    return null;
  }

  const href = typeof page.url === "string" ? page.url : "";
  if (!/^https?:\/\//.test(href)) return null;

  const name = plainText(readProp(page, resolved.title)?.title) || "Sin nombre";
  const item = { name, start, type, url: href };
  const end = dateProp?.date?.end || "";
  if (end) item.end = end;
  if (type === "evento") {
    const area = areaLabel(readProp(page, resolved.area)).slice(0, 40);
    if (area) item.area = area;
  }

  return Object.fromEntries(ALLOWED_KEYS.filter((key) => key in item).map((key) => [key, item[key]]));
}

export function apiDateWindow(now = new Date()) {
  const { today, until } = windowBounds(now);
  return {
    today: formatIsoDate(shiftDays(today, -1)),
    until: formatIsoDate(shiftDays(until, 1)),
  };
}

export function buildReunionesFilter(resolved, now = new Date()) {
  const { today, until } = apiDateWindow(now);
  const and = [
    { property: resolved.date.name, date: { on_or_after: today } },
    { property: resolved.date.name, date: { on_or_before: until } },
  ];
  if (resolved.checkbox) {
    and.push({
      property: resolved.checkbox.name,
      checkbox: { does_not_equal: true },
    });
  }
  return { and };
}

export function buildProyectosFilter(resolved, now = new Date()) {
  const { until } = apiDateWindow(now);
  const and = [
    { property: resolved.date.name, date: { is_not_empty: true } },
    { property: resolved.date.name, date: { on_or_before: until } },
  ];
  if (resolved.status?.type === "status") {
    and.push({
      property: resolved.status.name,
      status: { does_not_equal: "Finalizadas" },
    });
  } else if (resolved.status?.type === "select") {
    and.push({
      property: resolved.status.name,
      select: { does_not_equal: "Finalizadas" },
    });
  }
  return { and };
}

export function nextPayload(items, now = new Date()) {
  return {
    updatedAt: formatTegucigalpaISO(now),
    items,
  };
}

export function planWrite(previousText, payload) {
  const next = `${JSON.stringify(payload, null, 2)}\n`;
  if (previousText == null) return next;
  let previous;
  try {
    previous = JSON.parse(previousText);
  } catch {
    return next;
  }
  const previousItems = Array.isArray(previous.items)
    ? previous.items
    : previous.meetings;
  const same = JSON.stringify(previousItems) === JSON.stringify(payload.items);
  if (same && previous.example !== true) return null;
  return next;
}

async function notion(fetchImpl, token, requestPath, { method = "GET", body } = {}) {
  const response = await fetchImpl(`https://api.notion.com/v1${requestPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const error = new Error(
      `Notion ${method} ${requestPath} respondió ${response.status}: ${json?.message || text.slice(0, 300)}`,
    );
    error.status = response.status;
    throw error;
  }
  return json;
}

async function resolveDataSource(fetchImpl, token, id) {
  const normalized = normalizeNotionId(id);
  try {
    const direct = await notion(fetchImpl, token, `/data_sources/${normalized}`);
    if (direct?.object === "data_source" && direct.properties) return direct;
  } catch (error) {
    if (error.status !== 400 && error.status !== 404) throw error;
  }

  const database = await notion(fetchImpl, token, `/databases/${normalized}`);
  const dataSourceId = database?.data_sources?.[0]?.id;
  if (dataSourceId) {
    return notion(fetchImpl, token, `/data_sources/${dataSourceId}`);
  }
  if (database?.properties) {
    return { ...database, object: "data_source", id: database.id || normalized };
  }
  throw new Error(`No se pudo leer el esquema de ${normalized}.`);
}

async function queryPages(fetchImpl, token, dataSourceId, filter) {
  const pages = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;
    const response = await notion(fetchImpl, token, `/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body,
    });
    pages.push(...(response.results || []));
    if (pages.length > 2000) {
      throw new Error("La consulta superó 2000 páginas. Revisa los filtros.");
    }
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return pages;
}

async function queryWithFilter(fetchImpl, token, dataSourceId, filter) {
  try {
    return await queryPages(fetchImpl, token, dataSourceId, filter);
  } catch (error) {
    if (error.status !== 400) throw error;
    console.log(
      `Aviso: Notion rechazó el filtro (${error.message}). Se consulta sin filtro y se depura al armar el JSON.`,
    );
    return queryPages(fetchImpl, token, dataSourceId);
  }
}

async function loadSource(fetchImpl, token, { id, label, expected, type, filterFor, now }) {
  const source = await resolveDataSource(fetchImpl, token, id);
  const resolved = resolveProperties(source.properties, expected);
  if (!resolved.title || !resolved.date) {
    throw new Error(
      `${label} no tiene una propiedad de título o de fecha reconocible. Revisa el esquema.`,
    );
  }
  if (expected.checkbox && !resolved.checkbox) {
    console.log(
      `Aviso: ${label} no tiene la casilla "${expected.checkbox}". No se excluye ninguna fila por esa casilla.`,
    );
  }
  if (expected.status && !resolved.status) {
    console.log(
      `Aviso: ${label} no tiene la propiedad "${expected.status}". No se excluye ninguna fila por estado.`,
    );
  }

  const pages = await queryWithFilter(
    fetchImpl,
    token,
    source.id,
    filterFor(resolved, now),
  );
  return pages
    .map((page) => pageToItem(page, resolved, type))
    .filter(Boolean);
}

export async function collectItems({
  token,
  reunionesId,
  proyectosId,
  fetchImpl = globalThis.fetch,
  now = new Date(),
}) {
  const reuniones = await loadSource(fetchImpl, token, {
    id: reunionesId,
    label: "Reuniones",
    type: "reunion",
    now,
    expected: {
      title: "Nombre",
      date: "Fecha de inicio",
      checkbox: "Realizada",
    },
    filterFor: buildReunionesFilter,
  });
  const eventos = await loadSource(fetchImpl, token, {
    id: proyectosId,
    label: "Proyectos",
    type: "evento",
    now,
    expected: {
      title: "Nombre",
      date: "Plazo",
      status: "Estado",
      area: "Área",
    },
    filterFor: buildProyectosFilter,
  });

  const items = prepareItems([...reuniones, ...eventos], now).map((row) => row.item);
  console.log(`Reuniones en la ventana: ${items.filter((item) => item.type === "reunion").length}.`);
  console.log(`Eventos en la ventana: ${items.filter((item) => item.type === "evento").length}.`);
  return items;
}

export async function writePayload(file, payload, read = readFile, write = writeFile) {
  let previous = null;
  try {
    previous = await read(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const next = planWrite(previous, payload);
  if (!next) {
    console.log("data/proximo.json no cambió. No se reescribe.");
    return false;
  }
  await write(file, next);
  console.log(`Se escribieron ${payload.items.length} elementos en data/proximo.json.`);
  return true;
}

export async function main(env = process.env) {
  const token = String(env.NOTION_TOKEN || "").trim();
  if (!token) {
    console.log("NOTION_TOKEN no está configurado.");
    console.log(
      "Se omite la actualización. Agrega el secret NOTION_TOKEN (token de la integración interna de Notion) para publicar reuniones y eventos en data/proximo.json.",
    );
    return 0;
  }

  const now = new Date();
  const items = await collectItems({
    token,
    reunionesId: pickId(env.NOTION_DATABASE_ID, env.NOTION_DATABASE_ID_SECRET, DEFAULT_REUNIONES_ID),
    proyectosId: pickId(env.NOTION_PROYECTOS_ID, env.NOTION_PROYECTOS_ID_SECRET, DEFAULT_PROYECTOS_ID),
    now,
  });
  const file = path.join(process.cwd(), "data", "proximo.json");
  await writePayload(file, nextPayload(items, now));
  return 0;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
