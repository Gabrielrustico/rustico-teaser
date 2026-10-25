"""Lee los productos y precios desde la API de Fudo y escribe menu.json.

La web (index.html) lee menu.json al cargar y actualiza los precios de su carta.
Necesita las variables de entorno FUDO_API_KEY y FUDO_API_SECRET
(guardadas como secretos del repositorio en GitHub, nunca en el código).
"""
import json
import os
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone

AUTH_URL = "https://auth.fu.do/api"
API = "https://api.fu.do/v1alpha1"


def http_json(url, data=None, token=None):
    headers = {"Accept": "application/json"}
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def norm(name):
    s = unicodedata.normalize("NFD", name.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    for w in ("pizza de ", "pizza "):
        if s.startswith(w):
            s = s[len(w):]
    return "".join(c for c in s if c.isalnum())


def fetch_all(path, token):
    out, page = [], 1
    while True:
        sep = "&" if "?" in path else "?"
        data = http_json(f"{API}{path}{sep}page[size]=500&page[number]={page}", token=token)["data"]
        out += data
        if len(data) < 500:
            return out
        page += 1


def main():
    key, secret = os.environ.get("FUDO_API_KEY"), os.environ.get("FUDO_API_SECRET")
    if not key or not secret:
        print("Faltan FUDO_API_KEY y FUDO_API_SECRET en los secretos del repositorio. No se actualizó nada.")
        return 0
    token = http_json(AUTH_URL, {"apiKey": key, "apiSecret": secret})["token"]
    cats = {c["id"]: c.get("attributes", {}).get("name", "") for c in fetch_all("/product-categories", token)}
    products = {}
    for p in fetch_all("/products", token):
        a = p.get("attributes", {})
        name, price = a.get("name"), a.get("price")
        if not name or price is None:
            continue
        cat = ((p.get("relationships", {}).get("productCategory") or {}).get("data") or {}).get("id")
        products[norm(name)] = {
            "name": name,
            "price": round(float(price)),
            "active": bool(a.get("active", True)),
            "qr": bool(a.get("enableQrMenu", True)),
            "category": cats.get(cat, ""),
        }
    if not products:
        print("Fudo no devolvió productos; se mantiene el menu.json anterior.")
        return 1
    new = {"products": products}
    try:
        old = json.load(open("menu.json", encoding="utf-8"))
        if old.get("products") == products:
            print(f"Sin cambios de precios ({len(products)} productos).")
            return 0
    except (FileNotFoundError, ValueError):
        pass
    new["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with open("menu.json", "w", encoding="utf-8") as f:
        json.dump(new, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"menu.json actualizado con {len(products)} productos.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
