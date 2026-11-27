"use client";

import { Suspense, use, useEffect, useState } from "react";
import Link from "next/link";

type OrderDraft = {
  drugName: string;
  strength: string;
  form: string;
  doseQty: string;
  route: string;
  frequency: string;
  times: string[];
  prnReason: string;
  dispenseQty: string;
  refills: string;
  daw: string;
  notes: string;
  rxcui?: string;
  rxDisplay?: string;
  rxIngredients?: string[];
};

const EMPTY_DRAFT: OrderDraft = {
  drugName: "",
  strength: "",
  form: "tablet",
  doseQty: "1",
  route: "by mouth",
  frequency: "",
  times: [],
  prnReason: "",
  dispenseQty: "",
  refills: "",
  daw: "0",
  notes: "",
};

const FORM_ROUTES: Record<string, string> = {
  tablet: "by mouth",
  capsule: "by mouth",
  liquid: "by mouth",
  cream: "on the skin",
  ointment: "on the skin",
  inhaler: "by inhalation",
  injection: "by injection",
  drops: "in the eye",
};

const FREQ_TIMES: Record<string, string[]> = {
  QD: ["MORN"],
  BID: ["MORN", "EVE"],
  TID: ["MORN", "NOON", "EVE"],
  QID: ["MORN", "NOON", "EVE", "HS"],
  QOD: ["MORN"],
  QHS: ["HS"],
};

const TIME_PHRASES: Record<string, string> = {
  MORN: "in the morning",
  NOON: "at noon",
  EVE: "in the evening",
  HS: "at bedtime",
};

function sigPreview(d: OrderDraft): string {
  if (!d.drugName) return "Start by choosing a medication.";
  const take = `Take ${d.doseQty || "?"} ${d.form}${Number(d.doseQty) > 1 ? "s" : ""} ${d.route}`;
  if (d.frequency === "PRN") {
    return `${take} as needed${d.prnReason ? ` for ${d.prnReason}` : ""}.`;
  }
  if (d.frequency === "ONCE") return `${take} once.`;
  if (d.times.length === 0) return `${take} — pick a frequency.`;
  const phrases = d.times.map((t) => TIME_PHRASES[t] ?? t);
  const when =
    phrases.length === 1
      ? phrases[0]
      : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
  return `${take} ${when}.`;
}

function buildMedicationRequest(d: OrderDraft, patientId: string) {
  return {
    resourceType: "MedicationRequest",
    status: "active",
    intent: "order",
    subject: { reference: `Patient/${patientId}` },
    medicationCodeableConcept: d.rxcui
  ? {
      coding: [
        {
          system: "http://www.nlm.nih.gov/research/umls/rxnorm",
          code: d.rxcui,
          display: d.rxDisplay,
        },
      ],
      text: d.rxDisplay,
    }
  : { text: `${d.drugName} ${d.strength}`.trim() },
    authoredOn: new Date().toISOString().slice(0, 10),
    dosageInstruction: [
      {
        text: sigPreview(d),
        timing: { repeat: { when: d.times } },
        route: { text: d.route },
        doseAndRate: [
          { doseQuantity: { value: Number(d.doseQty) || 1, unit: d.form } },
        ],
      },
    ],
    dispenseRequest: {
      quantity: { value: Number(d.dispenseQty) || 0, unit: d.form },
      numberOfRepeatsAllowed: Number(d.refills) || 0,
    },
  };
}
// ---------- drug search: query parser ----------
type DrugQuery = {
  drugText: string;
  strength: number | null;
  pair: [number, number] | null;
  form: string | null;
};

const FORM_WORDS: Record<string, string> = {
  cap: "capsule", caps: "capsule", capsule: "capsule", capsules: "capsule",
  tab: "tablet", tabs: "tablet", tablet: "tablet", tablets: "tablet",
  susp: "liquid", suspension: "liquid", syrup: "liquid",
  sol: "liquid", soln: "liquid", solution: "liquid", liquid: "liquid",
  cream: "cream", ointment: "ointment", oint: "ointment",
  inhaler: "inhaler", injection: "injection", drops: "drops", drop: "drops",
};

