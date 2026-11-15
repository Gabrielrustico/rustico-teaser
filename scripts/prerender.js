/* Escribe la carta como HTML fijo dentro de las páginas, para que Google la lea sin JavaScript.
   Lo corre la GitHub Action después de traer los precios de Fudo (y se puede correr a mano:
   node scripts/prerender.js). Toma los platos de carta.js y los precios de menu.json si existe. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const raiz = path.join(__dirname, "..");
const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(raiz, "carta.js"), "utf8") +
  ";this.MENU=MENU;this.SABOR=SABOR;this.aplicarPreciosFudo=aplicarPreciosFudo;this.normName=normName;", ctx);
const menuJson = path.join(raiz, "menu.json");
if (fs.existsSync(menuJson)) ctx.aplicarPreciosFudo(JSON.parse(fs.readFileSync(menuJson, "utf8")));

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clp = n => Math.round(n).toLocaleString("es-CL");
const slug = s => ctx.normName(s) || "otros";
const tags = t => t ? String(t).split(",").map(x => `<span class="tag">${esc(x.trim())}</span>`).join("") : "";
const item = ([n, p, d, img, t], base) => `<div class="item${img ? "" : " noimg"}">${img ? `<div class="ph"><img src="${base}img/${img}.jpg" alt="${esc(n)}" loading="lazy" width="640" height="640"></div>` : ""}<div><div class="row"><h3>${esc(n)}${tags(t)}</h3><span class="lead"></span><span class="price">${clp(p)}</span></div>${ctx.SABOR[n] ? `<p class="sabor">${esc(ctx.SABOR[n])}</p>` : ""}${d ? `<p class="desc">${esc(d)}</p>` : ""}</div></div>`;
const seccion = (cat, base) => `<section class="sec" id="${slug(cat)}"><h2>${esc(cat)}</h2>${ctx.MENU[cat].items.map(i => item(i, base)).join("")}</section>`;

function reemplazar(archivo, html) {
  const f = path.join(raiz, archivo);
  const s = fs.readFileSync(f, "utf8");
  const re = /<!--estatica-->[\s\S]*?<!--\/estatica-->/;
  if (!re.test(s)) throw new Error("Falta el marcador <!--estatica--> en " + archivo);
  const n = s.replace(re, "<!--estatica-->" + html + "<!--/estatica-->");
  if (n !== s) { fs.writeFileSync(f, n); console.log("Actualizada", archivo); }
}

reemplazar("carta/index.html", Object.keys(ctx.MENU).map(c => seccion(c, "../")).join(""));
reemplazar("bar-cocteleria/index.html", ["Coctelería", "Cervezas", "Sin alcohol"].filter(c => ctx.MENU[c]).map(c => seccion(c, "../")).join(""));
