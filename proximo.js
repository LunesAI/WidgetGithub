const TZ = "America/Tegucigalpa";
const WINDOW_MONTHS = 2;

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const MONTHS_SHORT = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

const WEEKDAYS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

const WEEKDAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

const KINDS = {
  reunion: { icon: "🤝", label: "Reunión" },
  evento: { icon: "🎯", label: "Evento" },
};

const EMPTY_TEXT =
  "Sin reuniones próximas, buen momento para planificar 📅";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function safeUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch {
    /* La URL no es navegable. */
  }
  return "";
}

export function calendarParts(instant, timeZone = TZ) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const pick = (type) => Number(parts.find((part) => part.type === type)?.value);
  let hour = pick("hour");
  if (hour === 24) hour = 0;
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour,
    minute: pick("minute"),
    second: pick("second"),
  };
}

export function todayCal(now = new Date()) {
  const cal = calendarParts(now);
  return { year: cal.year, month: cal.month, day: cal.day };
}

export function parseNotionDate(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    return {
      hasTime: false,
      year: Number(dateOnly[1]),
      month: Number(dateOnly[2]),
      day: Number(dateOnly[3]),
      instant: null,
    };
  }

  let raw = trimmed;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && !/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) {
    raw += "-06:00";
  }
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) return null;
  const cal = calendarParts(instant);
  return {
    hasTime: true,
    year: cal.year,
    month: cal.month,
    day: cal.day,
    hour: cal.hour,
    minute: cal.minute,
    instant,
  };
}

export function calKey(cal) {
  return cal.year * 10000 + cal.month * 100 + cal.day;
}

export function addMonths(cal, months) {
  const anchor = new Date(Date.UTC(cal.year, cal.month - 1 + months, 1));
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(cal.day, lastDay) };
}