function parseDrugQuery(raw: string): DrugQuery {
  const words: string[] = [];
  let strength: number | null = null;
  let pair: [number, number] | null = null;
  let form: string | null = null;
  for (const tok of raw.toLowerCase().split(/\s+/).filter(Boolean)) {
    const pairMatch = tok.match(/^(\d+(?:\.\d+)?)[/-](\d+(?:\.\d+)?)$/);
    if (pairMatch) { pair = [Number(pairMatch[1]), Number(pairMatch[2])]; continue; }
    const numMatch = tok.match(/^(\d+(?:\.\d+)?)(mg|mcg|g|ml|%)?$/);
    if (numMatch) { strength = Number(numMatch[1]); continue; }
    if (FORM_WORDS[tok]) { form = FORM_WORDS[tok]; continue; }
    const glued = tok.match(/^([a-z]+)(\d+(?:\.\d+)?)$/);
    if (glued) { words.push(glued[1]); strength = Number(glued[2]); continue; }
    words.push(tok);
  }
  return { drugText: words.join(" "), strength, pair, form };
}
// ---------- drug search: product parsing + filtering ----------
type ScdInfo = {
  rxcui: string;
  name: string;
  combo: boolean;
  ingNames: string[];
  strengths: number[];
  perMl: number | null;
  formKey: string;
  er: boolean;
};

function parseScd(p: { rxcui: string; name: string }): ScdInfo {
  const name = p.name;
  const lower = name.toLowerCase();
  const combo = name.includes(" / ");
  const ingNames = name.split(" / ").map((seg) => seg.split(/\d/)[0].trim()).filter(Boolean);
  const perMlMatch = name.match(/(\d+(?:\.\d+)?)\s*MG\/ML/i);
  const perMl = perMlMatch ? Number(perMlMatch[1]) : null;
  const strengths: number[] = [];
  const hits = name.match(/\d+(?:\.\d+)?\s*(?:MG|MCG|G|%)(?![/A-Z])/gi) ?? [];
  for (const h of hits) strengths.push(Number(h.match(/[\d.]+/)?.[0]));
  let formKey = "tablet";
  if (lower.includes("capsule")) formKey = "capsule";
  else if (lower.includes("suspension") || lower.includes("solution") || lower.includes("syrup")) formKey = "liquid";
  else if (lower.includes("cream")) formKey = "cream";
  else if (lower.includes("ointment")) formKey = "ointment";
  else if (lower.includes("inhaler") || lower.includes("aerosol")) formKey = "inhaler";
  else if (lower.includes("injection") || lower.includes("injectable")) formKey = "injection";
  else if (lower.includes("ophthalmic")) formKey = "drops";
  const er = lower.includes("extended release") || /^\d+\s*hr\b/i.test(name);
  return { rxcui: p.rxcui, name, combo, ingNames, strengths, perMl, formKey, er };
}

function strengthMatches(info: ScdInfo, q: DrugQuery): boolean {
  if (q.pair) {
    const [a, b] = q.pair;
    if (info.strengths.length >= 2) return info.strengths[0] === a && info.strengths[1] === b;
    if (info.perMl != null) return Math.abs(info.perMl - a / b) < 0.01;
    return false;
  }
  if (q.strength != null) {
    if (info.strengths[0] === q.strength) return true;
    if (info.perMl != null) return info.perMl === q.strength || info.perMl * 5 === q.strength;
    return false;
  }
  return true;
}

const FORM_ORDER: Record<string, number> = { tablet: 0, capsule: 1, liquid: 2, cream: 3, ointment: 3, drops: 4, inhaler: 5, injection: 6 };

