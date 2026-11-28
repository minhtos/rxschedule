// Server-side RxNorm lookup (NLM RxNav). No key needed.
// Two modes:
//   ?q=amox          -> ingredient candidates + products for the top 3 ingredient
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

const CT = "https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search";

// Clinical Tables autocomplete: substring matching. Returns [count, [names], ...] — names live at index 1.
async function ctNames(q: string) {
  const data = await getJson(`${CT}?terms=${encodeURIComponent(q)}&maxList=7`);
  return (data?.[1] ?? []) as string[];
}

// Resolve a plain drug name to its ingredient RxCUI (null when RxNorm doesn't know it)
async function ingredientId(name: string) {
  const data = await getJson(`${BASE}/rxcui.json?name=${encodeURIComponent(name)}`);
  return (data?.idGroup?.rxnormId?.[0] ?? null) as string | null;
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
    if (ingredients.length === 0) {
  try {
    for (const n of await ctNames(q)) {
      const base = n.replace(/\s*\(.*$/, "").trim();
      if (!base || base.includes("/")) continue;
      const id = await ingredientId(base);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ingredients.push({ rxcui: id, name: base });
    }
  } catch { /* fallback failed — stay empty; the honest message shows */ }
}
    const top = ingredients.slice(0, 3);
    const seenP = new Set<string>();
    const products: any[] = [];
    for (const t of top) {
    for (const p of await productsFor(t.rxcui)) {
    if (seenP.has(p.rxcui)) continue;
    seenP.add(p.rxcui);
    products.push(p);
  }
}
    const payload = { ingredients: top, products };
    cache.set(key, payload);
    return Response.json(payload);
  } catch {
    return Response.json({ unavailable: true, ingredients: [], products: [] }, { status: 502 });
  }
}
