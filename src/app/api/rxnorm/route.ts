// Server-side RxNorm lookup (NLM RxNav). No key needed.
// Two modes:
//   ?q=amox          -> ingredient candidates + products for the top ingredient
//   ?ingredient=723  -> products for one chosen ingredient
const BASE = "https://rxnav.nlm.nih.gov/REST";
const cache = new Map<string, any>();

async function getJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw new Error("rxnav " + res.status);
  return res.json();
}

async function productsFor(rxcui: string) {
  const key = "ing:" + rxcui;
  if (cache.has(key)) return cache.get(key);
  const data = await getJson(`${BASE}/rxcui/${rxcui}/related.json?tty=SCD`);
  const groups = data?.relatedGroup?.conceptGroup ?? [];
  const products: any[] = [];
  for (const g of groups) {
    for (const p of g.conceptProperties ?? []) {
      products.push({ rxcui: p.rxcui, name: p.name });
    }
  }
  cache.set(key, products);
  return products;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ingredient = url.searchParams.get("ingredient");
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  try {
    if (ingredient) {
      const products = await productsFor(ingredient);
      return Response.json({ products });
    }
    if (q.length < 3) return Response.json({ ingredients: [], products: [] });
    const key = "q:" + q;
    if (cache.has(key)) return Response.json(cache.get(key));
    const data = await getJson(`${BASE}/approximateTerm.json?term=${encodeURIComponent(q)}&maxEntries=10`);
    const candidates = data?.approximateGroup?.candidate ?? [];
    const seen = new Set<string>();
    const ingredients: any[] = [];
    for (const c of candidates) {
      if (!c.rxcui || !c.name || seen.has(c.rxcui)) continue;
      seen.add(c.rxcui);
      ingredients.push({ rxcui: c.rxcui, name: c.name });
    }
    const top = ingredients.slice(0, 3);
    const products = top.length ? await productsFor(top[0].rxcui) : [];
    const payload = { ingredients: top, products };
    cache.set(key, payload);
    return Response.json(payload);
  } catch {
    return Response.json({ unavailable: true, ingredients: [], products: [] }, { status: 502 });
  }
}
