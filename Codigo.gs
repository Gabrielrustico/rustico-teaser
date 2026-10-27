/**
 * Club Rusti-Co. — servidor del Club en Google Apps Script.
 *
 * Vive pegado a una hoja de cálculo de administracion@rusti-co.cl.
 *  - La web (rusti-co.cl/club) le habla por POST para registrar socios, mostrar su tarjeta y calificar.
 *  - El panel del local se abre en la misma URL con ?panel=1 y solo funciona para la cuenta dueña.
 *  - Cada hora revisa en Fudo las ventas cerradas con cliente asignado y suma sellos.
 *
 * Claves de Fudo: Configuración del proyecto → Propiedades de la secuencia de comandos →
 *   FUDO_API_KEY y FUDO_API_SECRET. Nunca se escriben en este archivo.
 */

const HOJA_ID = '1TBjZ3h6ynAh7clU1Hdj_uQqNqaTcY4bfi7UUJfjezDU'; // hoja "Club Rusti-Co." en el Drive de administracion@rusti-co.cl

/* ======================= Ajustes del Club ======================= */
const CLUB = {
  visitasParaPremio: 10,
  premio: '1 pizza gratis a elección',
  regaloCumpleanos: 'Postre gratis para el cumpleañero, o una Pizza Nutella por cada 6 personas en su mesa',
  bonoReferido: 1,              // visitas extra para ambos cuando el invitado hace su primera visita
  regaloReferido: '1 pisco sour de regalo', // para el invitado al registrarse y para quien invitó cuando el amigo viene
  diasRegalo: 60,               // vigencia de los regalos
  diasRiesgo: 30,               // activo ≤ 30 días; en riesgo 31–60; perdido > 60
  diasPerdido: 60,
  versionConsentimiento: '2026-10-25',
  enviarCorreoCalificar: true,  // correo "¿Cómo estuvo tu visita?" después de cada visita
  urlClub: 'https://www.rusti-co.cl/club/',
  zona: 'America/Santiago',
};
/* ================================================================ */

const HOJAS = {
  Socios: ['id', 'nombre', 'telefono', 'email', 'cumpleanos', 'codigo', 'referido_por', 'fudo_cliente_id',
    'sellos', 'visitas_total', 'ultima_visita', 'fecha_alta', 'acepta_promos', 'estado', 'token'],
  Visitas: ['fecha', 'socio_id', 'venta_fudo', 'origen', 'cuenta_sello', 'calificada', 'monto'],
  Consumos: ['fecha', 'socio_id', 'venta_fudo', 'producto', 'categoria', 'cantidad', 'precio', 'subtotal'],
  Canjes: ['fecha', 'socio_id', 'premio', 'registrado_por'],
  Calificaciones: ['fecha', 'socio_id', 'fecha_visita', 'estrellas', 'temas', 'comentario', 'contactado'],
  Promociones: ['id', 'titulo', 'detalle', 'para', 'hasta', 'novedad', 'foto', 'activa'],
  Consentimientos: ['fecha', 'socio_id', 'telefono', 'version', 'acepta_club', 'acepta_promos', 'mayor_18', 'canal', 'accion'],
  Campanas: ['fecha', 'segmento', 'socios', 'mensaje'],
  Registro: ['fecha', 'tipo', 'detalle'],
  Regalos: ['id', 'fecha', 'socio_id', 'regalo', 'motivo', 'vence', 'canjeado', 'canjeado_por'],
};

/* ---------------------------- Instalación ---------------------------- */

/** Correr una vez desde el editor: crea las pestañas y el disparador horario. */
function instalar() {
  const ss = SpreadsheetApp.openById(HOJA_ID);
  ss.rename('Club Rusti-Co.');
  Object.keys(HOJAS).forEach(nombre => {
    let sh = ss.getSheetByName(nombre);
    if (!sh) sh = ss.insertSheet(nombre);
    const enc = HOJAS[nombre];
    sh.getRange(1, 1, 1, enc.length).setValues([enc]).setFontWeight('bold').setBackground('#ffd700');
    sh.setFrozenRows(1);
    const prot = sh.protect().setDescription('Editado por el Club. Mirar, no editar a mano.');
    prot.setWarningOnly(true);
  });
  const hoja1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hoja1 && hoja1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(hoja1);
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizarFudo').timeBased().everyHours(1).create();
  log_('instalacion', 'Pestañas y disparador horario listos');
  return 'Listo';
}

/* ------------------------------ Web ------------------------------ */

function doGet(e) {
  if (e && e.parameter && e.parameter.panel) {
    return HtmlService.createTemplateFromFile('Panel').evaluate()
      .setTitle('Panel del Club Rusti-Co.')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }
  return json_({ ok: true, club: datosPublicos_() });
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return json_({ ok: false, error: 'Solicitud inválida.' }); }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const acciones = { registrar, pedirCodigo, verificarCodigo, miTarjeta, calificar, preferencias, eliminarme };
    const fn = acciones[body.accion];
    if (!fn) return json_({ ok: false, error: 'Acción desconocida.' });
    return json_(fn(body));
  } catch (err) {
    log_('error', String(err && err.stack || err));
    return json_({ ok: false, error: 'Hubo un problema. Intenta de nuevo en unos minutos.' });
  } finally {
    lock.releaseLock();
  }
}

/* -------------------------- Acciones del cliente -------------------------- */