function filterProducts(products: { rxcui: string; name: string }[], q: DrugQuery) {
  const all = products.map(parseScd);
  const words = q.drugText.split(/\s+/).filter(Boolean);
  const pairHitsCombo =
    q.pair != null && all.some((i) => i.combo && i.strengths[0] === q.pair![0] && i.strengths[1] === q.pair![1]);
  const comboIntent =
    pairHitsCombo ||
    (words.length > 1 && all.some((i) => i.combo && i.ingNames.slice(1).some((n) => n.toLowerCase().startsWith(words[words.length - 1]))));
  const keep = (i: ScdInfo) => strengthMatches(i, q) && (!q.form || i.formKey === q.form);
  const sortFn = (a: ScdInfo, b: ScdInfo) =>
    (FORM_ORDER[a.formKey] ?? 9) - (FORM_ORDER[b.formKey] ?? 9) ||
    Number(a.er) - Number(b.er) ||
    (a.strengths[0] ?? 0) - (b.strengths[0] ?? 0);
  const singles = all.filter((i) => !i.combo && keep(i)).sort(sortFn);
  const combos = all.filter((i) => i.combo && keep(i)).sort(sortFn);
  const available = [...new Set(all.filter((i) => !i.combo && i.strengths.length).map((i) => i.strengths[0]))].sort((a, b) => a - b);
  return { singles, combos, comboIntent, available };
}

function isNkdaA(a: any): boolean {
  const codings = a?.code?.coding ?? [];
  if (codings.some((c: any) => c?.code === "409137002" || c?.code === "716186003")) return true;
  const text = (a?.code?.text ?? codings[0]?.display ?? "").toLowerCase();
  return text.includes("no known allerg");
}

