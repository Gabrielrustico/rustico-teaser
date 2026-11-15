/* Pestaña Indicadores (solo administradores).
   Lee indicadores_mes (calculados desde Fudo por la acción de GitHub) e indicadores_manual
   (metas y reseñas que escribe el administrador). Sin datos en el código: todo viene de Supabase. */
const IND = (() => {
  const st = { cargado: false, meses: {}, manual: {}, mes: null, modo: "mes", anio: null };
  const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const nombreMes = m => { const [y, mo] = m.split("-"); return MESES[+mo - 1] + " " + y; };
  const corto = m => MESES[+m.split("-")[1] - 1].slice(0, 3);
  const mm = n => "$" + (n / 1e6).toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " MM";
  const pct = n => (n ?? 0).toLocaleString("es-CL", { maximumFractionDigits: 1 }) + "%";
  const mesAnterior = m => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };

  async function cargar(){
    const [a, b] = await Promise.all([
      q(sb.from("indicadores_mes").select("mes,datos,actualizado").order("mes")),
      q(sb.from("indicadores_manual").select("mes,datos").order("mes")),
    ]);
    st.meses = Object.fromEntries(a.map(r => [r.mes, { ...r.datos, actualizado: r.actualizado }]));
    st.manual = Object.fromEntries(b.map(r => [r.mes, r.datos || {}]));
    const lista = Object.keys(st.meses).sort();
    if (!st.mes || !st.meses[st.mes]) st.mes = st.meses[hoyMes()] ? hoyMes() : (lista[lista.length - 1] || hoyMes());
    st.anio = st.anio || st.mes.slice(0, 4);
    st.cargado = true;
  }

  // Variación contra el mes anterior: "▲ 4,2%" en verde o "▼" en rojo.
  function delta(act, ant, invertir){
    if (!ant || !act) return "";
    const d = (act - ant) / ant * 100, bueno = invertir ? d < 0 : d >= 0;
    return `<span class="ind-d ${bueno ? "ok" : "bad"}">${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toLocaleString("es-CL", { maximumFractionDigits: 1 })}% vs ${corto(mesAnterior(st.mes))}</span>`;
  }
  function barra(valor, meta, proy){
    if (!meta) return "";
    const p = Math.min(100, valor / meta * 100), pp = proy ? Math.min(100, proy / meta * 100) : 0;
    return `<div class="ind-bar" role="img" aria-label="${Math.round(valor / meta * 100)}% de la meta">
      ${pp > p ? `<i class="proy" style="width:${pp}%"></i>` : ""}<i style="width:${p}%"></i></div>`;
  }
  const tarjeta = (titulo, valor, extra) => `<div class="box ind-k"><span class="label">${titulo}</span><b>${valor}</b>${extra || ""}</div>`;

  // Venta acumulada del mes contra la línea de la meta.
  function graficoAcumulado(d, meta){
    const W = 1000, H = 280, P = { l: 46, r: 12, t: 16, b: 24 };
    const acum = []; d.por_dia.reduce((s, v, i) => (acum[i] = s + v), 0);
    const hasta = d.cerrado ? d.dias_mes : Math.min(d.dias_transcurridos, d.dias_mes);
    const max = Math.max(meta || 0, acum[d.dias_mes - 1] || 0, 1) * 1.05;
    const x = i => P.l + (W - P.l - P.r) * (i + 1) / d.dias_mes, y = v => H - P.b - (H - P.t - P.b) * v / max;
    const linea = acum.slice(0, hasta).map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const ticks = [0, .25, .5, .75, 1].map(f => max / 1.05 * f);
    return `<svg viewBox="0 0 ${W} ${H}" class="ind-svg" role="img" aria-label="Venta acumulada del mes">
      ${ticks.map(t => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${P.l - 6}" y="${y(t) + 4}" text-anchor="end">${(t / 1e6).toFixed(0)}</text>`).join("")}
      ${meta ? `<line x1="${P.l}" y1="${y(0)}" x2="${x(d.dias_mes - 1)}" y2="${y(meta)}" class="meta"/><text x="${x(d.dias_mes - 1)}" y="${y(meta) - 6}" text-anchor="end" class="metat">meta ${mm(meta)}</text>` : ""}
      <path d="${linea}" class="serie"/>
      ${[1, 8, 15, 22, 29].filter(n => n <= d.dias_mes).map(n => `<text x="${x(n - 1)}" y="${H - 6}" text-anchor="middle">${n}</text>`).join("")}
    </svg><p class="small muted">Millones de pesos acumulados por día del mes. La línea punteada es el ritmo para llegar a la meta.</p>`;
  }

  // Evolución de la venta por mes, con la meta de cada mes.
  function graficoMeses(){
    const lista = Object.keys(st.meses).filter(m => m.startsWith(st.anio)).sort();
    if (lista.length < 2) return `<div class="empty">La evolución aparece cuando haya al menos dos meses calculados.</div>`;
    const W = 1000, H = 260, P = { l: 46, r: 12, t: 20, b: 24 };
    const vals = lista.map(m => st.meses[m].venta), metas = lista.map(m => +(st.manual[m]?.meta_venta) || 0);
    const max = Math.max(...vals, ...metas, 1) * 1.1, bw = (W - P.l - P.r) / lista.length;
    const y = v => H - P.b - (H - P.t - P.b) * v / max;
    return `<svg viewBox="0 0 ${W} ${H}" class="ind-svg" role="img" aria-label="Venta por mes">
      ${lista.map((m, i) => { const x0 = P.l + i * bw; const cerr = st.meses[m].cerrado; return `
        <rect x="${x0 + bw * .18}" y="${y(vals[i])}" width="${bw * .64}" height="${y(0) - y(vals[i])}" class="${m === st.mes ? "sel" : ""} ${cerr ? "" : "parcial"}" rx="3"/>
        ${metas[i] ? `<line x1="${x0 + bw * .1}" x2="${x0 + bw * .9}" y1="${y(metas[i])}" y2="${y(metas[i])}" class="meta"/>` : ""}
        <text x="${x0 + bw / 2}" y="${y(vals[i]) - 5}" text-anchor="middle">${(vals[i] / 1e6).toFixed(1)}</text>
        <text x="${x0 + bw / 2}" y="${H - 6}" text-anchor="middle">${corto(m)}</text>`; }).join("")}
    </svg><p class="small muted">Venta neta en millones. Raya punteada: meta del mes. Barra clara: mes en curso.</p>`;
  }

  // Venta por día de la semana y hora, promedio por día abierto.
  function mapaCalor(d){
    const dias = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"], horas = [...Array(12)].map((_, i) => 12 + i);
    const prom = d.calor.map((fila, i) => fila.map(v => d.dias_por_semana[i] ? v / d.dias_por_semana[i] : 0));
    const max = Math.max(1, ...prom.flat());
    return `<div class="tablewrap"><table class="ind-heat"><thead><tr><th></th>${horas.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>
      ${prom.map((fila, i) => `<tr><th>${dias[i]}</th>${fila.map((v, h) => `<td style="--a:${(v / max).toFixed(2)}" class="${v / max > .6 ? "hi" : ""}" title="${dias[i]} ${horas[h]}:00 · ${clp(v)} promedio">${v ? Math.round(v / 1000) : ""}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>
    <p class="small muted">Miles de pesos vendidos en promedio por día abierto, según la hora en que se abrió la cuenta. Fudo no registra cuándo se sienta la mesa, así que esto mide actividad, no ocupación. Domingo cierra a las 18:00.</p>`;
  }

  function tablaMesas(d){
    return `<div class="tablewrap"><table><thead><tr><th>Mesa</th><th class="num">Cuentas</th><th class="num">Personas</th><th class="num">Venta</th><th class="num">Ticket/persona</th><th class="num">Margen bebidas</th></tr></thead><tbody>
      ${d.mesas.map(m => `<tr><td>${esc(m.grupo)}</td><td class="num">${m.ventas}</td><td class="num">${m.personas || "—"}</td><td class="num">${clp(m.venta)}</td>
        <td class="num">${m.personas ? clp(m.venta / m.personas) : "—"}</td><td class="num">${m.venta_beb ? clp(m.margen_beb) + ` <small class="muted">${pct(m.margen_beb / m.venta_beb * 100)}</small>` : "—"}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="small muted">Mesas que suelen juntarse van sumadas. Terraza y barra aparte. El margen es solo de bebidas: Fudo aún no tiene el costo de la comida.</p>`;
  }

  const tablaProd = lista => `<div class="tablewrap"><table><thead><tr><th>Producto</th><th class="num">Unid.</th><th class="num">Venta</th></tr></thead><tbody>
    ${lista.map(p => `<tr><td>${esc(p.nombre)} <small class="muted">${esc(p.cat)}</small></td><td class="num">${p.u.toLocaleString("es-CL")}</td><td class="num">${clp(p.v)}</td></tr>`).join("")}
  </tbody></table></div>`;

  function formManual(man){
    const v = k => man[k] ?? "";
    const inp = (id, lab, k, step = "any") => `<div class="field"><label for="${id}">${lab}</label><input id="${id}" data-k="${k}" type="number" step="${step}" value="${v(k)}"></div>`;
    return `<details class="box" ${Object.keys(man).length ? "" : "open"}><summary><b>Metas y reseñas de ${nombreMes(st.mes)}</b> <span class="small muted">(se escriben a mano)</span></summary>
      <form id="fInd" style="margin-top:12px"><div class="fields">
        ${inp("i-mv", "Meta de venta ($)", "meta_venta", "1")}${inp("i-mt", "Meta ticket por persona ($)", "meta_ticket", "1")}${inp("i-mr", "Meta reseñas nuevas", "meta_resenas", "1")}
        ${inp("i-rn", "Reseñas nuevas del mes", "resenas_nuevas", "1")}${inp("i-rt", "Reseñas totales en Google", "resenas_total", "1")}${inp("i-es", "Estrellas en Google", "estrellas", "0.1")}
      </div><div class="actions"><button class="btn btn-gold">Guardar</button></div><div class="status" id="i-status"></div>
      <p class="small muted">Las reseñas se toman del Perfil de Empresa de Google. Fudo no las tiene.</p></form></details>`;
  }

  function pintarMes(){
    const d = st.meses[st.mes], man = st.manual[st.mes] || {}, ant = st.meses[mesAnterior(st.mes)];
    const lista = Object.keys(st.meses).sort().reverse();
    const selector = modos() + `<div class="ind-top"><div><h2 style="margin:0">Indicadores de ${nombreMes(st.mes)}</h2>
        <p class="small muted">${d ? (d.cerrado ? "Mes cerrado" : `Al día ${d.dias_transcurridos} de ${d.dias_mes}`) + " · " + esc(d.fuente || "Fudo") : ""}</p></div>
      ${lista.length ? `<select id="i-mes" aria-label="Mes">${lista.map(m => `<option value="${m}" ${m === st.mes ? "selected" : ""}>${nombreMes(m)}</option>`).join("")}</select>` : ""}</div>`;
    if (!d) {
      $("vista").innerHTML = `${selector}<div class="box stack"><p>Todavía no hay indicadores calculados.</p>
        <p class="small muted">Se llenan solos desde Fudo con la acción “Indicadores mensuales desde Fudo” de GitHub, tres veces al día. Necesita los secretos FUDO_API_KEY, FUDO_API_SECRET y SUPABASE_SERVICE_ROLE_KEY en el repositorio.</p></div>
        <div style="margin-top:14px">${formManual(man)}</div>`;
      return bindManual();
    }
    const mv = +man.meta_venta || 0, mt = +man.meta_ticket || 0, mr = +man.meta_resenas || 0;
    const proy = d.cerrado ? 0 : Math.round(d.venta / Math.max(1, d.dias_transcurridos) * d.dias_mes);
    const rn = man.resenas_nuevas;
    // Mes en curso: la venta se compara con los mismos días del mes anterior; los conteos no se comparan.
    const ventaAnt = ant && !d.cerrado ? ant.por_dia.slice(0, d.dias_transcurridos).reduce((a, b) => a + b, 0) : ant?.venta;
    const cuenta = (act, prev) => d.cerrado ? delta(act, prev) : "";
    $("vista").innerHTML = `${selector}
      <div class="ind-grid">
        ${tarjeta("Venta neta", mm(d.venta), `${mv ? `<span class="small">${Math.round(d.venta / mv * 100)}% de la meta de ${mm(mv)}</span>` : ""}${barra(d.venta, mv, proy)}
          ${proy ? `<span class="small muted">Al ritmo actual cierra en ${mm(proy)}</span>` : ""}${delta(d.venta, ventaAnt)}${!d.cerrado && ant ? `<span class="small muted">(mismos ${d.dias_transcurridos} días)</span>` : ""}`)}
        ${tarjeta("Ticket por persona", clp(d.ticket_persona), `${mt ? `<span class="small ${d.ticket_persona >= mt ? "ok" : "bad"}">Objetivo ${clp(mt)}</span>${barra(d.ticket_persona, mt)}` : ""}${delta(d.ticket_persona, ant?.ticket_persona)}`)}
        ${tarjeta("Reseñas nuevas en Google", rn != null && rn !== "" ? rn : "—", `${mr ? `<span class="small">Meta ${mr}</span>${barra(+rn || 0, mr)}` : ""}
          ${man.resenas_total ? `<span class="small muted">${man.resenas_total} en total · ${man.estrellas || "—"} ★</span>` : `<span class="small muted">Escríbelas abajo</span>`}`)}
        ${tarjeta("Cuentas", d.ventas.toLocaleString("es-CL"), `<span class="small muted">${clp(d.ticket_venta)} por cuenta · ${d.personas_salon.toLocaleString("es-CL")} personas en salón</span>${cuenta(d.ventas, ant?.ventas)}`)}
        ${tarjeta("Cuentas con entrada", pct(d.pct_con_entrada), `<span class="small muted">Antipasto sin Panuozzo · ${pct(d.pct_entradas_venta)} de la venta</span>`)}
        ${tarjeta("Postres", pct(d.pct_postres), `<span class="small muted">de la venta · ${clp(d.venta_postres)}</span>`)}
        ${tarjeta("Panuozzo", d.panuozzo.u.toLocaleString("es-CL") + " unid.", `<span class="small muted">${clp(d.panuozzo.v)} · ${d.panuozzo.ventas} cuentas</span>${cuenta(d.panuozzo.u, ant?.panuozzo?.u)}`)}
        ${tarjeta("Margen de bebidas", clp(d.bebidas.margen), `<span class="small muted">${pct(d.bebidas.pct_margen)} sobre ${clp(d.bebidas.venta)} vendidos</span>`)}
      </div>
      <div class="box" style="margin-top:14px"><h3 style="margin-top:0">Venta acumulada del mes</h3>${graficoAcumulado(d, mv)}</div>
      <div class="box" style="margin-top:14px"><h3 style="margin-top:0">Actividad por día y hora</h3>${mapaCalor(d)}</div>
      <div class="box" style="margin-top:14px"><h3 style="margin-top:0">Mesas</h3>${tablaMesas(d)}</div>
      <div class="ind-2">
        <div class="box"><h3 style="margin-top:0">Más vendidos</h3>${tablaProd(d.top)}</div>
        <div class="box"><h3 style="margin-top:0">Menos vendidos</h3>${tablaProd(d.bottom)}</div>
      </div>
      <div style="margin-top:14px">${formManual(man)}</div>`;
    bindManual();
  }

  function bindManual(){
    const sel = $("i-mes"); if (sel) sel.onchange = () => { st.mes = sel.value; pintar(); };
    const f = $("fInd"); if (!f) return;
    f.onsubmit = async e => {
      e.preventDefault();
      const datos = { ...(st.manual[st.mes] || {}) };
      f.querySelectorAll("[data-k]").forEach(i => { const v = parseFloat(i.value); if (isFinite(v)) datos[i.dataset.k] = v; else delete datos[i.dataset.k]; });
      try { await q(sb.from("indicadores_manual").upsert({ mes: st.mes, datos, actualizado: new Date().toISOString() })); st.manual[st.mes] = datos; pintar(); toast("Guardado"); }
      catch (err) { say("i-status", "No se pudo guardar: " + err.message, true); }
    };
  }

  // Botones para cambiar entre el mes en curso y el historial del año.
  const modos = () => `<div class="ind-modos" role="tablist">
    <button data-modo="mes" ${st.modo === "mes" ? 'aria-current="page"' : ""}>Mes en curso</button>
    <button data-modo="anio" ${st.modo === "anio" ? 'aria-current="page"' : ""}>Historial del año</button></div>`;
  function bindModos(){
    document.querySelectorAll("[data-modo]").forEach(b => b.onclick = () => {
      st.modo = b.dataset.modo;
      if (st.modo === "mes" && st.meses[hoyMes()]) st.mes = hoyMes();
      pintar();
    });
  }
  const pintar = () => { st.modo === "anio" ? pintarAnio() : pintarMes(); bindModos(); };

  function pintarAnio(){
    const anios = [...new Set(Object.keys(st.meses).map(m => m.slice(0, 4)))].sort().reverse();
    const lista = Object.keys(st.meses).filter(m => m.startsWith(st.anio)).sort();
    const suma = k => lista.reduce((a, m) => a + (+st.meses[m][k] || 0), 0);
    const venta = suma("venta"), metas = lista.reduce((a, m) => a + (+(st.manual[m]?.meta_venta) || 0), 0);
    const ventaConMeta = lista.reduce((a, m) => a + (+(st.manual[m]?.meta_venta) ? st.meses[m].venta : 0), 0);
    const ps = suma("personas_salon"), vs = suma("venta_salon"), n = suma("ventas");
    const res = lista.reduce((a, m) => a + (+(st.manual[m]?.resenas_nuevas) || 0), 0);
    const fila = m => { const d = st.meses[m], man = st.manual[m] || {}, mv = +man.meta_venta || 0, mt = +man.meta_ticket || 0;
      return `<tr data-ir="${m}" class="ind-fila"><td>${nombreMes(m)}${d.cerrado ? "" : ' <span class="pill warn">en curso</span>'}</td>
        <td class="num">${mm(d.venta)}</td><td class="num">${mv ? `<span class="${d.venta >= mv ? "ok" : d.cerrado ? "bad" : ""}">${Math.round(d.venta / mv * 100)}%</span>` : "—"}</td>
        <td class="num">${d.ventas.toLocaleString("es-CL")}</td>
        <td class="num"><span class="${mt ? (d.ticket_persona >= mt ? "ok" : "bad") : ""}">${clp(d.ticket_persona)}</span></td>
        <td class="num">${pct(d.pct_con_entrada)}</td><td class="num">${pct(d.pct_postres)}</td>
        <td class="num">${d.panuozzo.u.toLocaleString("es-CL")}</td><td class="num">${clp(d.bebidas.margen)}</td>
        <td class="num">${man.resenas_nuevas ?? "—"}</td></tr>`; };
    $("vista").innerHTML = `${modos()}<div class="ind-top"><div><h2 style="margin:0">Historial ${esc(st.anio)}</h2>
        <p class="small muted">${lista.length} meses con datos · toca un mes para ver su detalle</p></div>
      ${anios.length > 1 ? `<select id="i-anio" aria-label="Año">${anios.map(a => `<option ${a === st.anio ? "selected" : ""}>${a}</option>`).join("")}</select>` : ""}</div>
      <div class="ind-grid">
        ${tarjeta("Venta del año", mm(venta), metas ? `<span class="small muted">En los meses con meta: ${mm(ventaConMeta)} de ${mm(metas)} (${Math.round(ventaConMeta / metas * 100)}%)</span>` : "")}
        ${tarjeta("Ticket por persona", clp(ps ? vs / ps : 0), `<span class="small muted">promedio del año, salón</span>`)}
        ${tarjeta("Cuentas", n.toLocaleString("es-CL"), `<span class="small muted">${clp(n ? venta / n : 0)} por cuenta</span>`)}
        ${tarjeta("Reseñas nuevas", res || "—", `<span class="small muted">según lo escrito cada mes</span>`)}
      </div>
      <div class="box" style="margin-top:14px"><h3 style="margin-top:0">Venta por mes</h3>${graficoMeses()}</div>
      <div class="box" style="margin-top:14px"><h3 style="margin-top:0">Mes a mes</h3><div class="tablewrap"><table>
        <thead><tr><th>Mes</th><th class="num">Venta</th><th class="num">Meta</th><th class="num">Cuentas</th><th class="num">Ticket/persona</th><th class="num">Con entrada</th><th class="num">Postres</th><th class="num">Panuozzo</th><th class="num">Margen bebidas</th><th class="num">Reseñas</th></tr></thead>
        <tbody>${lista.slice().reverse().map(fila).join("")}</tbody></table></div>
        <p class="small muted">Meta en verde si se cumplió. Ticket en verde si llegó al objetivo del mes. Fudo empezó a registrar el 12 de enero, así que enero está incompleto.</p></div>`;
    const sa = $("i-anio"); if (sa) sa.onchange = () => { st.anio = sa.value; pintar(); };
    document.querySelectorAll("[data-ir]").forEach(r => r.onclick = () => { st.mes = r.dataset.ir; st.modo = "mes"; pintar(); window.scrollTo(0, 0); });
  }

  async function vista(){
    if (!st.cargado) {
      $("vista").innerHTML = `<div class="loading" style="min-height:30vh">Cargando indicadores…</div>`;
      try { await cargar(); }
      catch (err) { $("vista").innerHTML = `<div class="box">No se pudieron cargar los indicadores: ${esc(err.message)}<p class="small muted">Si es la primera vez, falta correr supabase/migraciones/2026-11-15-indicadores.sql en Supabase.</p></div>`; return; }
    }
    pintar();
  }
  return { vista, st };
})();
