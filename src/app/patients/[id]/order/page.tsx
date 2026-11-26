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
    medicationCodeableConcept: { text: `${d.drugName} ${d.strength}`.trim() },
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

function isNkdaA(a: any): boolean {
  const codings = a?.code?.coding ?? [];
  if (codings.some((c: any) => c?.code === "409137002" || c?.code === "716186003")) return true;
  const text = (a?.code?.text ?? codings[0]?.display ?? "").toLowerCase();
  return text.includes("no known allerg");
}

function allergyLabelA(a: any): string {
  return a?.code?.coding?.[0]?.display ?? a?.code?.text ?? "Allergy";
}

function OrderInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [patient, setPatient] = useState<any>(null);
  const [allergies, setAllergies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<OrderDraft>(EMPTY_DRAFT);
  const [showPayload, setShowPayload] = useState(false);

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
  const pickForm = (form: string) => set({ form, route: FORM_ROUTES[form] ?? draft.route });

  const realAllergies = allergies.filter((a) => !isNkdaA(a));
  const name = `${patient.name?.[0]?.family ?? ""}, ${patient.name?.[0]?.given?.join(" ") ?? ""}`;
  const inputCls = "w-full rounded border border-neutral-700 bg-white px-3 py-2 text-black";
  const labelCls = "mb-1 block text-sm opacity-80";

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href={`/patients/${id}`} className="text-sm underline">← Back to chart</Link>
      <h1 className="mt-3 text-2xl font-bold">New order</h1>
      <p className="mt-1 opacity-80">{name} · DOB {patient.birthDate}</p>
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
        <div>
          <label className={labelCls}>Medication</label>
          <input className={inputCls} value={draft.drugName} onChange={(e) => set({ drugName: e.target.value })} placeholder="Drug search arrives in Session 7" />
        </div>
        <div>
          <label className={labelCls}>Strength</label>
          <input className={inputCls} value={draft.strength} onChange={(e) => set({ strength: e.target.value })} placeholder="e.g. 500 MG" />
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