function fmtDob(iso?: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function allergyLabelA(a: any): string {
  return a?.code?.coding?.[0]?.display ?? a?.code?.text ?? "Allergy";
}

const ALLERGY_CLASSES: Record<string, string[]> = {
  penicillin: ["penicillin", "amoxicillin", "ampicillin", "dicloxacillin", "nafcillin", "oxacillin", "piperacillin"],
  cephalosporin: ["cephalexin", "cefazolin", "ceftriaxone", "cefuroxime", "cefdinir", "cefepime"],
  sulfonamide: ["sulfamethoxazole", "sulfasalazine", "sulfadiazine"],
};

function allergyNames(a: any): string[] {
  const out: string[] = [];
  const text = (a?.code?.text ?? "").toLowerCase();
  if (text) out.push(text);
  for (const c of a?.code?.coding ?? []) {
    if (c?.display) out.push(String(c.display).toLowerCase());
  }
  return out;
}

function checkAllergy(ingNames: string[], allergies: any[]) {
  const ings = ingNames.map((s) => s.toLowerCase());
  for (const a of allergies) {
    const names = allergyNames(a);
    for (const ing of ings) {
      if (names.some((n) => n.includes(ing) || ing.includes(n))) {
        return { allergy: a, ingredient: ing, via: "name match" };
      }
      for (const [cls, members] of Object.entries(ALLERGY_CLASSES)) {
        const allergenInClass =
          names.some((n) => n.includes(cls)) ||
          names.some((n) => members.some((m) => n.includes(m) || m.includes(n)));
        const drugInClass = members.some((m) => ing.includes(m) || m.includes(ing));
        if (allergenInClass && drugInClass) {
          return { allergy: a, ingredient: ing, via: `${cls} class` };
        }
      }
    }
  }
  return null;
}

function allergyReaction(a: any): string {
  const parts: string[] = [];
  const man = a?.reaction?.[0]?.manifestation?.[0];
  const r = man?.text ?? man?.coding?.[0]?.display;
  if (r) parts.push(r);
  if (a?.criticality) parts.push(`criticality: ${a.criticality}`);
  return parts.join(" · ");
}

function OrderInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [patient, setPatient] = useState<any>(null);
  const [allergies, setAllergies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<OrderDraft>(EMPTY_DRAFT);

  const [query, setQuery] = useState("");
const [rx, setRx] = useState<any>(null);
const [rxFor, setRxFor] = useState("");
const [picked, setPicked] = useState<ScdInfo | null>(null);
const [listOpen, setListOpen] = useState(false);

const parsed = parseDrugQuery(query);

useEffect(() => {
  const drugText = parseDrugQuery(query).drugText;
  if (picked || drugText.length < 3 || drugText === rxFor) return;
  let cancelled = false;
  const t = setTimeout(() => {
    fetch(`/api/rxnorm?q=${encodeURIComponent(drugText)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setRx(data);
        setRxFor(drugText);
      })
      .catch(() => {
        if (!cancelled) {
          setRx({ unavailable: true, ingredients: [], products: [] });
          setRxFor(drugText);
        }
      });
  }, 300);
  return () => {
    cancelled = true;
    clearTimeout(t);
  };
}, [query, rxFor, picked]);

  const [showPayload, setShowPayload] = useState(false);
  const [override, setOverride] = useState(false);
  const [overrideNote, setOverrideNote] = useState("");
  const [ackAllergy, setAckAllergy] = useState(false);

useEffect(() => {
  setOverride(false);
  setOverrideNote("");
}, [draft.rxcui]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [p, ab] = await Promise.all([
          fetch(`/api/fhir/Patient/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch(`/api/fhir/AllergyIntolerance?patient=${id}`).then((r) => (r.ok ? r.json() : { entry: [] })).catch(() => ({ entry: [] })),
        ]);
        if (cancelled) return;
        setPatient(p);
        setAllergies((ab.entry ?? []).map((e: any) => e.resource));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <p className="p-6 opacity-70">Loading…</p>;
  if (!patient) return <p className="p-6 text-red-400">Patient not found.</p>;

  const set = (patch: Partial<OrderDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const pickFrequency = (code: string) => set({ frequency: code, times: FREQ_TIMES[code] ?? [] });
  const toggleTime = (t: string) =>
    set({ times: draft.times.includes(t) ? draft.times.filter((x) => x !== t) : [...draft.times, t] });
  const pickForm = (form: string) => {set({ form, route: FORM_ROUTES[form] ?? draft.route });
  clearCoding();
};

const filtered = rx?.products
  ? filterProducts(rx.products, parsed)
  : { singles: [] as ScdInfo[], combos: [] as ScdInfo[], comboIntent: false, available: [] as number[] };

const distinctIngs = (rx?.ingredients ?? []).filter(
  (ing: any, idx: number, arr: any[]) =>
    arr.findIndex(
      (x: any) => x.name.toLowerCase().split(/\s+/)[0] === ing.name.toLowerCase().split(/\s+/)[0]
    ) === idx
);

function clearCoding() {
  set({ rxcui: undefined, rxDisplay: undefined, rxIngredients: undefined });
  setPicked(null);
}

function chooseIngredient(ing: any) {
  fetch(`/api/rxnorm?ingredient=${ing.rxcui}`)
    .then((r) => r.json())
    .then((data) => setRx({ ingredients: [ing], products: data.products ?? [] }))
    .catch(() => {});
}

function pickProduct(info: ScdInfo) {
  setPicked(info);
  setListOpen(false);
  setQuery(info.name);
  set({
    drugName: info.ingNames.join(" / "),
    strength:
      info.perMl != null && info.strengths.length < 2
        ? `${info.perMl * 5} MG per 5 ML`
        : info.strengths.map((s) => `${s} MG`).join(" / "),
    form: info.formKey,
    route: FORM_ROUTES[info.formKey] ?? draft.route,
    rxcui: info.rxcui,
    rxDisplay: info.name,
    rxIngredients: info.ingNames,
  });
}

const rowBtn = (info: ScdInfo) => (
  <button
    key={info.rxcui}
    type="button"
    className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
    onClick={() => pickProduct(info)}
  >
    {info.name}
    {info.er ? " · ER" : ""}
  </button>
);

  const realAllergies = allergies.filter((a) => !isNkdaA(a));
  const name = `${patient.name?.[0]?.family ?? ""}, ${patient.name?.[0]?.given?.join(" ") ?? ""}`;
  const inputCls = "w-full rounded border border-neutral-700 bg-white px-3 py-2 text-black";
  const labelCls = "mb-1 block text-sm opacity-80";
  const allergyHit = draft.rxIngredients?.length
  ? checkAllergy(draft.rxIngredients, realAllergies)
  : null;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href={`/patients/${id}`} className="text-sm underline">← Back to chart</Link>
      <h1 className="mt-3 text-2xl font-bold">New order</h1>
      <p className="mt-1 opacity-80">{name} · DOB {fmtDob(patient.birthDate)}</p>
      {realAllergies.length > 0 ? (
        <p className="mt-3 rounded border border-red-500 bg-red-950 px-3 py-2 text-red-200">
          ⚠ Allergies: {realAllergies.map((a) => allergyLabelA(a)).join(", ")}
        </p>
      ) : allergies.length > 0 ? (
        <p className="mt-3 opacity-80">✓ No known allergies — documented</p>
      ) : (
        <p className="mt-3 rounded border border-dashed border-amber-500 bg-amber-50 px-3 py-2 text-amber-800">
          ⚠ Allergies not recorded — verify before prescribing
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="relative">
          <label className={labelCls}>Medication</label>
          <input
  className="w-full rounded border bg-white px-3 py-2 text-black"
  value={query}
  placeholder="Start typing a drug name — e.g. amox 500"
  onChange={(e) => {
  setQuery(e.target.value);
  setListOpen(true);
  clearCoding();
}}
  onFocus={() => setListOpen(true)}
/>
{query.trim() && (
  <p className="mt-1 text-xs text-gray-400">
    Drug: {parsed.drugText || "—"}
    {parsed.strength != null && ` · Strength: ${parsed.strength}`}
    {parsed.pair && ` · Combo strength: ${parsed.pair[0]}/${parsed.pair[1]}`}
    {parsed.form && ` · Form: ${parsed.form}`}
  </p>
)}
{listOpen && !picked && rx && rxFor === parsed.drugText && (
  <div className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded border bg-white text-black shadow-lg">
    {rx.unavailable ? (
      <p className="px-3 py-2 text-sm">RxNorm unavailable — keep typing to use free text.</p>
    ) : distinctIngs.length > 1 ? (
      <>
        <p className="px-3 py-2 text-xs text-gray-500">More than one drug matches — pick the drug first:</p>
        {distinctIngs.map((ing: any) => (
          <button
            key={ing.rxcui}
            type="button"
            className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
            onClick={() => chooseIngredient(ing)}
          >
            {ing.name}
          </button>
        ))}
      </>
    ) : filtered.singles.length === 0 && filtered.combos.length === 0 ? (
      <p className="px-3 py-2 text-sm">
        No {distinctIngs[0]?.name ?? "drug"} products match that strength.
        {filtered.available.length > 0 && <> Available strengths: {filtered.available.join(", ")}</>}
      </p>
    ) : (
      <>
        {(filtered.comboIntent ? filtered.combos : filtered.singles).slice(0, 10).map(rowBtn)}
        {!filtered.comboIntent && filtered.combos.length > 0 && (
          <>
            <p className="border-t px-3 py-1 text-xs text-gray-500">Combination products — another option</p>
            {filtered.combos.slice(0, 5).map(rowBtn)}
          </>
        )}
        {filtered.comboIntent && filtered.singles.length > 0 && (
          <>
            <p className="border-t px-3 py-1 text-xs text-gray-500">Single-ingredient</p>
            {filtered.singles.slice(0, 5).map(rowBtn)}
          </>
        )}
      </>
    )}
  </div>
)}
        </div>
        <div>
          <label className={labelCls}>Strength</label>
          <input className={inputCls} value={draft.strength} onChange={(e) => {set({ strength: e.target.value });  clearCoding();}} placeholder="e.g. 500 MG" />
        </div>
        <div>
          <label className={labelCls}>Form</label>
          <select className={inputCls} value={draft.form} onChange={(e) => pickForm(e.target.value)}>
            {Object.keys(FORM_ROUTES).map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Take (quantity per dose)</label>
          <input className={inputCls} value={draft.doseQty} onChange={(e) => set({ doseQty: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>Route</label>
          <input className={inputCls} value={draft.route} onChange={(e) => set({ route: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>Dispense quantity</label>
          <input className={inputCls} value={draft.dispenseQty} onChange={(e) => set({ dispenseQty: e.target.value })} placeholder="Total for the bottle" />
        </div>
        <div>
          <label className={labelCls}>Refills</label>
          <input className={inputCls} value={draft.refills} onChange={(e) => set({ refills: e.target.value })} placeholder="Type 0 if none" />
        </div>
        <div>
          <label className={labelCls}>DAW</label>
          <select className={inputCls} value={draft.daw} onChange={(e) => set({ daw: e.target.value })}>
            <option value="0">0 — substitution allowed</option>
            <option value="1">1 — dispense as written</option>
            <option value="2">2 — patient requested brand</option>
          </select>
        </div>
      </div>

      <div className="mt-5">
        <span className={labelCls}>Frequency</span>
        <div className="flex flex-wrap gap-2">
          {["QD", "QHS", "BID", "TID", "QID", "QOD", "QW", "PRN", "ONCE"].map((code) => (
            <button key={code} type="button" onClick={() => pickFrequency(code)} className={`rounded border px-3 py-1 text-sm ${draft.frequency === code ? "bg-neutral-700" : ""}`}>
              {code}
            </button>
          ))}
        </div>
      </div>

      {draft.frequency !== "PRN" && draft.frequency !== "ONCE" && draft.frequency !== "" && (
        <div className="mt-4">
          <span className={labelCls}>Times of day</span>
          <div className="flex flex-wrap gap-2">
            {Object.keys(TIME_PHRASES).map((t) => (
              <button key={t} type="button" onClick={() => toggleTime(t)} className={`rounded border px-3 py-1 text-sm ${draft.times.includes(t) ? "bg-neutral-700" : ""}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {draft.frequency === "PRN" && (
        <div className="mt-4">
          <label className={labelCls}>As needed for</label>
          <input className={inputCls} value={draft.prnReason} onChange={(e) => set({ prnReason: e.target.value })} placeholder="e.g. pain" />
        </div>
      )}

      <div className="mt-4">
        <label className={labelCls}>Notes for the patient</label>
        <input className={inputCls} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. Take with food" />
      </div>

      {allergyHit && (
        <div className="mt-4 rounded border border-red-500 bg-red-950 px-3 py-2 text-red-200">
            <p>
            ⚠ ALLERGY ALERT — this patient is allergic to {allergyLabelA(allergyHit.allergy)}
            {allergyReaction(allergyHit.allergy) ? ` (${allergyReaction(allergyHit.allergy)})` : ""}.{" "}
            {allergyHit.ingredient.charAt(0).toUpperCase() + allergyHit.ingredient.slice(1)} matches by {allergyHit.via}.
            </p>
    <label className="mt-2 flex items-center gap-2">
      <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
      Override — benefit outweighs risk
    </label>
    {override && (
      <input
        className="mt-2 w-full rounded border bg-white px-3 py-2 text-black"
        value={overrideNote}
        onChange={(e) => setOverrideNote(e.target.value)}
        placeholder="Override note (optional)"
      />
    )}
  </div>
)}
{allergies.length === 0 && (
  <label className="mt-4 flex items-center gap-2">
    <input type="checkbox" checked={ackAllergy} onChange={(e) => setAckAllergy(e.target.checked)} />
    Allergy status confirmed with patient (none recorded on chart)
  </label>
)}

      <div className="mt-6 rounded border border-neutral-700 p-4">
        <p className="text-sm opacity-70">Patient will read:</p>
        <p className="mt-1 font-semibold">{sigPreview(draft)}</p>
      </div>

      <button type="button" onClick={() => setShowPayload((s) => !s)} className="mt-4 rounded border px-3 py-1 text-sm">
        {showPayload ? "Hide" : "Show"} FHIR payload
      </button>
      {showPayload && (
        <pre className="mt-3 overflow-auto rounded border border-neutral-800 p-3 text-xs">
          {JSON.stringify(buildMedicationRequest(draft, id), null, 2)}
        </pre>
      )}

      <button type="button" disabled className="mt-6 block rounded border px-4 py-2 opacity-50">
        Submit order — goes live in Session 7
      </button>
    </main>
  );
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="p-6 opacity-70">Loading…</p>}>
      <OrderInner params={params} />
    </Suspense>
  );
}

