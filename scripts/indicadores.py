"""Calcula los indicadores mensuales de Rusti-Co. desde Fudo y los guarda en Supabase.

Los resultados NO se escriben en este repositorio (que es público): van a la tabla
`indicadores_mes` de Supabase, que solo pueden leer los administradores del
apartado de equipo (rusti-co.cl/equipo, pestaña Indicadores).

Variables de entorno (secretos del repositorio en GitHub):
  FUDO_API_KEY, FUDO_API_SECRET   ya existen (las usa la carta)
  SUPABASE_SERVICE_ROLE_KEY       clave service_role de Supabase (nunca en el código)
  MESES                           opcional, ej. "2026-09,2026-10". Por defecto: mes actual y anterior.
  PROBAR=1                        solo muestra los nombres de los campos de Fudo, sin cifras ni escritura.

Definiciones (las mismas del informe mensual):
  * Venta neta = suma del total de cada venta. Las ventas en $0 no cuentan como venta.
  * Ticket por persona = venta con mesa de salón (mesas 1-15) / personas de esas ventas.
  * Entrada = producto de la categoría Antipasto, salvo los Panuozzo (son plato principal).
  * Panuozzo se mide aparte. El Panuozzo Brisket no está en la carta y se excluye.
  * Postres = participación de la categoría Postres en la venta neta.
  * Margen por mesa: solo bebidas, porque Fudo solo tiene costo cargado en bebidas.
  * Fudo no mide la ocupación real (la cuenta se abre con el primer pedido), así que
    se muestra la venta por día y hora como actividad, no como ocupación.
  * Los domingos se cierra a las 18:00: no se comparan días completos con domingos.
"""
import json
import os
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

AUTH_URL = "https://auth.fu.do/api"
API = "https://api.fu.do/v1alpha1"
SUPABASE_URL = "https://elohxbypbkxlszmjhyff.supabase.co"
TZ = ZoneInfo("America/Santiago")

# Mesas que normalmente se juntan. 14-15 terraza, 16-18 barra.
GRUPOS = [("1+2", {1, 2}), ("3+4", {3, 4}), ("5", {5}), ("6", {6}), ("7+8", {7, 8}),
          ("9+10", {9, 10}), ("11+12", {11, 12}), ("13", {13}),
          ("Terraza 14-15", {14, 15}), ("Barra 16-18", {16, 17, 18})]
SALON = set(range(1, 16))
# Tramos especiales: ticket limpio desde una fecha, con su objetivo (solo para ese mes).
TRAMOS = {"2026-11": {"desde": "2026-11-18", "meta": 19000}}
DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]


def http_json(url, data=None, token=None, headers=None, method=None):
    h = {"Accept": "application/json"}
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    if token:
        h["Authorization"] = f"Bearer {token}"
    h.update(headers or {})
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=60) as r:
        txt = r.read().decode()
        return json.loads(txt) if txt.strip() else None