function registrar(b) {
  const nombre = limpiar_(b.nombre, 80);
  const telefono = normTel_(b.telefono);
  const email = limpiar_(b.email, 90).toLowerCase();
  const cumple = /^\d{4}-\d{2}-\d{2}$/.test(b.cumpleanos || '') ? b.cumpleanos : '';
  if (nombre.split(' ').filter(Boolean).length < 2) return { ok: false, error: 'Escribe tu nombre y apellido.' };
  if (!telefono) return { ok: false, error: 'Revisa tu teléfono: usa un celular chileno, por ejemplo +56 9 1234 5678.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Revisa tu correo. Lo usamos para enviarte tu código de acceso.' };
  if (b.acepta_club !== true) return { ok: false, error: 'Para unirte al Club necesitamos tu autorización para usar tus datos.' };
  if (b.mayor_18 !== true) return { ok: false, error: 'El Club es solo para mayores de 18 años.' };

  const existente = buscarSocio_('telefono', telefono);
  if (existente && existente.estado !== 'eliminado') {
    const r = enviarCodigo_(existente);
    return { ok: true, yaExiste: true, mensaje: 'Ya eres socio. Te enviamos un código a ' + r + ' para entrar a tu tarjeta.' };
  }

  const id = 'S' + Utilities.getUuid().slice(0, 8).toUpperCase();
  const codigo = codigoReferido_(nombre);
  const refCodigo = limpiar_(b.referido, 30).toUpperCase();
  const referente = refCodigo ? buscarSocio_('codigo', refCodigo) : null;
  const token = Utilities.getUuid() + Utilities.getUuid();
  const ahora = new Date();
  agregar_('Socios', {
    id, nombre, telefono, email, cumpleanos: cumple, codigo,
    referido_por: referente ? referente.id : '', fudo_cliente_id: '',
    sellos: 0, visitas_total: 0, ultima_visita: '', fecha_alta: ahora,
    acepta_promos: b.acepta_promos === true ? 'si' : 'no', estado: 'activo', token: hash_(token),
  });
  agregar_('Consentimientos', {
    fecha: ahora, socio_id: id, telefono, version: CLUB.versionConsentimiento,
    acepta_club: 'si', acepta_promos: b.acepta_promos === true ? 'si' : 'no', mayor_18: 'si',
    canal: 'web rusti-co.cl/club', accion: 'alta',
  });
  if (referente) darRegalo_(id, CLUB.regaloReferido, 'Bienvenida: te invitó ' + referente.nombre.split(' ')[0]);
  try { crearClienteFudo_(id); } catch (err) { log_('fudo', 'No se pudo crear el cliente ' + id + ' en Fudo: ' + err); }
  return { ok: true, token, tarjeta: tarjeta_(buscarSocio_('id', id)), regaloBienvenida: !!referente };
}

function pedirCodigo(b) {
  const s = buscarSocio_('telefono', normTel_(b.telefono));
  if (!s || s.estado === 'eliminado') return { ok: false, error: 'No encontramos ese teléfono en el Club. Regístrate para crear tu tarjeta.' };
  return { ok: true, mensaje: 'Te enviamos un código de 6 dígitos a ' + enviarCodigo_(s) + '.' };
}

function verificarCodigo(b) {
  const tel = normTel_(b.telefono);
  const guardado = CacheService.getScriptCache().get('code_' + tel);
  if (!guardado || guardado !== String(b.codigo || '').trim()) return { ok: false, error: 'El código no es correcto o ya venció. Pide uno nuevo.' };
  CacheService.getScriptCache().remove('code_' + tel);
  const s = buscarSocio_('telefono', tel);
  const token = Utilities.getUuid() + Utilities.getUuid();
  actualizar_('Socios', s._fila, { token: hash_(token) });
  return { ok: true, token, tarjeta: tarjeta_(buscarSocio_('id', s.id)) };
}

function miTarjeta(b) {
  const s = socioPorToken_(b.token);
  if (!s) return { ok: false, sesion: false, error: 'Tu sesión venció. Entra con tu teléfono.' };
  return { ok: true, tarjeta: tarjeta_(s) };
}

function calificar(b) {
  const s = socioPorToken_(b.token);
  if (!s) return { ok: false, sesion: false, error: 'Tu sesión venció. Entra con tu teléfono.' };
  const estrellas = Math.max(1, Math.min(5, parseInt(b.estrellas, 10) || 0));
  const pendiente = visitaPendiente_(s.id);
  if (!pendiente) return { ok: false, error: 'No tienes visitas por calificar.' };
  actualizar_('Visitas', pendiente._fila, { calificada: 'si' });
  agregar_('Calificaciones', {
    fecha: new Date(), socio_id: s.id, fecha_visita: pendiente.fecha, estrellas,
    temas: (b.temas || []).map(t => limpiar_(t, 30)).join(', '), comentario: limpiar_(b.comentario, 500),
    contactado: estrellas <= 3 ? 'pendiente' : '',
  });
  if (estrellas <= 3) avisarCalificacionBaja_(s, estrellas, b.comentario);
  return { ok: true, estrellas };
}

function preferencias(b) {
  const s = socioPorToken_(b.token);
  if (!s) return { ok: false, sesion: false, error: 'Tu sesión venció. Entra con tu teléfono.' };
  const acepta = b.acepta_promos === true ? 'si' : 'no';
  actualizar_('Socios', s._fila, { acepta_promos: acepta });
  agregar_('Consentimientos', {
    fecha: new Date(), socio_id: s.id, telefono: s.telefono, version: CLUB.versionConsentimiento,
    acepta_club: 'si', acepta_promos: acepta, mayor_18: 'si', canal: 'web rusti-co.cl/club',
    accion: acepta === 'si' ? 'acepta promociones' : 'retira promociones',
  });
  return { ok: true, tarjeta: tarjeta_(buscarSocio_('id', s.id)) };
}

