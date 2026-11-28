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
  customDirections?: string;
  modifier?: string;
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
  const unit = d.form === "liquid" ? "mL" : d.form;
  if (!d.drugName) return "Start by choosing a medication.";
  const intervalH = /^Q(\d+)H$/.exec(d.frequency || "")?.[1];
  if (intervalH) return `Take ${d.doseQty || "?"} ${unit}${unit !== "mL" && Number(d.doseQty) > 1 ? "s" : ""} ${d.route} every ${intervalH} hours${d.modifier ? `, ${d.modifier}` : ""}.`;
  const take = `Take ${d.doseQty || "?"} ${unit}${unit !== "mL" && Number(d.doseQty) > 1 ? "s" : ""} ${d.route}`;
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
  return `${take} ${when}${d.modifier ? `, ${d.modifier}` : ""}.`;
}

const MEAL_CODES: Record<string, string> = { "with meals": "C", "before meals": "AC", "on an empty stomach": "AC" };

function buildRepeat(d: OrderDraft) {
  const intervalH = /^Q(\d+)H$/.exec(d.frequency || "")?.[1];
  if (intervalH) return { frequency: 1, period: Number(intervalH), periodUnit: "h" };
  const meal = d.modifier ? MEAL_CODES[d.modifier] : undefined;
  return { when: meal ? [...d.times, meal] : d.times };
}