def norm(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def rel_id(obj, name):
    d = ((obj.get("relationships") or {}).get(name) or {}).get("data")
    return d.get("id") if isinstance(d, dict) else None


def rel_ids(obj, name):
    d = ((obj.get("relationships") or {}).get(name) or {}).get("data")
    return [x["id"] for x in d] if isinstance(d, list) else []


def parse_fecha(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(TZ)


def rango_mes(mes):
    y, m = map(int, mes.split("-"))
    ini = datetime(y, m, 1, tzinfo=TZ)
    fin = datetime(y + (m == 12), m % 12 + 1, 1, tzinfo=TZ)
    return ini, fin


def bajar_ventas(token, desde):
    """Ventas desde `desde` (más recientes primero), con ítems, productos, categorías y mesa."""
    include = "items.product.productCategory,table,discounts"
    ventas, incl, page = [], {}, 1
    while True:
        url = f"{API}/sales?sort=-createdAt&page[size]=100&page[number]={page}&include={include}"
        try:
            j = http_json(url, token=token)
        except urllib.error.HTTPError as e:
            if e.code == 400 and include.endswith(",table,discounts"):
                include = "items.product.productCategory,discounts"  # por si la mesa no se puede incluir
                continue
            raise
        data = j.get("data") or []
        for x in j.get("included") or []:
            incl[(x["type"], x["id"])] = x
        viejas = False
        for v in data:
            if parse_fecha(v["attributes"]["createdAt"]) < desde:
                viejas = True
                break
            ventas.append(v)
        if viejas or len(data) < 100:
            return ventas, incl
        page += 1


_POR_ID = {}


def buscar(incl, tipo_contiene, id_):
    """Busca un objeto incluido por id sin depender del nombre exacto del tipo (Item, SaleItem…)."""
    if not id_:
        return None
    if _POR_ID.get("_de") is not incl or _POR_ID.get("_n") != len(incl):
        _POR_ID.clear()
        _POR_ID.update({"_de": incl, "_n": len(incl)})
        for (t, i), x in incl.items():
            _POR_ID.setdefault(i, []).append((t.lower(), x))
    for t, x in _POR_ID.get(id_, []):
        if tipo_contiene in t:
            return x
    return None


def mesa_de(v, incl):
    a = v["attributes"]
    for k in ("tableNumber", "table"):
        if isinstance(a.get(k), (int, float)) or (isinstance(a.get(k), str) and a[k].isdigit()):
            return int(a[k])
    t = buscar(incl, "table", rel_id(v, "table"))
    if t:
        ta = t.get("attributes") or {}
        for k in ("number", "name", "code"):
            val = ta.get(k)
            if isinstance(val, (int, float)):
                return int(val)
            if isinstance(val, str):
                dig = "".join(c for c in val if c.isdigit())
                if dig:
                    return int(dig)
    return None


def grupo_de(mesa):
    for nombre, mesas in GRUPOS:
        if mesa in mesas:
            return nombre
    return "Sin mesa"


def calcular(mes, ventas, incl):
    ini, fin = rango_mes(mes)
    dias_mes = (fin - ini).days
    venta = n = personas_salon = venta_salon = 0
    con_entrada = 0
    por_dia = defaultdict(float)
    calor = defaultdict(float)  # (díaSemana, hora) -> venta
    dias_semana_vistos = defaultdict(set)
    prod = defaultdict(lambda: {"u": 0.0, "v": 0.0, "cat": ""})
    cat_venta = defaultdict(float)
    pan = {"u": 0.0, "v": 0.0, "ventas": 0}
    grupos = defaultdict(lambda: {"ventas": 0, "personas": 0, "venta": 0.0, "venta_beb": 0.0, "margen_beb": 0.0})
    tam_grupo = defaultdict(int)
    margen_beb = venta_beb = 0.0
    descuentos = 0.0
    banco = {"ventas": 0, "monto": 0.0}  # descuentos del 50% (BancoEstado miércoles, Scotiabank jueves)
    venta_salon_limpia = 0.0
    tramo_cfg = TRAMOS.get(mes)
    tramo = {"personas": 0, "venta_limpia": 0.0}

    for v in ventas:
        a = v["attributes"]
        f = parse_fecha(a["createdAt"])
        if not (ini <= f < fin):
            continue
        estado = norm(str(a.get("saleState") or ""))
        if estado in ("canceled", "cancelled", "anulada", "deleted"):
            continue
        total = float(a.get("total") or 0)
        if total <= 0:
            continue
        n += 1
        venta += total
        desc_banco = 0.0
        for did in rel_ids(v, "discounts"):
            dsc = buscar(incl, "discount", did)
            da = (dsc or {}).get("attributes") or {}
            if not dsc or da.get("canceled"):
                continue
            monto = float(da.get("amount") or 0)
            pctj = float(da.get("percentage") or 0)
            if not monto and 0 < pctj < 100:
                monto = total * pctj / (100 - pctj)  # sin monto: se estima desde el total ya descontado
            descuentos += monto
            if round(pctj) == 50:
                desc_banco += monto
        if desc_banco:
            banco["ventas"] += 1
            banco["monto"] += desc_banco
        por_dia[f.day] += total
        calor[(f.weekday(), f.hour)] += total
        dias_semana_vistos[f.weekday()].add(f.date())
        gente = int(a.get("people") or 0)
        mesa = mesa_de(v, incl)
        g = grupos[grupo_de(mesa)]
        g["ventas"] += 1
        g["personas"] += gente
        g["venta"] += total
        if mesa in SALON and gente > 0:
            personas_salon += gente
            venta_salon += total
            venta_salon_limpia += total + desc_banco
            if tramo_cfg and f.strftime("%Y-%m-%d") >= tramo_cfg["desde"]:
                tramo["personas"] += gente
                tramo["venta_limpia"] += total + desc_banco
            tam_grupo[min(gente, 8)] += 1

        tuvo_entrada = tuvo_pan = False
        for iid in rel_ids(v, "items"):
            it = buscar(incl, "item", iid)
            if not it:
                continue
            ia = it.get("attributes") or {}
            if ia.get("canceled") or ia.get("cancelled"):
                continue
            precio = float(ia.get("price") or 0)  # total de la línea (ya multiplicado)
            cant = float(ia.get("quantity") or 1)
            p = buscar(incl, "product", rel_id(it, "product"))
            pa = (p or {}).get("attributes") or {}
            nombre = pa.get("name") or "Sin nombre"
            c = buscar(incl, "categor", rel_id(p or {}, "productCategory"))
            cat = ((c or {}).get("attributes") or {}).get("name") or ""
            nn, nc = norm(nombre), norm(cat)
            if "panuozzo" in nn and "brisket" in nn:
                continue
            prod[nombre]["u"] += cant
            prod[nombre]["v"] += precio
            prod[nombre]["cat"] = cat
            cat_venta[cat or "Sin categoría"] += precio
            if "panuozzo" in nn:
                pan["u"] += cant
                pan["v"] += precio
                tuvo_pan = True
            elif "antipast" in nc:
                tuvo_entrada = True
            costo = float(pa.get("cost") or 0)
            if costo > 0:
                m = precio - costo * cant
                venta_beb += precio
                margen_beb += m
                g["venta_beb"] += precio
                g["margen_beb"] += m
        con_entrada += tuvo_entrada
        pan["ventas"] += tuvo_pan

    r = lambda x: round(x)
    venta_postres = sum(v for k, v in cat_venta.items() if "postre" in norm(k))
    venta_entradas = sum(p["v"] for k, p in prod.items() if "antipast" in norm(p["cat"]) and "panuozzo" not in norm(k))
    productos = sorted(({"nombre": k, "cat": p["cat"], "u": round(p["u"], 1), "v": r(p["v"])} for k, p in prod.items()),
                       key=lambda x: -x["v"])
    orden = [g for g, _ in GRUPOS] + ["Sin mesa"]
    mesas = [{"grupo": k, **{kk: (r(vv) if isinstance(vv, float) else vv) for kk, vv in grupos[k].items()}}
             for k in orden if k in grupos]
    hoy = datetime.now(TZ)
    dias_transcurridos = dias_mes if hoy >= fin else max(1, (hoy - ini).days + (1 if hoy.hour >= 12 else 0))
    return {
        "mes": mes,
        "dias_mes": dias_mes,
        "dias_transcurridos": min(dias_mes, dias_transcurridos),
        "cerrado": hoy >= fin,
        "venta": r(venta),
        "ventas": n,
        "descuentos": r(descuentos),
        "ticket_venta": r(venta / n) if n else 0,
        "personas_salon": personas_salon,
        "venta_salon": r(venta_salon),
        "ticket_persona": r(venta_salon / personas_salon) if personas_salon else 0,
        "ticket_persona_limpio": r(venta_salon_limpia / personas_salon) if personas_salon else 0,
        "tramo": ({**tramo_cfg, "personas": tramo["personas"],
                   "ticket_limpio": r(tramo["venta_limpia"] / tramo["personas"]) if tramo["personas"] else 0}
                  if tramo_cfg else None),
        "descuento_banco": {"ventas": banco["ventas"], "monto": r(banco["monto"])},
        "pct_con_entrada": round(100 * con_entrada / n, 1) if n else 0,
        "pct_entradas_venta": round(100 * venta_entradas / venta, 1) if venta else 0,
        "pct_postres": round(100 * venta_postres / venta, 1) if venta else 0,
        "venta_postres": r(venta_postres),
        "panuozzo": {"u": round(pan["u"], 1), "v": r(pan["v"]), "ventas": pan["ventas"]},
        "bebidas": {"venta": r(venta_beb), "margen": r(margen_beb),
                    "pct_margen": round(100 * margen_beb / venta_beb, 1) if venta_beb else 0},
        "por_dia": [r(por_dia.get(d, 0)) for d in range(1, dias_mes + 1)],
        "calor": [[r(calor.get((d, h), 0)) for h in range(12, 24)] for d in range(7)],
        "dias_por_semana": [len(dias_semana_vistos[d]) for d in range(7)],
        "categorias": sorted(({"cat": k, "v": r(v)} for k, v in cat_venta.items()), key=lambda x: -x["v"]),
        "top": productos[:12],
        "bottom": [p for p in productos if p["u"] > 0][-8:][::-1],
        "mesas": mesas,
        "tam_grupo": {str(k): v for k, v in sorted(tam_grupo.items())},
        "fuente": "Fudo (API), calculado " + hoy.strftime("%Y-%m-%d %H:%M") + " hora de Chile",
    }


# ---------- Reseñas de Google ----------
# Google no da el historial de reseñas, así que se guarda una foto diaria del total
# (tabla resenas_google). Reseñas nuevas de un mes = último total del mes - último total antes del mes.
LUGAR = "Rusti-Co. Pizzería y Bar, Concepción"
LUGAR_CID = "0xb0cda946df20c8c4"  # el de la ficha en Google Maps; sirve para no confundir el local


def leer_google(api_key):
    """Total de reseñas y estrellas desde la API de Google Places (New)."""
    j = http_json("https://places.googleapis.com/v1/places:searchText",
                  data={"textQuery": LUGAR, "locationBias": {"circle": {
                      "center": {"latitude": -36.78909, "longitude": -73.06063}, "radius": 2000}}},
                  headers={"X-Goog-Api-Key": api_key,
                           "X-Goog-FieldMask": "places.id,places.displayName,places.rating,places.userRatingCount,places.googleMapsUri"},
                  method="POST")
    lugares = (j or {}).get("places") or []
    elegido = next((p for p in lugares if str(int(LUGAR_CID, 16)) in (p.get("googleMapsUri") or "")), None)
    elegido = elegido or next((p for p in lugares if "rusti" in norm((p.get("displayName") or {}).get("text", ""))), None)
    if not elegido:
        return None
    return {"total": int(elegido.get("userRatingCount") or 0), "estrellas": float(elegido.get("rating") or 0)}


def supa(clave, path, data=None, method=None, prefer=None):
    h = {"apikey": clave, "Authorization": f"Bearer {clave}"}
    if prefer:
        h["Prefer"] = prefer
    return http_json(f"{SUPABASE_URL}/rest/v1/{path}", data=data, headers=h, method=method)


def resenas_del_mes(fotos, mes):
    """fotos: [{fecha, total, estrellas}] ordenadas por fecha."""
    ini, fin = rango_mes(mes)
    a, b = ini.strftime("%Y-%m-%d"), fin.strftime("%Y-%m-%d")
    antes = [f for f in fotos if f["fecha"] < a]
    dentro = [f for f in fotos if a <= f["fecha"] < b]
    if not dentro:
        return None
    ult = dentro[-1]
    base = antes[-1] if antes else None
    return {"total": ult["total"], "estrellas": float(ult["estrellas"] or 0), "al": ult["fecha"],
            "nuevas": ult["total"] - base["total"] if base else None,
            "desde": base["fecha"] if base else None}


# ---------- Perfil de Empresa de Google (Business Profile Performance API) ----------
METRICAS_PERFIL = {
    "BUSINESS_IMPRESSIONS_MOBILE_MAPS": "vistas_maps", "BUSINESS_IMPRESSIONS_DESKTOP_MAPS": "vistas_maps",
    "BUSINESS_IMPRESSIONS_MOBILE_SEARCH": "vistas_busqueda", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH": "vistas_busqueda",
    "BUSINESS_DIRECTION_REQUESTS": "como_llegar", "CALL_CLICKS": "llamadas", "WEBSITE_CLICKS": "web",
    "BUSINESS_FOOD_MENU_CLICKS": "carta",
}


def token_perfil():
    cid, sec, ref = (os.environ.get(k, "").strip() for k in ("GBP_CLIENT_ID", "GBP_CLIENT_SECRET", "GBP_REFRESH_TOKEN"))
    if not (cid and sec and ref):
        return None
    body = urllib.parse.urlencode({"client_id": cid, "client_secret": sec, "refresh_token": ref,
                                   "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())["access_token"]


def ubicacion_perfil(tok):
    """Fichas candidatas de Rusti-Co (locations/123…) en las cuentas del usuario conectado, verificadas primero."""
    cuentas = http_json("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", token=tok).get("accounts") or []
    todas = []
    for c in cuentas:
        j = http_json(f"https://mybusinessbusinessinformation.googleapis.com/v1/{c['name']}/locations"
                      "?readMask=name,title,metadata&pageSize=100", token=tok)
        todas += j.get("locations") or []
    cand = [l for l in todas if "rusti" in norm(l.get("title", ""))] or (todas if len(todas) == 1 else [])
    cand.sort(key=lambda l: not (l.get("metadata") or {}).get("hasVoiceOfMerchant"))
    print(f"Perfil de Empresa: {len(cuentas)} cuenta(s), {len(todas)} ficha(s), {len(cand)} de Rusti-Co "
          f"({sum(1 for l in cand if (l.get('metadata') or {}).get('hasVoiceOfMerchant'))} verificada(s)).")
    return [l["name"] for l in cand]


def metricas_perfil(tok, ubic, desde, hasta):
    """{ 'YYYY-MM-DD': {vistas_maps, vistas_busqueda, como_llegar, llamadas, web, carta} }"""
    q = [("dailyMetrics", m) for m in METRICAS_PERFIL] + [
        ("dailyRange.startDate.year", desde.year), ("dailyRange.startDate.month", desde.month), ("dailyRange.startDate.day", desde.day),
        ("dailyRange.endDate.year", hasta.year), ("dailyRange.endDate.month", hasta.month), ("dailyRange.endDate.day", hasta.day)]
    j = http_json(f"https://businessprofileperformance.googleapis.com/v1/{ubic}:fetchMultiDailyMetricsTimeSeries?"
                  + urllib.parse.urlencode(q), token=tok)
    por_dia = defaultdict(lambda: defaultdict(int))
    for grupo in j.get("multiDailyMetricTimeSeries") or []:
        for serie in grupo.get("dailyMetricTimeSeries") or []:
            clave = METRICAS_PERFIL.get(serie.get("dailyMetric"))
            for dv in (serie.get("timeSeries") or {}).get("datedValues") or []:
                d = dv.get("date") or {}
                if clave and d:
                    por_dia[f"{d['year']:04d}-{d['month']:02d}-{d['day']:02d}"][clave] += int(dv.get("value") or 0)
    return por_dia


def perfil_del_mes(por_dia, mes):
    dias = sorted(k for k in por_dia if k.startswith(mes))
    if not dias:
        return None
    tot = defaultdict(int)
    for k in dias:
        for m, v in por_dia[k].items():
            tot[m] += v
    tot = dict(tot)
    tot["vistas"] = tot.get("vistas_maps", 0) + tot.get("vistas_busqueda", 0)
    tot["acciones"] = tot.get("como_llegar", 0) + tot.get("llamadas", 0) + tot.get("web", 0) + tot.get("carta", 0)
    tot["hasta"] = dias[-1]
    tot["vistas_por_dia"] = [sum(por_dia.get(f"{mes}-{d:02d}", {}).get(m, 0) for m in ("vistas_maps", "vistas_busqueda"))
                             for d in range(1, 32)]
    return tot


def guardar(fila, clave):
    http_json(f"{SUPABASE_URL}/rest/v1/indicadores_mes?on_conflict=mes",
              data={"mes": fila["mes"], "datos": fila, "actualizado": datetime.now(timezone.utc).isoformat()},
              headers={"apikey": clave, "Authorization": f"Bearer {clave}",
                       "Prefer": "resolution=merge-duplicates,return=minimal"}, method="POST")


def main():
    key, secret = os.environ.get("FUDO_API_KEY"), os.environ.get("FUDO_API_SECRET")
    if not key or not secret:
        print("Faltan FUDO_API_KEY y FUDO_API_SECRET. No se calculó nada.")
        return 0
    clave = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if clave:
        try:
            http_json(f"{SUPABASE_URL}/rest/v1/indicadores_manual?select=mes&limit=1",
                      headers={"apikey": clave, "Authorization": f"Bearer {clave}"})
            print("Supabase: clave OK.")
        except urllib.error.HTTPError as e:
            print(f"Supabase rechazó la clave service_role (HTTP {e.code}). Revisa el secreto SUPABASE_SERVICE_ROLE_KEY.")
            return 1
    try:
        token = http_json(AUTH_URL, {"apiKey": key.strip(), "apiSecret": secret.strip()})["token"]
    except urllib.error.HTTPError as e:
        print(f"Fudo rechazó las credenciales (HTTP {e.code}). Revisa FUDO_API_KEY y FUDO_API_SECRET.")
        return 1
    print("Fudo: credenciales OK.")
    probar = os.environ.get("PROBAR") == "1"

    hoy = datetime.now(TZ)
    meses = [m.strip() for m in (os.environ.get("MESES") or "").split(",") if m.strip()]
    if not meses:
        anterior = (hoy.replace(day=1) - timedelta(days=1))
        meses = [anterior.strftime("%Y-%m"), hoy.strftime("%Y-%m")]
    desde = min(rango_mes(m)[0] for m in meses)
    if probar:
        desde = hoy - timedelta(days=2)
    ventas, incl = bajar_ventas(token, desde)

    if probar:
        # El repositorio es público y sus registros de Actions también: solo nombres de campos, sin cifras.
        print("Ventas leídas (últimos 2 días):", len(ventas))
        if ventas:
            v = ventas[0]
            print("Venta, atributos:", sorted(v["attributes"].keys()))
            print("Venta, relaciones:", sorted((v.get("relationships") or {}).keys()))
        tipos = defaultdict(set)
        for (t, _), x in incl.items():
            tipos[t] |= set((x.get("attributes") or {}).keys()) | {"rel:" + k for k in (x.get("relationships") or {})}
        for t, ks in sorted(tipos.items()):
            print(f"Incluido {t}:", sorted(ks))
        con_mesa = sum(1 for v in ventas if mesa_de(v, incl) is not None)
        print(f"Ventas con mesa reconocida: {con_mesa} de {len(ventas)}")
        return 0

    fotos = []
    if clave:
        gkey = os.environ.get("GOOGLE_PLACES_API_KEY")
        if gkey:
            try:
                g = leer_google(gkey.strip())
                if g:
                    supa(clave, "resenas_google?on_conflict=fecha",
                         {"fecha": hoy.strftime("%Y-%m-%d"), "total": g["total"], "estrellas": g["estrellas"]},
                         method="POST", prefer="resolution=merge-duplicates,return=minimal")
                    print("Google: reseñas leídas OK.")
                else:
                    print("Google: no se encontró el local en la búsqueda.")
            except urllib.error.HTTPError as e:
                try:
                    err = json.loads(e.read().decode()).get("error", {})
                    motivo = next((d.get("reason") for d in err.get("details", []) if d.get("reason")), "") or err.get("status", "")
                except Exception:
                    motivo = ""
                print(f"Google rechazó la consulta (HTTP {e.code} {motivo}). Revisa GOOGLE_PLACES_API_KEY y que Places API (New) esté activada.")
        else:
            print("Sin GOOGLE_PLACES_API_KEY: las reseñas siguen siendo manuales.")
        try:
            fotos = supa(clave, "resenas_google?select=fecha,total,estrellas&order=fecha") or []
        except urllib.error.HTTPError:
            fotos = []

    perfil = {}
    try:
        tok = token_perfil()
        if tok:
            fichas = ubicacion_perfil(tok)
            if fichas:
                ini = min(rango_mes(m)[0] for m in meses).date()
                fin = (hoy - timedelta(days=1)).date()
                for i, ubic in enumerate(fichas):
                    try:
                        perfil = metricas_perfil(tok, ubic, ini, fin)
                        break
                    except urllib.error.HTTPError as e:
                        if e.code != 403 or i == len(fichas) - 1:
                            raise
                print("Perfil de Empresa: métricas leídas OK.")
            else:
                print("Perfil de Empresa: la cuenta conectada no administra la ficha de Rusti-Co.")
        else:
            print("Sin GBP_CLIENT_ID / GBP_CLIENT_SECRET / GBP_REFRESH_TOKEN: sin métricas del Perfil de Empresa.")
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode()).get("error", {})
            if isinstance(err, dict):
                razones = [d.get("reason", "") for d in err.get("details", []) if isinstance(d, dict) and d.get("reason")]
                motivo = " ".join([err.get("status", "")] + razones) + " | " + str(err.get("message", ""))[:200]
            else:
                motivo = str(err)[:200]
        except Exception:
            motivo = ""
        api = urllib.parse.urlsplit(getattr(e, "url", "") or "").netloc
        print(f"Perfil de Empresa: Google rechazó la consulta a {api} (HTTP {e.code} {motivo}).")

    for mes in meses:
        fila = calcular(mes, ventas, incl)
        r = resenas_del_mes(fotos, mes)
        if r:
            fila["resenas"] = r
        pm = perfil_del_mes(perfil, mes)
        if pm:
            fila["perfil"] = pm
        if not clave:
            print(f"{mes}: calculado, pero falta SUPABASE_SERVICE_ROLE_KEY; no se guardó.")
            continue
        guardar(fila, clave)
        print(f"{mes}: indicadores guardados en Supabase.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