/** Retiro del consentimiento: se borran los datos personales y queda solo el registro anónimo. */
function eliminarme(b) {
  const s = socioPorToken_(b.token);
  if (!s) return { ok: false, sesion: false, error: 'Tu sesión venció. Entra con tu teléfono.' };
  eliminarSocio_(s, 'web rusti-co.cl/club');
  return { ok: true };
}

/* ---------------------------- Panel del local ---------------------------- */

function soloDueno_() {
  const yo = Session.getActiveUser().getEmail();
  const dueno = Session.getEffectiveUser().getEmail();
  if (!yo || yo !== dueno) throw new Error('Solo la cuenta del local puede usar el panel.');
}

function panelDatos() {
  soloDueno_();
  const socios = leer_('Socios').filter(s => s.estado !== 'eliminado').map(s => ({
    id: s.id, nombre: s.nombre, telefono: s.telefono, email: s.email, cumpleanos: fechaTxt_(s.cumpleanos),
    codigo: s.codigo, sellos: Number(s.sellos) || 0, visitas: Number(s.visitas_total) || 0,
    ultima: fechaTxt_(s.ultima_visita), alta: fechaTxt_(s.fecha_alta), promos: s.acepta_promos === 'si',
    fudo: !!s.fudo_cliente_id, segmento: segmento_(s), regalos: regalosPendientes_(s.id),
  }));
  const gu = gustos_();
  socios.forEach(s => s.gustos = gu.porSocio[s.id] || { top: [], pizza: '', bebida: '', gasto: 0, ticket: 0 });
  const nombres = {}; socios.forEach(s => nombres[s.id] = s);
  const calif = leer_('Calificaciones').map(c => ({
    fila: c._fila, fecha: fechaTxt_(c.fecha), socio: (nombres[c.socio_id] || {}).nombre || 'Ex socio',
    telefono: (nombres[c.socio_id] || {}).telefono || '', estrellas: Number(c.estrellas), temas: c.temas,
    comentario: c.comentario, contactado: c.contactado,
  })).reverse();
  const promos = leer_('Promociones').filter(p => p.activa === 'si').map(p => ({
    id: p.id, titulo: p.titulo, detalle: p.detalle, para: p.para, hasta: fechaTxt_(p.hasta), novedad: p.novedad === 'si', foto: p.foto,
  }));
  const campanas = leer_('Campanas').slice(-6).reverse().map(c => ({ fecha: fechaTxt_(c.fecha), segmento: c.segmento, socios: c.socios }));
  const mes = Utilities.formatDate(new Date(), CLUB.zona, 'yyyy-MM');
  const visitasMes = leer_('Visitas').filter(v => fechaTxt_(v.fecha).slice(0, 7) === mes && v.cuenta_sello === 'si').length;
  const ultimoSync = PropertiesService.getScriptProperties().getProperty('ULTIMO_SYNC') || '';
  const gastoMes = leer_('Visitas').filter(v => fechaTxt_(v.fecha).slice(0, 7) === mes && !isNaN(Number(v.monto)) && v.monto !== '').reduce((t, v) => t + Number(v.monto), 0);
  return { club: CLUB, socios, calif, promos, campanas, visitasMes, gastoMes, ranking: gu.ranking, ultimoSync, fudoConfigurado: !!credencialesFudo_() };
}

function panelSumarVisita(id) {
  soloDueno_();
  const s = buscarSocio_('id', id);
  if (!s) throw new Error('Socio no encontrado.');
  const r = sumarVisita_(s, '', 'manual (panel)');
  return r;
}

function panelCanjear(id) {
  soloDueno_();
  const s = buscarSocio_('id', id);
  if (Number(s.sellos) < CLUB.visitasParaPremio) throw new Error('Este socio aún no completa su tarjeta.');
  actualizar_('Socios', s._fila, { sellos: 0 });
  agregar_('Canjes', { fecha: new Date(), socio_id: s.id, premio: CLUB.premio, registrado_por: Session.getActiveUser().getEmail() });
  return 'Premio canjeado. La tarjeta de ' + s.nombre.split(' ')[0] + ' vuelve a 0.';
}

function panelCanjearRegalo(regaloId) {
  soloDueno_();
  const r = leer_('Regalos').find(x => x.id === regaloId);
  if (!r || r.canjeado) throw new Error('Ese regalo ya fue canjeado o no existe.');
  actualizar_('Regalos', r._fila, { canjeado: new Date(), canjeado_por: Session.getActiveUser().getEmail() });
  return 'Regalo canjeado: ' + r.regalo + '.';
}

function panelContactado(fila) {
  soloDueno_();
  actualizar_('Calificaciones', fila, { contactado: 'si' });
  return 'Marcado como contactado.';
}

function panelGuardarPromo(p) {
  soloDueno_();
  if (!p.titulo || !p.detalle) throw new Error('Completa el título y el detalle.');
  agregar_('Promociones', {
    id: 'P' + Date.now(), titulo: limpiar_(p.titulo, 80), detalle: limpiar_(p.detalle, 300),
    para: p.para === 'En riesgo' ? 'En riesgo' : 'Socios', hasta: p.hasta || '', novedad: p.novedad ? 'si' : 'no',
    foto: limpiar_(p.foto, 40) || 'schop', activa: 'si',
  });
  return 'Publicada. Ya aparece en la app de los socios.';
}