export function shiftDays(cal, days) {
  const shifted = new Date(Date.UTC(cal.year, cal.month - 1, cal.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function formatIsoDate(cal) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${cal.year}-${pad(cal.month)}-${pad(cal.day)}`;
}

export function windowBounds(now = new Date()) {
  const today = todayCal(now);
  const until = addMonths(today, WINDOW_MONTHS);
  return { today, until };
}

function daysBetween(fromCal, toCal) {
  const start = Date.UTC(fromCal.year, fromCal.month - 1, fromCal.day);
  const end = Date.UTC(toCal.year, toCal.month - 1, toCal.day);
  return Math.round((end - start) / 86400000);
}

export function analyzeItem(item, now = new Date()) {
  if (!item || (item.type !== "reunion" && item.type !== "evento")) {
    return { include: false };
  }
  const start = parseNotionDate(item.start);
  if (!start) return { include: false };

  const end = item.end ? parseNotionDate(item.end) : null;
  const { today, until } = windowBounds(now);
  const startKey = calKey(start);
  const todayKey = calKey(today);
  const untilKey = calKey(until);
  const endKey = end ? calKey(end) : null;
  const enCurso =
    item.type === "evento" && startKey < todayKey && endKey !== null && endKey >= todayKey;

  const include = enCurso || (startKey >= todayKey && startKey <= untilKey);
  const daysUntil = daysBetween(today, start);
  const groupCal = enCurso ? today : start;

  return {
    include,
    enCurso,
    daysUntil,
    hasTime: start.hasTime,
    start,
    end,
    soon: enCurso || (daysUntil >= 0 && daysUntil <= 7),
    groupYear: groupCal.year,
    groupMonth: groupCal.month,
    startKey,
    endKey: endKey ?? Number.MAX_SAFE_INTEGER,
    startMinutes: start.hasTime ? start.hour * 60 + start.minute : -1,
  };
}

function compareRows(a, b) {
  return (
    a.meta.startKey - b.meta.startKey ||
    a.meta.startMinutes - b.meta.startMinutes ||
    a.item.name.localeCompare(b.item.name, "es")
  );
}

export function prepareItems(items, now = new Date()) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({ item, meta: analyzeItem(item, now) }))
    .filter((row) => row.meta.include)
    .sort(compareRows);
}

export function countdownLabel(meta) {
  if (meta.enCurso) return "en curso";
  if (meta.daysUntil <= 0) return "¡Hoy!";
  if (meta.daysUntil === 1) return "mañana";
  return `faltan ${meta.daysUntil} días`;
}

function weekdayIndex(cal) {
  return new Date(Date.UTC(cal.year, cal.month - 1, cal.day)).getUTCDay();
}

function formatClock(meta) {
  if (!meta.hasTime || !meta.start.instant) return "";
  return new Intl.DateTimeFormat("es-HN", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(meta.start.instant)
    .replaceAll(/\s+/g, " ")
    .trim();
}

function monthTitle(month, year, currentYear) {
  const name = MONTHS[month - 1] || "";
  const titled = name.charAt(0).toUpperCase() + name.slice(1);
  return year !== currentYear ? `${titled} ${year}` : titled;
}

function formatFeaturedWhen(meta) {
  if (meta.enCurso && meta.end) {
    return `hasta el ${meta.end.day} de ${MONTHS[meta.end.month - 1]}`;
  }
  const when = `${WEEKDAYS[weekdayIndex(meta.start)]} ${meta.start.day} de ${MONTHS[meta.start.month - 1]}`;
  const clock = formatClock(meta);
  return clock ? `${when} · ${clock}` : when;
}

function formatListWhen(meta) {
  if (meta.enCurso && meta.end) {
    return `en curso · hasta ${meta.end.day} ${MONTHS_SHORT[meta.end.month - 1]}`;
  }
  const when = `${WEEKDAYS_SHORT[weekdayIndex(meta.start)]} ${meta.start.day} ${MONTHS_SHORT[meta.start.month - 1]}`;
  const clock = formatClock(meta);
  return clock ? `${when} · ${clock}` : when;
}

export function formatUpdated(value) {
  const parsed = parseNotionDate(value);
  if (!parsed) return "";
  if (!parsed.hasTime) {
    return `${parsed.day} ${MONTHS_SHORT[parsed.month - 1]} ${parsed.year}`;
  }
  const cal = calendarParts(parsed.instant);
  const clock = new Intl.DateTimeFormat("es-HN", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(parsed.instant)
    .replaceAll(/\s+/g, " ")
    .trim();
  return `${cal.day} ${MONTHS_SHORT[cal.month - 1]} ${cal.year}, ${clock}`;
}

export function formatTegucigalpaISO(now = new Date()) {
  const cal = calendarParts(now);
  const pad = (number) => String(number).padStart(2, "0");
  return `${cal.year}-${pad(cal.month)}-${pad(cal.day)}T${pad(cal.hour)}:${pad(cal.minute)}:${pad(cal.second)}-06:00`;
}

function kindMarkup(type) {
  const kind = KINDS[type] || { icon: "•", label: "Actividad" };
  return `<span class="kind" title="${escapeHtml(kind.label)}"><span aria-hidden="true">${kind.icon}</span><span class="sr-only">${escapeHtml(kind.label)}</span></span>`;
}

function areaMarkup(area, featured) {
  if (!area) return "";
  return `<span class="area${featured ? " area-on-accent" : ""}">${escapeHtml(area)}</span>`;
}

function linkOpen(url, label) {
  const href = safeUrl(url);
  if (!href) return `<div class="card" role="group" aria-label="${escapeHtml(label)}">`;
  return `<a class="card" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}">`;
}

function linkClose(url) {
  return safeUrl(url) ? "</a>" : "</div>";
}

function renderFeatured(row) {
  const { item, meta } = row;
  const countdown = countdownLabel(meta);
  const when = formatFeaturedWhen(meta);
  const label = `${KINDS[item.type]?.label || "Actividad"}: ${item.name}, ${countdown}, ${when}`;
  const href = safeUrl(item.url);
  const open = href
    ? `<a class="featured" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}">`
    : `<div class="featured" role="group" aria-label="${escapeHtml(label)}">`;
  const close = href ? "</a>" : "</div>";
  return `${open}
      <span class="countdown">${escapeHtml(countdown)}</span>
      <span class="title-row">
        ${kindMarkup(item.type)}
        <span class="name">${escapeHtml(item.name)}</span>
        ${areaMarkup(item.area, true)}
      </span>
      <span class="when">${escapeHtml(when)}</span>
    ${close}`;
}

function renderListItem(row) {
  const { item, meta } = row;
  const when = formatListWhen(meta);
  const label = `${KINDS[item.type]?.label || "Actividad"}: ${item.name}, ${when}`;
  const dot = meta.soon
    ? `<span class="dot" title="En los próximos 7 días" aria-hidden="true"></span>`
    : `<span class="dot-spacer" aria-hidden="true"></span>`;
  return `<li>
      ${linkOpen(item.url, label)}
        ${dot}
        <span class="body">
          <span class="title-row">
            ${kindMarkup(item.type)}
            <span class="name">${escapeHtml(item.name)}</span>
            ${areaMarkup(item.area, false)}
          </span>
          <span class="when">${escapeHtml(when)}</span>
        </span>
      ${linkClose(item.url)}
    </li>`;
}

function renderGroups(rows, currentYear) {
  const groups = [];
  for (const row of rows) {
    const key = `${row.meta.groupYear}-${row.meta.groupMonth}`;
    const existing = groups.find((group) => group.key === key);
    if (existing) existing.rows.push(row);
    else {
      groups.push({
        key,
        title: monthTitle(row.meta.groupMonth, row.meta.groupYear, currentYear),
        rows: [row],
      });
    }
  }
  return groups
    .map(
      (group) => `<section class="month">
      <h2>${escapeHtml(group.title)}</h2>
      <ul>
        ${group.rows.map(renderListItem).join("\n")}
      </ul>
    </section>`,
    )
    .join("\n");
}

export function renderWidget(data, now = new Date()) {
  const source = data && typeof data === "object" ? data : {};
  const rows = prepareItems(source.items || source.meetings, now);
  const visible = rows.slice(0, 6);
  const extra = rows.length - visible.length;
  const updated = formatUpdated(source.updatedAt);
  const example = source.example
    ? `<p class="example">Datos de ejemplo</p>`
    : "";
  const footer = updated
    ? `<p class="updated">Actualizado: ${escapeHtml(updated)}</p>`
    : "";

  if (visible.length === 0) {
    return `<h1>📆 Próximo</h1>
    ${example}
    <p class="empty">${EMPTY_TEXT}</p>
    ${footer}`;
  }

  const [featured, ...rest] = visible;
  const more =
    extra > 0 ? `<p class="more">y ${extra} más…</p>` : "";
  const year = todayCal(now).year;

  return `<h1>📆 Próximo</h1>
    ${example}
    ${renderFeatured(featured)}
    ${renderGroups(rest, year)}
    ${more}
    ${footer}`;
}

export function renderMessage(text) {
  return `<h1>📆 Próximo</h1><p class="empty">${escapeHtml(text)}</p>`;
}

async function boot() {
  const root = document.querySelector("#proximo");
  if (!root) return;
  try {
    const bucket = Math.floor(Date.now() / 3600000);
    const response = await fetch(`data/proximo.json?v=${bucket}`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    root.innerHTML = renderWidget(data, new Date());
  } catch {
    root.innerHTML = renderMessage(
      "No se pudieron cargar las próximas reuniones y eventos.",
    );
  }
}

if (typeof document !== "undefined") {
  boot();
}
