# 📆 Próximo

Widget estático para la columna derecha de una página de Notion. Muestra, en una sola lista, las reuniones y los eventos de los próximos dos meses. El texto está en español de Honduras y las fechas se calculan en `America/Tegucigalpa` (UTC−6, sin horario de verano).

La página no tiene compilación: `index.html`, `styles.css` y `proximo.js` leen `data/proximo.json`.

## Datos de ejemplo

`data/proximo.json` incluye reuniones y eventos **ficticios**, marcados con `"example": true`. Sirven para que el widget se vea antes de conectar Notion. El workflow los reemplaza en la primera sincronización correcta y quita esa marca.

## Qué se publica

Cada elemento del JSON lleva solo:

- `name`: nombre
- `start`: inicio de la fecha (con hora si Notion la tiene)
- `end`: fin, solo si la fecha es un rango
- `type`: `reunion` o `evento`
- `area`: valor de Área, solo en eventos y solo si existe
- `url`: enlace a la página de Notion

No se escriben lugar, ministerio, notas ni ninguna otra propiedad. El archivo también guarda `updatedAt`, la hora de la última vez que la lista cambió.

## Crear la integración de Notion

1. Abre [Mis integraciones](https://www.notion.so/my-integrations).
2. Crea una integración **interna**. Un nombre posible es `Próximo`.
3. Copia el token secreto (empieza por `ntn_` o `secret_`).

## Compartir las bases

En **Reuniones** y en **Proyectos**, abre el menú `•••` → **Conexiones** y agrega la integración. Sin ese paso la API responde 404.

## Secret y variables

En el repositorio: **Settings → Secrets and variables → Actions**.

| Nombre | Dónde | Si no está |
| --- | --- | --- |
| `NOTION_TOKEN` | Secret | El workflow termina bien, deja un aviso en el log y no toca el JSON. |
| `NOTION_DATABASE_ID` | Variable o secret | Se usa la base Reuniones `8724ac27a5eb4b5c9a1a0b1053caf0b1`. |
| `NOTION_PROYECTOS_ID` | Variable o secret | Se usa la base Proyectos `c61397baa7a9827cbcf0815ef33f7e7f`. |

## Propiedades

Reuniones:

- Título `Nombre`
- Fecha `Fecha de inicio`
- Casilla `Realizada`: si está marcada, la fila no se muestra

Proyectos (se muestran como eventos):

- Título `Nombre`
- Fecha `Plazo`. Puede ser un rango: se usa el inicio. Si el inicio ya pasó y el fin es hoy o posterior, entra como **en curso**.
- Estado `Estado`: se omiten las filas `Finalizadas`
- Sin `Plazo`, la fila no se muestra
- Selección opcional `Área` (`SII`, `Taber`, `Bless`, `Future Vision`, `FAHM`)

Si el nombre no coincide, se usa la propiedad de tipo título y la primera de tipo fecha.

La ventana es hoy y los dos meses siguientes, en hora de Tegucigalpa. Un evento en curso se incluye aunque haya empezado antes.

## GitHub Pages

1. **Settings → Pages**.
2. **Build and deployment → Deploy from a branch**.
3. Branch `main`, carpeta `/ (root)`.
4. Guarda.

La dirección queda en `https://lunesai.github.io/WidgetGithub/`. La primera publicación puede tardar un minuto. El archivo `.nojekyll` evita que Jekyll procese el sitio.

## Ejecutar el workflow

**Actions → Actualizar Próximo → Run workflow**.

También corre solo cada hora (GitHub puede demorarlo unos minutos). Solo hace commit si cambió la lista de `data/proximo.json`.

## Incrustar en Notion

En la página, escribe `/embed` y pega:

```
https://lunesai.github.io/WidgetGithub/
```

El widget está pensado para una columna de unos 250–350 px: fondo `#EAF6FF`, la primera actividad de la lista cronológica en una tarjeta `#3E8FD6` (un evento en curso queda arriba porque ya empezó) y el resto agrupado por mes. Muestra como máximo 6 y, si hay más, cierra con «y N más…». 🤝 es una reunión y 🎯 es un evento. El punto marca lo que cae en los próximos 7 días. «¡Hoy!», «mañana», «faltan X días» y «en curso» se calculan en el navegador, así siguen correctos entre una ejecución y otra.

## Pruebas

```bash
node scripts/render.test.mjs
node scripts/sync.test.mjs
```