function panelQuitarPromo(id) {
  soloDueno_();
  const p = leer_('Promociones').find(x => x.id === id);
  if (p) actualizar_('Promociones', p._fila, { activa: 'no' });
  return 'Promoción quitada.';
}

function panelRegistrarCampana(segmento, n, mensaje) {
  soloDueno_();
  agregar_('Campanas', { fecha: new Date(), segmento, socios: n, mensaje: limpiar_(mensaje, 500) });
  return 'Registrado.';
}

function panelSincronizar() {
  soloDueno_();
  return sincronizarFudo();
}

function panelEliminarSocio(id) {
  soloDueno_();
  const s = buscarSocio_('id', id);
  if (s) eliminarSocio_(s, 'solicitud al local (' + Session.getActiveUser().getEmail() + ')');
  return 'Datos personales eliminados.';
}

/* ------------------------------- Fudo ------------------------------- */

function credencialesFudo_() {
  const p = PropertiesService.getScriptProperties();
  const k = p.getProperty('FUDO_API_KEY'), s = p.getProperty('FUDO_API_SECRET');
  return k && s ? { apiKey: k, apiSecret: s } : null;
}

function tokenFudo_() {
  const cache = CacheService.getScriptCache();
  const t = cache.get('fudo_token');
  if (t) return t;
  const cred = credencialesFudo_();
  if (!cred) throw new Error('Faltan FUDO_API_KEY y FUDO_API_SECRET en las propiedades del proyecto.');
  const r = UrlFetchApp.fetch('https://auth.fu.do/api', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(cred),
    headers: { Accept: 'application/json' }, muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) throw new Error('Fudo rechazó las claves (' + r.getResponseCode() + ').');
  const token = JSON.parse(r.getContentText()).token;
  cache.put('fudo_token', token, 6 * 3600);
  return token;
}

function fudo_(metodo, ruta, cuerpo) {
  const opt = {
    method: metodo, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + tokenFudo_(), Accept: 'application/json' },
  };
  if (cuerpo) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(cuerpo); }
  const r = UrlFetchApp.fetch('https://api.fu.do/v1alpha1' + ruta, opt);
  const code = r.getResponseCode();
  const txt = r.getContentText();
  if (code >= 300) throw new Error('Fudo ' + metodo.toUpperCase() + ' ' + ruta + ' → ' + code + ': ' + txt.slice(0, 300));
  return txt ? JSON.parse(txt) : {};
}

function medioPagoFudo_() {
  const p = PropertiesService.getScriptProperties();
  let id = p.getProperty('FUDO_MEDIO_PAGO');
  if (id) return id;
  const medios = fudo_('get', '/payment-methods?page[size]=100').data || [];
  const efectivo = medios.find(m => /efectivo|cash/i.test((m.attributes || {}).name || '')) || medios[0];
  if (!efectivo) throw new Error('Fudo no devolvió medios de pago.');
  p.setProperty('FUDO_MEDIO_PAGO', efectivo.id);
  return efectivo.id;
}

/** Crea al socio como cliente en Fudo. El nombre lleva los 4 últimos dígitos para que el garzón lo encuentre y no se repita. */
function crearClienteFudo_(socioId) {
  if (!credencialesFudo_()) return;
  const s = buscarSocio_('id', socioId);
  if (!s || s.fudo_cliente_id) return;
  const nombreFudo = (s.nombre + ' · ' + String(s.telefono).slice(-4)).slice(0, 90);
  const attrs = { name: nombreFudo, phone: s.telefono, email: s.email, comment: 'Club Rusti-Co. ' + s.codigo };
  if (s.cumpleanos) attrs.birthDate = fechaTxt_(s.cumpleanos);
  const r = fudo_('post', '/customers', {
    data: { type: 'Customer', attributes: attrs,
      relationships: { paymentMethod: { data: { type: 'PaymentMethod', id: String(medioPagoFudo_()) } } } },
  });
  actualizar_('Socios', s._fila, { fudo_cliente_id: r.data.id });
  log_('fudo', 'Cliente creado en Fudo: ' + nombreFudo + ' (' + r.data.id + ')');
}

/**
 * Corre cada hora: lee en Fudo las ventas cerradas de las últimas 36 horas que tienen cliente,
 * y suma una visita al socio (máximo una por día).
 */