function buildMedicationRequest(d: OrderDraft, patientId: string) {
  return {
    resourceType: "MedicationRequest",
    status: "active",
    intent: "order",
    substitution: { allowed: d.daw !== "1" },
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
    authoredOn: todayLocal(),
    dosageInstruction: [
      {
        text: sigPreview(d),
        timing: { repeat: buildRepeat(d) },
        route: { text: d.route },
        doseAndRate: [
          { doseQuantity: { value: Number(d.doseQty) || 1, unit: d.form === "liquid" ? "mL" : d.form } },
        ],
      },
    ],
    dispenseRequest: {
      quantity: { value: Number(d.dispenseQty) || 0, unit: d.form === "liquid" ? "mL" : d.form },
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
const SIG_FREQS = ["QD", "QAM", "QHS", "BID", "TID", "QID", "QOD", "QW", "ONCE"];
const SIG_UNITS: Record<string, string> = { cap: "capsule", caps: "capsule", capsule: "capsule", capsules: "capsule", tab: "tablet", tabs: "tablet", tablet: "tablet", tablets: "tablet", ml: "liquid", tsp: "liquid", puff: "inhaler", puffs: "inhaler", drop: "drops", drops: "drops" };
type SigParse = { doseQty?: string; form?: string; frequency?: string; prnReason?: string; unknown: string[] };
function parseSig(raw: string): SigParse {
  const out: SigParse = { unknown: [] };
  const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);
  let prnAt = -1;
  tokens.forEach((tok, i) => {
    if (tok === "prn") { prnAt = i; out.frequency = "PRN"; return; }
    if (prnAt >= 0) return;
    const glued = tok.match(/^(\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?)([a-z]+\d*[a-z]*)$/);
    const word = glued ? glued[2] : tok;
    if (glued) out.doseQty = glued[1];
    else if (/^\d+(?:\.\d+)?(-\d+(?:\.\d+)?)?$/.test(tok)) { out.doseQty = tok; return; }
    if (SIG_UNITS[word]) { out.form = SIG_UNITS[word]; return; }
    if (SIG_FREQS.includes(word.toUpperCase())) { out.frequency = word.toUpperCase(); return; }
    if (/^q\d+h$/.test(word)) { out.frequency = word.toUpperCase(); return; }
    out.unknown.push(tok);
  });
  if (prnAt >= 0) out.prnReason = tokens.slice(prnAt + 1).join(" ");
  return out;
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

function todayLocal(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
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
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideNote, setOverrideNote] = useState("");
  const [ackAllergy, setAckAllergy] = useState(false);
  const [sigText, setSigText] = useState("");
  const [sigUnknown, setSigUnknown] = useState<string[]>([]);
  const [freeform, setFreeform] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  
useEffect(() => {
  setOverrideReason("");
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
  const applySig = (raw: string) => {
  setSigText(raw);
  const p = parseSig(raw);
  const patch: Partial<OrderDraft> = {};
  if (p.doseQty) patch.doseQty = p.doseQty;
  if (p.form && !picked) patch.form = p.form;
  if (p.prnReason !== undefined) patch.prnReason = p.prnReason;
  if (Object.keys(patch).length) set(patch);
  if (p.frequency) pickFrequency(p.frequency);
  setSigUnknown(p.unknown);
};

const submitOrder = async () => {
  setSubmitError("");
  if (allergyHit && !overrideReason) { setSubmitError("This drug matches a documented allergy. Choose an override reason in the alert, or change the drug."); return; }
  if (allergyHit && overrideReason === "Other" && !overrideNote.trim()) { setSubmitError("Type the override reason, or pick one of the listed reasons."); return; }
  if (allergies.length === 0 && !ackAllergy) { setSubmitError("Allergy status is not recorded for this patient. Confirm it with the patient and check the box above."); return; }
  const missing: string[] = [];
  if (!picked) missing.push("a drug — pick one from the search results");
  if (freeform) { if (!draft.customDirections?.trim()) missing.push("directions"); }
  else {
    if (!draft.doseQty) missing.push("a dose quantity");
    if (!draft.frequency) missing.push("a frequency");
  }
  if (!draft.dispenseQty) missing.push("a dispense quantity");
  if (draft.refills === "") missing.push("refills (type 0 if none)");
  if (missing.length) { setSubmitError(`Still needed: ${missing.join(", ")}.`); return; }
  setSubmitting(true);
  try {
    const body: any = buildMedicationRequest(draft, id);
    if (freeform) body.dosageInstruction = [{ text: draft.customDirections, ...(draft.notes ? { patientInstruction: draft.notes } : {}) }];
    else if (draft.notes) body.dosageInstruction[0].patientInstruction = draft.notes;
    if (overrideReason) body.note = [{ text: `Allergy override — ${overrideReason === "Other" ? overrideNote : overrideReason}` }];
    const res = await fetch(`/api/fhir/MedicationRequest`, { method: "POST", headers: { "Content-Type": "application/fhir+json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) { setSubmitError(data?.issue?.[0]?.diagnostics ?? `Server said ${res.status}.`); return; }
    setSubmitted(true);
  } catch { setSubmitError("Could not reach the FHIR server."); }
  finally { setSubmitting(false); }
};

  const resetForm = () => {
  setDraft(EMPTY_DRAFT);
  setQuery("");
  setRx(null);
  setRxFor("");
  setPicked(null);
  setListOpen(false);
  setSigText("");
  setSigUnknown([]);
  setFreeform(false);
  setOverrideReason("");
  setOverrideNote("");
  setAckAllergy(false);
  setSubmitError("");
  setSubmitted(false);
  setShowPayload(false);
};

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

const PER_DAY: Record<string, number> = { QD: 1, QHS: 1, BID: 2, TID: 3, QID: 4, QOD: 0.5, Q4H: 6, Q6H: 4, Q8H: 3, Q12H: 2};
const doseN = Number(draft.doseQty);
const dispN = Number(draft.dispenseQty);
const perDay = PER_DAY[draft.frequency] ?? 0;
const topical = draft.form === "cream" || draft.form === "ointment";
const daysSupply = !freeform && !topical && perDay > 0 && doseN > 0 && dispN > 0 ? dispN / (doseN * perDay) : null;
const wholeDays = daysSupply !== null && Number.isInteger(daysSupply);
const fixLow = daysSupply !== null ? Math.floor(daysSupply) * doseN * perDay : 0;
const fixHigh = daysSupply !== null ? Math.ceil(daysSupply) * doseN * perDay : 0;
const qwDoses = draft.frequency === "QW" && doseN > 0 && dispN > 0 ? dispN / doseN : null;
const UNIT_WORDS: Record<string, string> = { tablet: "tablets", capsule: "capsules", liquid: "mL", cream: "g", ointment: "g", drops: "mL", inhaler: "inhalers", injection: "mL" };
const unitWord = UNIT_WORDS[draft.form] ?? "";
const isPen = (draft.rxDisplay ?? "").toLowerCase().includes("pen injector");
const pens = isPen && dispN > 0 ? dispN / 3 : null;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href={`/patients/${id}`} className="text-sm underline">← Back to chart</Link>
      <h1 className="mt-3 text-2xl font-bold">New order</h1>
      <p className="mt-1 opacity-80">{name} · DOB {fmtDob(patient.birthDate)}
        · Order date {fmtDob(todayLocal())}
      </p>
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

      <h2 className="mt-6 text-lg font-semibold">1 · Drug {picked && <span className="text-green-400">✓</span>}</h2>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="relative sm:col-span-3">
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
{query.trim() && !picked && (
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
        <div className="sm:col-span-1">
          <label className={labelCls}>DAW</label>
          <select className={inputCls} value={draft.daw} onChange={(e) => set({ daw: e.target.value })}>
            <option value="0">0 — substitution allowed</option>
            <option value="1">1 — dispense as written</option>
            <option value="2">2 — patient requested brand</option>
          </select>
        </div>
  {picked && (
  <div className="rounded border border-green-600 bg-green-950 px-3 py-2 sm:col-span-4">
    <p className="text-green-300">{draft.rxDisplay} ✓</p>
    <p className="text-xs opacity-70">RxNorm code {draft.rxcui}</p>
  </div>
)}
{allergyHit && (
        <div className="mt-4 rounded border border-red-500 bg-red-950 px-3 py-2 sm:col-span-4 text-red-200">
            <p>
  ⚠ ALLERGY ALERT — {allergyLabelA(allergyHit.allergy)}
  {allergyReaction(allergyHit.allergy) ? ` (${allergyReaction(allergyHit.allergy)})` : ""}{" "}
  — {allergyHit.ingredient.charAt(0).toUpperCase() + allergyHit.ingredient.slice(1)} ({allergyHit.via}).
</p>
    <div className="mt-2">
  <p className="text-sm">Override — choose a reason:</p>
  {["Side effect, not a true allergy — confirmed with patient", "Patient has taken this drug successfully before", "Other"].map((r) => (
    <label key={r} className="mt-1 flex items-center gap-2 text-sm">
      <input type="radio" name="overrideReason" checked={overrideReason === r} onChange={() => setOverrideReason(r)} />
      {r}
    </label>
  ))}
  {overrideReason === "Other" && (
    <input className="mt-2 w-full rounded border bg-white px-3 py-2 text-black" value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)} placeholder="Type the override reason" />
  )}
  </div>
  </div>
)}
<h2 className="mt-2 text-lg font-semibold sm:col-span-4">2 · Quantity {draft.dispenseQty && <span className="text-green-400">✓</span>}</h2>
        <div className="sm:col-span-2">
          <label className={labelCls}>Dispense quantity</label>
          <div className="flex items-center gap-2">
          <div className="flex-1">
          <input className={inputCls} value={draft.dispenseQty} placeholder="Total for the bottle" onChange={(e) => set({ dispenseQty: e.target.value })} />
        </div>
  <span className="text-sm opacity-70">{unitWord}</span>
</div>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Refills</label>
          <input className={inputCls} value={draft.refills} onChange={(e) => set({ refills: e.target.value })} placeholder="Type 0 if none" />
        </div>
        {daysSupply !== null && (wholeDays ? (
  <p className="text-sm text-green-400 sm:col-span-4">= {daysSupply} days supply ✓</p>
) : daysSupply <= 14 ? (
  <p className="text-sm opacity-70 sm:col-span-4">
    = {daysSupply.toFixed(1)} days supply at this rate. Round to{" "}
    <button type="button" className="underline" onClick={() => set({ dispenseQty: String(fixLow) })}>{fixLow} ({Math.floor(daysSupply)} days)</button>{" "}or{" "}
    <button type="button" className="underline" onClick={() => set({ dispenseQty: String(fixHigh) })}>{fixHigh} ({Math.ceil(daysSupply)} days)</button>{" "}if you want whole days.
  </p>
) : (
  <p className="text-sm text-amber-400 sm:col-span-4">
    {dispN} {unitWord} at {doseN * perDay} per day = {daysSupply.toFixed(1)} days — not whole days. Use{" "}
    <button type="button" className="underline" onClick={() => set({ dispenseQty: String(fixLow) })}>{fixLow} ({Math.floor(daysSupply)} days)</button>{" "}or{" "}
    <button type="button" className="underline" onClick={() => set({ dispenseQty: String(fixHigh) })}>{fixHigh} ({Math.ceil(daysSupply)} days)</button>
  </p>
))}
{qwDoses !== null && (
  <p className="text-sm text-green-400 sm:col-span-4">= {qwDoses} weekly doses ({qwDoses} weeks)</p>
)}
{pens !== null && (Number.isInteger(pens) ? (
  <p className="text-sm opacity-70 sm:col-span-4">({dispN} mL = {pens} pens{pens % 5 === 0 ? ` = ${pens / 5} pack${pens === 5 ? "" : "s"}` : ""})</p>
) : (
  <p className="text-sm text-amber-400 sm:col-span-4">Pens are 3 mL each — use {Math.floor(pens) * 3} mL ({Math.floor(pens)} pens) or {Math.ceil(pens) * 3} mL ({Math.ceil(pens)} pens)</p>
))}
        <h2 className="mt-2 text-lg font-semibold sm:col-span-4">3 · Directions {(freeform ? !!draft.customDirections?.trim() : !!draft.frequency) && <span className="text-green-400">✓</span>}</h2>
        <div className="sm:col-span-4">
  <div className="flex items-center justify-between">
  <label className={labelCls}>Sig</label>
  <div className="flex gap-1">
  <button type="button" onClick={() => setFreeform(false)} className={`rounded border px-3 py-1 text-sm ${!freeform ? "bg-white text-black" : ""}`}>Structured</button>
  <button type="button" onClick={() => setFreeform(true)} className={`rounded border px-3 py-1 text-sm ${freeform ? "bg-white text-black" : ""}`}>Freeform</button>
</div>
  </div>
  <input className={inputCls} value={sigText} disabled={freeform} placeholder="e.g. 1 cap tid — or tap the helpers below" onChange={(e) => applySig(e.target.value)} />
  <p className="mt-1 text-xs opacity-70">Reads as: {[draft.doseQty, draft.form, draft.frequency === "PRN" ? `PRN ${draft.prnReason}`.trim() : draft.frequency].filter(Boolean).join(" ") || "—"}</p>
  {sigUnknown.length > 0 && <p className="mt-1 text-xs text-amber-400">Didn&apos;t understand: {sigUnknown.join(", ")}</p>}
</div>
{freeform && (
  <div className="sm:col-span-4">
    <label className={labelCls}>Custom directions — printed on the label exactly as typed</label>
    <textarea className={inputCls} rows={3} value={draft.customDirections ?? ""} placeholder="e.g. Apply a pea-sized amount to the affected area twice daily" onChange={(e) => set({ customDirections: e.target.value })} />
    <p className="mt-1 text-xs opacity-70">While Freeform is on, the label uses this text and the structured helpers are ignored.</p>
  </div>
)}
        <div className="sm:col-span-2">
          <label className={labelCls}>Take (quantity per dose)</label>
          <input className={inputCls} value={draft.doseQty} onChange={(e) => set({ doseQty: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Route</label>
          <input className={inputCls} value={draft.route} onChange={(e) => set({ route: e.target.value })} />
        </div>    
      </div>
      <div className="mt-5">
        <span className={labelCls}>Frequency</span>
        <div className="flex flex-wrap gap-2">
          {["QD", "QHS", "BID", "TID", "QID", "QOD", "QW", "PRN", "Q4H", "Q6H", "Q8H", "Q12H", "ONCE"].map((code) => (
            <button key={code} type="button" onClick={() => pickFrequency(code)} className={`rounded border px-3 py-1 text-sm ${draft.frequency === code ? "bg-neutral-700" : ""}`}>
              {code}
            </button>
          ))}
        </div>
      </div>

      {draft.frequency !== "PRN" && draft.frequency !== "ONCE" && draft.frequency !== "" && !/^Q\d+H$/.test(draft.frequency) && (
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

      <div className="sm:col-span-4">
          <label className="text-sm opacity-80">Meal timing</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {[["", "None"], ["with meals", "With meals"], ["before meals", "Before meals"], ["on an empty stomach", "On an empty stomach"]].map(([value, label]) => (
      <button key={label} type="button" onClick={() => set({ modifier: value })} className={`rounded border px-3 py-1 text-sm ${(draft.modifier ?? "") === value ? "bg-white text-black" : ""}`}>{label}</button>))}
        </div>
      </div>

      <div className="mt-4">
        <label className={labelCls}>Notes for the patient</label>
        <input className={inputCls} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. Take with food" />
      </div>
{allergies.length === 0 && (
  <label className="mt-4 flex items-center gap-2">
    <input type="checkbox" checked={ackAllergy} onChange={(e) => setAckAllergy(e.target.checked)} />
    Allergy status confirmed with patient (none recorded on chart)
  </label>
)}

      <div className="mt-6 rounded border bg-white p-4 text-black shadow">
  <p className="text-xs uppercase tracking-wide text-gray-500">Pharmacy label preview</p>
  <p className="mt-1 font-semibold">{patient.name?.[0]?.family}, {patient.name?.[0]?.given?.join(" ")}</p>
  <p className="text-sm">Written: {fmtDob(todayLocal())}</p>
  <p className="font-semibold">{draft.rxDisplay ?? `${draft.drugName} ${draft.strength}`.trim()}</p>
  <p className="text-sm">Qty: {draft.dispenseQty || "—"} {unitWord}</p>
  <p className="mt-1">{freeform && draft.customDirections?.trim() ? draft.customDirections : sigPreview(draft)}</p>
  <p className="text-sm">Refills: {draft.refills === "" ? "—" : draft.refills}</p>
      </div>

      <button type="button" onClick={() => setShowPayload((s) => !s)} className="mt-4 rounded border px-3 py-1 text-sm">
        {showPayload ? "Hide" : "Show"} FHIR payload
      </button>
      {showPayload && (
        <pre className="mt-3 overflow-auto rounded border border-neutral-800 p-3 text-xs">
          {JSON.stringify(buildMedicationRequest(draft, id), null, 2)}
        </pre>
      )}
        {submitted ? (
  <div className="mt-6 rounded border border-green-600 bg-green-950 px-3 py-2">
    <p className="text-green-300">Order placed ✓</p>
    <Link href={`/patients/${id}`} className="text-sm underline">Back to chart to see it in the medication list →</Link>
    <button type="button" onClick={resetForm} className="mt-2 block text-sm underline">Place another order</button>
    </div>) : (
  <div className="mt-6">
    <button type="button" disabled={submitting} onClick={submitOrder} className="rounded bg-white px-4 py-2 text-black disabled:opacity-50">{submitting ? "Placing order…" : "Submit order"}</button>
    {submitError && <p className="mt-2 text-sm text-red-400">{submitError}</p>}
  </div>
)}
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

