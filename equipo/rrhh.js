/* Cálculos de remuneraciones y vacaciones (Chile). Sin datos de personas: solo fórmulas. */
const RRHH = (() => {
  // Valores referenciales: se ajustan en la pestaña Parámetros cada mes.
  const PARAMETROS = {
    razon: "Rusti-Co.", rutEmpresa: "", uf: 39800, utm: 69500, imm: 539000,
    topeAfpUF: 89.9, topeAfcUF: 135.1, sis: 1.88, mutual: 0.93, reforma: 1.0,
    afp: { Capital: 1.44, Cuprum: 1.44, Habitat: 1.27, Modelo: 0.58, PlanVital: 1.26, Provida: 1.45, Uno: 0.46 }
  };
  // Impuesto único de segunda categoría, en UTM: [hasta, tasa, rebaja]
  const TRAMOS = [[13.5,0,0],[30,0.04,0.54],[50,0.08,1.74],[70,0.135,4.49],[90,0.23,11.14],[120,0.304,17.8],[310,0.35,23.32],[Infinity,0.4,38.82]];
  const CONTRATO = { indefinido: "Indefinido", plazo_fijo: "Plazo fijo", obra: "Obra o faena", sin_contrato: "Sin contrato" };
  const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  const clp = n => "$" + Math.round(n || 0).toLocaleString("es-CL");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mesNombre = m => { if (!m) return ""; const [y, mo] = m.split("-"); return MESES[+mo - 1] + " " + y; };
  const fecha = d => d ? d.split("-").reverse().join("-") : "—";
  const conParametros = d => ({ ...PARAMETROS, ...(d || {}), afp: { ...PARAMETROS.afp, ...((d && d.afp) || {}) } });

  function calcular(t, v, p) {
    const sueldo = +t.sueldo || 0, jornada = +t.jornada || 42;
    const base = Math.round(sueldo * v.dias / 30);
    const valorHora = sueldo / 30 * 28 / (jornada * 4);
    const hext = Math.round(valorHora * 1.5 * v.hext);
    const sub = base + hext + v.bonos;
    const topeGrat = Math.round(4.75 * p.imm / 12);
    const grat = t.grat === "no" ? 0 : Math.min(Math.round(sub * 0.25), topeGrat);
    const imponible = sub + grat;
    const baseAfp = Math.min(imponible, Math.round(p.topeAfpUF * p.uf));
    const tasaAfp = 10 + (p.afp[t.afp] ?? 0);
    const afp = Math.round(baseAfp * tasaAfp / 100);
    const salud7 = Math.round(baseAfp * 0.07);
    const plan = t.salud === "isapre" ? Math.round((+t.plan_uf || 0) * p.uf) : 0;
    const salud = Math.max(salud7, plan);
    const baseAfc = Math.min(imponible, Math.round(p.topeAfcUF * p.uf));
    const indef = t.contrato !== "plazo_fijo" && t.contrato !== "obra";
    const afc = indef ? Math.round(baseAfc * 0.006) : 0;
    const tributable = Math.max(0, imponible - afp - salud7 - afc);
    const tr = TRAMOS.find(r => tributable / p.utm <= r[0]);
    const impuesto = Math.max(0, Math.round(tributable * tr[1] - tr[2] * p.utm));
    const noImp = v.col + v.mov;
    const haberes = imponible + noImp;
    const descLegales = afp + salud + afc + impuesto;
    const otros = v.ant + v.otros;
    const sis = Math.round(baseAfp * p.sis / 100);
    const afcEmp = Math.round(baseAfc * (indef ? 2.4 : 3.0) / 100);
    const mutual = Math.round(imponible * p.mutual / 100);
    const reforma = Math.round(baseAfp * p.reforma / 100);
    const aportes = sis + afcEmp + mutual + reforma;
    return { base, valorHora, hext, grat, topeGrat, imponible, tasaAfp, afp, salud7, salud, afc, tributable, impuesto,
      noImp, haberes, descLegales, otros, liquido: haberes - descLegales - otros, sis, afcEmp, mutual, reforma, aportes, costo: haberes + aportes };
  }

  function mesesCompletos(desde, hasta) {
    const a = new Date(desde + "T00:00:00");
    let m = (hasta.getFullYear() - a.getFullYear()) * 12 + (hasta.getMonth() - a.getMonth());
    if (hasta.getDate() < a.getDate()) m--;
    return Math.max(0, m);
  }
  // vacs: registros del trabajador; cuentan solo los aprobados.
  function saldoVac(t, vacs) {
    if (!t.ingreso) return null;
    const meses = mesesCompletos(t.ingreso, new Date());
    const totalAnios = Math.min(10, +t.anios_previos || 0) + Math.floor(meses / 12);
    const progAnual = Math.max(0, Math.floor((totalAnios - 10) / 3));
    const acumulados = Math.round(meses * (15 + progAnual) / 12 * 100) / 100;
    const tomados = (+t.tomados_previos || 0) + vacs.filter(x => x.estado === "aprobada").reduce((s, x) => s + (+x.dias || 0), 0);
    return { acumulados, tomados, saldo: Math.round((acumulados - tomados) * 100) / 100, progAnual };
  }
  function diasHabiles(d1, d2) {
    if (!d1 || !d2) return 0;
    const a = new Date(d1 + "T00:00:00"), b = new Date(d2 + "T00:00:00");
    let n = 0;
    for (; a <= b; a.setDate(a.getDate() + 1)) { const w = a.getDay(); if (w !== 0 && w !== 6) n++; }
    return n;
  }

  function palabras(n) {
    n = Math.round(n);
    if (n <= 0) return "cero";
    const U = ["","uno","dos","tres","cuatro","cinco","seis","siete","ocho","nueve","diez","once","doce","trece","catorce","quince","dieciséis","diecisiete","dieciocho","diecinueve","veinte","veintiuno","veintidós","veintitrés","veinticuatro","veinticinco","veintiséis","veintisiete","veintiocho","veintinueve"];
    const D = ["","","","treinta","cuarenta","cincuenta","sesenta","setenta","ochenta","noventa"];
    const C = ["","ciento","doscientos","trescientos","cuatrocientos","quinientos","seiscientos","setecientos","ochocientos","novecientos"];
    const cien = x => { if (x === 100) return "cien"; const r = x % 100; let s = C[Math.floor(x / 100)]; if (r) s += (s ? " " : "") + (r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? " y " + U[r % 10] : "")); return s; };
    const mil = x => { const m = Math.floor(x / 1000), r = x % 1000; let s = m ? (m === 1 ? "mil" : cien(m).replace(/uno$/, "un") + " mil") : ""; if (r) s += (s ? " " : "") + cien(r); return s; };
    const mm = Math.floor(n / 1e6), r = n % 1e6;
    let s = mm ? (mm === 1 ? "un millón" : mil(mm).replace(/uno$/, "un") + " millones") : "";
    if (r) s += (s ? " " : "") + mil(r);
    return s;
  }

  // Documento de liquidación (HTML). costoEmpresa=false para la vista del trabajador.
  function liquidacionHTML(t, v, r, p, mes, vac, costoEmpresa) {
    const ln = (a, b, small) => `<div class="ln"><span>${a}${small ? ` <small>${small}</small>` : ""}</span><span class="num">${clp(b)}</span></div>`;
    const pct = x => x.toFixed(2).replace(".", ",") + "%";
    return `
      <div class="doc-head">
        <div><div class="doc-title">LIQUIDACIÓN DE REMUNERACIONES</div>
          <div class="emp">${esc(p.razon)}${p.rutEmpresa ? " · RUT " + esc(p.rutEmpresa) : ""}</div></div>
        <div class="periodo">Período<b>${esc(mesNombre(mes))}</b></div>
      </div>
      <div class="ident">
        <div><span>Nombre</span><b>${esc(t.nombre)}</b></div>
        <div><span>RUT</span>${esc(t.rut)}</div>
        <div><span>Cargo</span>${esc(t.cargo)}</div>
        <div><span>Contrato</span>${esc(CONTRATO[t.contrato] || "")}</div>
        <div><span>Ingreso</span>${fecha(t.ingreso)}</div>
        <div><span>Días trabajados</span>${v.dias}</div>
        <div><span>AFP</span>${esc(t.afp)} (${pct(r.tasaAfp)})</div>
        <div><span>Salud</span>${t.salud === "isapre" ? "Isapre " + (+t.plan_uf || 0) + " UF" : "Fonasa"}</div>
        ${t.lugar ? `<div class="wide"><span>Lugar de trabajo</span>${esc(t.lugar)}</div>` : ""}
      </div>
      <div class="cols">
        <div>
          <div class="sec">Haberes imponibles</div>
          ${ln("Sueldo base", r.base, v.dias < 30 ? `${v.dias}/30 días` : "")}
          ${v.hext ? ln("Horas extra", r.hext, `${v.hext} h × ${clp(r.valorHora * 1.5)}`) : ""}
          ${v.bonos ? ln("Bonos", v.bonos) : ""}
          ${r.grat ? ln("Gratificación legal", r.grat, r.grat === r.topeGrat ? "con tope" : "25%") : ""}
          <div class="ln tot"><span>Total imponible</span><span class="num">${clp(r.imponible)}</span></div>
          <div class="sec">Haberes no imponibles</div>
          ${ln("Colación", v.col)}
          ${ln("Movilización", v.mov)}
          <div class="ln tot"><span>Total haberes</span><span class="num">${clp(r.haberes)}</span></div>
        </div>
        <div>
          <div class="sec">Descuentos legales</div>
          ${ln("AFP " + esc(t.afp), r.afp, pct(r.tasaAfp))}
          ${ln(t.salud === "isapre" ? "Isapre" : "Fonasa", r.salud, t.salud === "isapre" && r.salud > r.salud7 ? "plan pactado" : "7%")}
          ${ln("Seguro de cesantía", r.afc, r.afc ? "0,6%" : "no aplica")}
          ${ln("Impuesto único", r.impuesto, r.impuesto ? "" : "exento")}
          <div class="ln tot"><span>Total descuentos legales</span><span class="num">${clp(r.descLegales)}</span></div>
          <div class="sec">Otros descuentos</div>
          ${ln("Anticipos", v.ant)}
          ${ln(v.otrosDet ? esc(v.otrosDet) : "Otros", v.otros)}
          <div class="ln tot"><span>Total descuentos</span><span class="num">${clp(r.descLegales + r.otros)}</span></div>
        </div>
      </div>
      <div class="liquido"><span>LÍQUIDO A PAGAR</span><b>${clp(r.liquido)}</b></div>
      <div class="palabras">Son: ${palabras(r.liquido)} pesos.</div>
      ${vac ? `<div class="vacline">Vacaciones: ${vac.acumulados.toLocaleString("es-CL")} días acumulados, ${vac.tomados.toLocaleString("es-CL")} tomados, saldo ${vac.saldo.toLocaleString("es-CL")} días hábiles.</div>` : ""}
      ${costoEmpresa && t.contrato === "sin_contrato" ? `<div class="alerta">Este trabajador no tiene contrato firmado. Conviene escriturarlo cuanto antes.</div>` : ""}
      ${costoEmpresa ? `<div class="costo">
        <div class="sec">Costo empresa (no se descuenta al trabajador)</div>
        ${ln("SIS", r.sis, p.sis + "%")}
        ${ln("Seguro de cesantía empleador", r.afcEmp)}
        ${ln("Mutual", r.mutual, p.mutual + "%")}
        ${ln("Aporte reforma previsional", r.reforma, p.reforma + "%")}
        <div class="ln tot"><span>Costo total del mes</span><span class="num">${clp(r.costo)}</span></div>
      </div>` : ""}
      <div class="firmas"><div>Firma empleador</div><div>Recibí conforme<br>${esc(t.nombre)}</div></div>`;
  }

  return { PARAMETROS, CONTRATO, clp, esc, mesNombre, fecha, conParametros, calcular, saldoVac, diasHabiles, palabras, liquidacionHTML };
})();
if (typeof module !== "undefined") module.exports = RRHH;