function sincronizarFudo() {
  if (!credencialesFudo_()) return 'Fudo no está configurado todavía.';
  // Reintenta crear en Fudo a los socios que quedaron pendientes.
  leer_('Socios').filter(s => s.estado === 'activo' && !s.fudo_cliente_id).slice(0, 10).forEach(s => {
    try { crearClienteFudo_(s.id); } catch (err) { log_('fudo', 'Pendiente ' + s.id + ': ' + err); }
  });
  const desde = new Date(Date.now() - 36 * 3600 * 1000).toISOString().slice(0, 19) + 'Z';
  const hasta = new Date().toISOString().slice(0, 19) + 'Z';
  const porFudo = {};
  leer_('Socios').forEach(s => { if (s.fudo_cliente_id && s.estado === 'activo') porFudo[String(s.fudo_cliente_id)] = s; });
  const vistas = {};
  leer_('Visitas').forEach(v => { if (v.venta_fudo) vistas[String(v.venta_fudo)] = true; });
  let pagina = 1, nuevas = 0, revisadas = 0;
  while (pagina < 20) {
    const res = fudo_('get', '/sales?filter[createdAt]=' + encodeURIComponent('and(gte.' + desde + ',lte.' + hasta + ')') +
      '&page[size]=500&page[number]=' + pagina);
    const ventas = res.data || [];
    ventas.forEach(v => {
      revisadas++;
      const a = v.attributes || {};
      const cliente = (((v.relationships || {}).customer || {}).data || {}).id;
      const cerrada = a.saleState ? a.saleState === 'CLOSED' : !!a.closedAt;
      if (!cliente || !cerrada || vistas[String(v.id)]) return;
      const s = porFudo[String(cliente)];
      if (!s) return;
      sumarVisita_(buscarSocio_('id', s.id), String(v.id), 'fudo', a.closedAt ? new Date(a.closedAt) : new Date());
      vistas[String(v.id)] = true;
      nuevas++;
    });
    if (ventas.length < 500) break;
    pagina++;
  }
  const conDetalle = completarConsumos_(40);
  limpiarInactivos_();
  const msg = 'Fudo: ' + revisadas + ' ventas revisadas, ' + nuevas + ' visitas nuevas de socios' + (conDetalle ? ', ' + conDetalle + ' consumos guardados' : '') + '.';
  PropertiesService.getScriptProperties().setProperty('ULTIMO_SYNC', Utilities.formatDate(new Date(), CLUB.zona, 'dd-MM-yyyy HH:mm') + ' · ' + msg);
  if (nuevas) log_('sync', msg);
  return msg;
}

/**
 * Guarda el monto y los productos de las visitas de socios que vienen de Fudo.
 * Revisa las visitas que todavía no tienen monto (así también recupera las anteriores).
 */
function completarConsumos_(max) {
  const pendientes = leer_('Visitas').filter(v => v.venta_fudo && v.monto === '' && v.socio_id).slice(0, max || 40);
  if (!pendientes.length) return 0;
  const yaGuardadas = {};
  leer_('Consumos').forEach(c => yaGuardadas[String(c.venta_fudo)] = true);
  let n = 0;
  pendientes.forEach(v => {
    try {
      const d = detalleVentaFudo_(v.venta_fudo);
      if (!yaGuardadas[String(v.venta_fudo)]) {
        d.lineas.forEach(l => agregar_('Consumos', {
          fecha: v.fecha, socio_id: v.socio_id, venta_fudo: String(v.venta_fudo), producto: l.producto,
          categoria: l.categoria, cantidad: l.cantidad, precio: l.precio, subtotal: l.cantidad * l.precio,
        }));
        yaGuardadas[String(v.venta_fudo)] = true;
      }
      actualizar_('Visitas', v._fila, { monto: d.total });
      n++;
    } catch (err) {
      log_('fudo', 'Detalle de venta ' + v.venta_fudo + ': ' + err);
      if (/→ 404/.test(String(err))) actualizar_('Visitas', v._fila, { monto: 'sin datos' });
    }
  });
  return n;
}

function detalleVentaFudo_(id) {
  let r;
  try { r = fudo_('get', '/sales/' + id + '?include=items.product.productCategory'); }
  catch (err) { r = fudo_('get', '/sales/' + id + '?include=items.product'); }
  const inc = r.included || [];
  const porTipo = t => { const m = {}; inc.filter(x => x.type === t).forEach(x => m[x.id] = x); return m; };
  const productos = porTipo('Product'), categorias = porTipo('ProductCategory');
  const rel = (o, k) => ((((o || {}).relationships || {})[k] || {}).data || {}).id;
  const lineas = inc.filter(x => x.type === 'Item' && !(x.attributes || {}).canceled).map(it => {
    const a = it.attributes || {};
    const p = productos[rel(it, 'product')] || {};
    const c = categorias[rel(p, 'productCategory')] || {};
    return {
      producto: (p.attributes || {}).name || 'Producto ' + (rel(it, 'product') || '?'),
      categoria: (c.attributes || {}).name || '',
      cantidad: Number(a.quantity) || 1,
      precio: Number(a.price) || 0,
    };
  });
  const total = Number(((r.data || {}).attributes || {}).total);
  return { total: isNaN(total) ? lineas.reduce((t, l) => t + l.cantidad * l.precio, 0) : total, lineas };
}

/** Correr una vez desde el editor: guarda montos y productos de todas las visitas anteriores. */
function recuperarConsumos() {
  let total = 0, n;
  do { n = completarConsumos_(40); total += n; } while (n > 0 && total < 1000);
  Logger.log('Visitas completadas con su consumo: ' + total);
  return total;
}

/** Gustos de cada socio a partir de la pestaña Consumos. */
function gustos_() {
  const g = {};
  const top = (m, k) => Object.keys(m).sort((a, b) => m[b] - m[a]).slice(0, k);
  leer_('Consumos').forEach(c => {
    const s = g[c.socio_id] = g[c.socio_id] || { prod: {}, pizza: {}, bebida: {} };
    const q = Number(c.cantidad) || 1, cat = String(c.categoria || '').toLowerCase(), nom = String(c.producto);
    s.prod[nom] = (s.prod[nom] || 0) + q;
    if (/pizza/.test(cat) || /^pizza/i.test(nom)) s.pizza[nom] = (s.pizza[nom] || 0) + q;
    else if (/bebida|cerveza|schop|coctel|cóctel|cocteler|trago|vino|jugo|limonada|alcohol|bar/.test(cat) ||
      /schop|cerveza|coca|fanta|sprite|jugo|limonada|sour|spritz|mojito|gin|vino|agua|red bull|negroni|caf[eé]|kunstmann|cocholgue|fuzz/i.test(nom)) s.bebida[nom] = (s.bebida[nom] || 0) + q;
  });
  const gasto = {};
  leer_('Visitas').forEach(v => {
    const m = Number(v.monto);
    if (v.monto === '' || isNaN(m)) return;
    const x = gasto[v.socio_id] = gasto[v.socio_id] || { total: 0, n: 0 };
    x.total += m; x.n++;
  });
  const out = {};
  Object.keys(g).concat(Object.keys(gasto)).forEach(id => {
    const s = g[id] || { prod: {}, pizza: {}, bebida: {} }, x = gasto[id] || { total: 0, n: 0 };
    out[id] = {
      top: top(s.prod, 3).map(p => p + ' (' + s.prod[p] + ')'),
      pizza: top(s.pizza, 1)[0] || '', bebida: top(s.bebida, 1)[0] || '',
      gasto: x.total, ticket: x.n ? Math.round(x.total / x.n) : 0,
    };
  });
  const global = {};
  leer_('Consumos').forEach(c => global[c.producto] = (global[c.producto] || 0) + (Number(c.cantidad) || 1));
  return { porSocio: out, ranking: top(global, 10).map(p => ({ producto: p, cantidad: global[p] })) };
}

/** Repara teléfonos que Sheets guardó como fórmula (#ERROR!) y corrige el cliente en Fudo. Correr desde el editor. */
function repararTelefonos() {
  const sh = hoja_('Socios');
  const col = HOJAS.Socios.indexOf('telefono') + 1;
  const filas = sh.getLastRow();
  if (filas < 2) return 'Sin socios.';
  const formulas = sh.getRange(2, col, filas - 1, 1).getFormulas();
  const out = [];
  formulas.forEach((f, i) => {
    if (!f[0]) return;
    const tel = normTel_(f[0].replace(/^=/, ''));
    const fila = i + 2;
    sh.getRange(fila, col).setValue(tel ? "'" + tel : '');
    const s = leer_('Socios').find(x => x._fila === fila);
    out.push(s.nombre + ' → ' + (tel || 'sin teléfono válido'));
    if (s.fudo_cliente_id && tel && credencialesFudo_()) {
      try {
        fudo_('patch', '/customers/' + s.fudo_cliente_id, { data: { id: String(s.fudo_cliente_id), type: 'Customer',
          attributes: { name: (s.nombre + ' · ' + tel.slice(-4)).slice(0, 90), phone: tel },
          relationships: { paymentMethod: { data: { type: 'PaymentMethod', id: String(medioPagoFudo_()) } } } } });
        out.push('  Fudo corregido');
      } catch (err) { out.push('  Fudo: ' + err); }
    }
  });
  Logger.log(out.join('\n') || 'Nada que reparar');
  return out.join('\n') || 'Nada que reparar';
}

/** Para revisar cómo viene una venta de Fudo (correr desde el editor y mirar el registro de ejecución). */
function probarFudo() {
  const r = fudo_('get', '/sales?page[size]=3&sort=-id');
  Logger.log(JSON.stringify(r.data && r.data[0], null, 1));
  const c = fudo_('get', '/customers?page[size]=1');
  Logger.log(JSON.stringify(c.data && c.data[0], null, 1));
  return 'Revisa el registro de ejecución.';
}

/* ------------------------------ Lógica ------------------------------ */

function sumarVisita_(s, ventaFudo, origen, cuando) {
  cuando = cuando || new Date();
  const dia = Utilities.formatDate(cuando, CLUB.zona, 'yyyy-MM-dd');
  const yaHoy = fechaTxt_(s.ultima_visita) === dia;
  agregar_('Visitas', { fecha: cuando, socio_id: s.id, venta_fudo: ventaFudo, origen, cuenta_sello: yaHoy ? 'no' : 'si', calificada: yaHoy ? 'si' : '' });
  if (yaHoy) return 'Ya tenía su visita de hoy. No se suma otro sello.';
  const total = (Number(s.visitas_total) || 0) + 1;
  let sellos = Math.min((Number(s.sellos) || 0) + 1, CLUB.visitasParaPremio);
  if (total === 1 && s.referido_por) {
    sellos = Math.min(sellos + CLUB.bonoReferido, CLUB.visitasParaPremio);
    const ref = buscarSocio_('id', s.referido_por);
    if (ref && ref.estado === 'activo') {
      actualizar_('Socios', ref._fila, { sellos: Math.min((Number(ref.sellos) || 0) + CLUB.bonoReferido, CLUB.visitasParaPremio) });
      darRegalo_(ref.id, CLUB.regaloReferido, 'Tu amigo ' + s.nombre.split(' ')[0] + ' vino por primera vez');
    }
  }
  actualizar_('Socios', s._fila, { sellos, visitas_total: total, ultima_visita: cuando });
  if (CLUB.enviarCorreoCalificar && s.email) {
    try {
      MailApp.sendEmail({
        to: s.email, name: 'Rusti-Co.', subject: '¿Cómo estuvo tu visita a Rusti-Co.?',
        htmlBody: '<p>Hola ' + esc_(s.nombre.split(' ')[0]) + ',</p><p>Sumaste un sello: llevas <b>' + sellos + ' de ' + CLUB.visitasParaPremio +
          '</b> para tu ' + esc_(CLUB.premio) + '.</p><p>¿Nos cuentas cómo estuvo todo? Toma 10 segundos: <a href="' + CLUB.urlClub + '">califica tu visita</a>.</p><p>Rusti-Co. · Momentos que saben bien</p>',
      });
    } catch (err) { log_('correo', String(err)); }
  }
  return sellos >= CLUB.visitasParaPremio ? '¡' + s.nombre.split(' ')[0] + ' completó su tarjeta!' : 'Visita sumada: ' + sellos + ' de ' + CLUB.visitasParaPremio + '.';
}

function eliminarSocio_(s, canal) {
  if (s.fudo_cliente_id && credencialesFudo_()) {
    try { fudo_('patch', '/customers/' + s.fudo_cliente_id, { data: { id: String(s.fudo_cliente_id), type: 'Customer', attributes: { active: false, email: null, phone: null, birthDate: null }, relationships: { paymentMethod: { data: { type: 'PaymentMethod', id: String(medioPagoFudo_()) } } } } }); }
    catch (err) { log_('fudo', 'No se pudo desactivar en Fudo ' + s.id + ': ' + err); }
  }
  actualizar_('Socios', s._fila, { nombre: 'Eliminado', telefono: '', email: '', cumpleanos: '', estado: 'eliminado', token: '', acepta_promos: 'no' });
  agregar_('Consentimientos', { fecha: new Date(), socio_id: s.id, telefono: '', version: CLUB.versionConsentimiento, acepta_club: 'no', acepta_promos: 'no', mayor_18: '', canal, accion: 'retira consentimiento y elimina datos' });
}

function darRegalo_(socioId, regalo, motivo) {
  const vence = new Date(Date.now() + CLUB.diasRegalo * 864e5);
  agregar_('Regalos', { id: 'R' + Utilities.getUuid().slice(0, 8).toUpperCase(), fecha: new Date(), socio_id: socioId, regalo, motivo, vence, canjeado: '', canjeado_por: '' });
}

function regalosPendientes_(socioId) {
  const hoy = Utilities.formatDate(new Date(), CLUB.zona, 'yyyy-MM-dd');
  return leer_('Regalos').filter(r => r.socio_id === socioId && !r.canjeado && fechaTxt_(r.vence) >= hoy)
    .map(r => ({ id: r.id, regalo: r.regalo, motivo: r.motivo, vence: fechaTxt_(r.vence) }));
}

/** Una vez al día: elimina los datos de socios sin visitas en 24 meses (lo promete la política de privacidad). */
function limpiarInactivos_() {
  const p = PropertiesService.getScriptProperties();
  const hoy = Utilities.formatDate(new Date(), CLUB.zona, 'yyyy-MM-dd');
  if (p.getProperty('ULTIMA_LIMPIEZA') === hoy) return;
  p.setProperty('ULTIMA_LIMPIEZA', hoy);
  const limite = Date.now() - 730 * 864e5;
  leer_('Socios').filter(s => s.estado === 'activo').forEach(s => {
    const ref = new Date(s.ultima_visita || s.fecha_alta).getTime();
    if (ref && ref < limite) eliminarSocio_(s, 'eliminación automática por 24 meses sin visitas');
  });
}

function visitaPendiente_(socioId) {
  const limite = Date.now() - 7 * 864e5;
  const vs = leer_('Visitas').filter(v => v.socio_id === socioId && v.cuenta_sello === 'si' && v.calificada !== 'si' && new Date(v.fecha).getTime() > limite);
  return vs.length ? vs[vs.length - 1] : null;
}

function tarjeta_(s) {
  const visitas = leer_('Visitas').filter(v => v.socio_id === s.id && v.cuenta_sello === 'si').map(v => fechaTxt_(v.fecha)).reverse().slice(0, 8);
  const pend = visitaPendiente_(s.id);
  return {
    nombre: s.nombre, telefono: s.telefono, email: s.email, codigo: s.codigo, sellos: Number(s.sellos) || 0,
    visitasTotal: Number(s.visitas_total) || 0, alta: fechaTxt_(s.fecha_alta), cumpleanos: fechaTxt_(s.cumpleanos),
    aceptaPromos: s.acepta_promos === 'si', visitas, calificarVisita: pend ? fechaTxt_(pend.fecha) : null,
    segmento: segmento_(s), club: datosPublicos_(segmento_(s)), regalos: regalosPendientes_(s.id),
  };
}

function datosPublicos_(segmento) {
  const hoy = Utilities.formatDate(new Date(), CLUB.zona, 'yyyy-MM-dd');
  const promos = leer_('Promociones').filter(p => p.activa === 'si' && (!p.hasta || fechaTxt_(p.hasta) >= hoy))
    .filter(p => p.para !== 'En riesgo' || segmento === 'risk')
    .map(p => ({ titulo: p.titulo, detalle: p.detalle, hasta: fechaTxt_(p.hasta), novedad: p.novedad === 'si', foto: p.foto }));
  return { visitasParaPremio: CLUB.visitasParaPremio, premio: CLUB.premio, regaloCumpleanos: CLUB.regaloCumpleanos, bonoReferido: CLUB.bonoReferido, regaloReferido: CLUB.regaloReferido, promos };
}

function segmento_(s) {
  const uv = s.ultima_visita ? new Date(s.ultima_visita) : null;
  if (!uv) return 'new';
  const dias = Math.floor((Date.now() - uv.getTime()) / 864e5);
  if ((Number(s.visitas_total) || 0) <= 1 && dias <= CLUB.diasRiesgo) return 'new';
  if (dias <= CLUB.diasRiesgo) return 'active';
  if (dias <= CLUB.diasPerdido) return 'risk';
  return 'lost';
}

function enviarCodigo_(s) {
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  CacheService.getScriptCache().put('code_' + s.telefono, codigo, 600);
  MailApp.sendEmail({
    to: s.email, name: 'Rusti-Co.', subject: 'Tu código del Club Rusti-Co.: ' + codigo,
    htmlBody: '<p>Tu código para entrar al Club Rusti-Co. es:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">' + codigo +
      '</p><p>Vence en 10 minutos. Si no lo pediste, ignora este correo.</p>',
  });
  const [u, d] = s.email.split('@');
  return u.slice(0, 2) + '•••@' + d;
}

function avisarCalificacionBaja_(s, estrellas, comentario) {
  try {
    MailApp.sendEmail({
      to: Session.getEffectiveUser().getEmail(), name: 'Club Rusti-Co.',
      subject: 'Calificación de ' + estrellas + ' estrella' + (estrellas > 1 ? 's' : '') + ': ' + s.nombre,
      htmlBody: '<p><b>' + esc_(s.nombre) + '</b> (' + esc_(s.telefono) + ') calificó su visita con ' + estrellas + ' de 5.</p>' +
        (comentario ? '<p>“' + esc_(comentario) + '”</p>' : '') + '<p>Contáctalo pronto y márcalo como contactado en el panel.</p>',
    });
  } catch (err) { log_('correo', String(err)); }
}

/* ------------------------------ Hojas ------------------------------ */

let ss__ = null;
function hoja_(n) {
  ss__ = ss__ || SpreadsheetApp.openById(HOJA_ID);
  let sh = ss__.getSheetByName(n);
  if (!sh && HOJAS[n]) {
    sh = ss__.insertSheet(n);
    sh.getRange(1, 1, 1, HOJAS[n].length).setValues([HOJAS[n]]).setFontWeight('bold').setBackground('#ffd700');
    sh.setFrozenRows(1);
  } else if (sh && HOJAS[n] && !hojasRevisadas__[n]) {
    // Si agregamos columnas nuevas, completa el encabezado de una pestaña que ya existía.
    hojasRevisadas__[n] = true;
    const enc = HOJAS[n];
    if (sh.getLastColumn() < enc.length) {
      sh.getRange(1, 1, 1, enc.length).setValues([enc]).setFontWeight('bold').setBackground('#ffd700');
    }
  }
  return sh;
}
const hojasRevisadas__ = {};

function leer_(n) {
  const sh = hoja_(n);
  const filas = sh.getLastRow();
  if (filas < 2) return [];
  const enc = HOJAS[n];
  return sh.getRange(2, 1, filas - 1, enc.length).getValues().map((r, i) => {
    const o = { _fila: i + 2 };
    enc.forEach((k, j) => o[k] = r[j]);
    return o;
  });
}

/** Evita que Sheets lea como fórmula un texto que empieza con + = - @ (por ejemplo, +56 9 ...). */
function celda_(v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }

function agregar_(n, obj) {
  const enc = HOJAS[n];
  hoja_(n).appendRow(enc.map(k => obj[k] === undefined ? '' : celda_(obj[k])));
}

function actualizar_(n, fila, cambios) {
  const enc = HOJAS[n];
  const sh = hoja_(n);
  Object.keys(cambios).forEach(k => {
    const col = enc.indexOf(k);
    if (col >= 0) sh.getRange(fila, col + 1).setValue(celda_(cambios[k]));
  });
}

function buscarSocio_(campo, valor) {
  if (!valor) return null;
  return leer_('Socios').find(s => String(s[campo]) === String(valor)) || null;
}

function socioPorToken_(token) {
  if (!token || String(token).length < 40) return null;
  const s = buscarSocio_('token', hash_(token));
  return s && s.estado === 'activo' ? s : null;
}

/* ----------------------------- Utilidades ----------------------------- */

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function limpiar_(v, max) { return String(v || '').replace(/[<>]/g, '').replace(/^[=+\-@]+/, '').trim().slice(0, max); }
function esc_(v) { return String(v || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function hash_(t) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(t)).map(b => ('0' + (b & 255).toString(16)).slice(-2)).join(''); }
function log_(tipo, detalle) { try { agregar_('Registro', { fecha: new Date(), tipo, detalle: String(detalle).slice(0, 1000) }); } catch (e) { } }

function normTel_(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (d.length === 9 && d[0] === '9') d = '56' + d;
  if (d.length === 8) d = '569' + d;
  if (!/^569\d{8}$/.test(d)) return '';
  return '+56 9 ' + d.slice(3, 7) + ' ' + d.slice(7);
}

function fechaTxt_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, CLUB.zona, 'yyyy-MM-dd');
  return String(v).slice(0, 10);
}

function codigoReferido_(nombre) {
  const base = nombre.split(' ')[0].normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 10) || 'SOCIO';
  let c;
  do { c = base + '-' + (10 + Math.floor(Math.random() * 90)); } while (buscarSocio_('codigo', c));
  return c;
}
