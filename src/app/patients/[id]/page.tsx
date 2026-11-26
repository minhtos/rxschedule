"use client";

import { Suspense, use, useEffect, useState } from "react";
import Link from "next/link";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRes = Record<string, any>;

function displayName(p: AnyRes): string {
  const n = p.name?.[0];
  if (!n) return "(no name)";
  return `${n.family ?? ""}, ${(n.given ?? []).join(" ")}`.trim();
}

function displayDob(iso?: string): string {
  if (!iso) return "";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[1]}/${parts[2]}/${parts[0]}`;
}

function ageFrom(iso?: string): string {
  if (!iso || iso.split("-").length !== 3) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d))
    age--;
  return `${age} y/o`;
}

function allergyLabel(a: AnyRes): string {
  const substance =
    a.code?.coding?.[0]?.display ?? a.code?.text ?? "Unknown substance";
  const reaction =
    a.reaction?.[0]?.manifestation?.[0]?.coding?.[0]?.display ??
    a.reaction?.[0]?.manifestation?.[0]?.text;
  const crit = a.criticality === "high" ? " — HIGH criticality" : "";
  return reaction
    ? `${substance} — ${reaction}${crit}`
    : `${substance}${crit}`;
}

function isNkda(a: any): boolean {
  const codings = a?.code?.coding ?? [];
  if (codings.some((c: any) => c.code === "409137002" || c.code === "716186003")) {
    return true;
  }
  const label = (a?.code?.text ?? codings[0]?.display ?? "").toLowerCase();
  return label.includes("no known allerg");
}

function conditionLabel(c: any): string {
  return c?.code?.coding?.[0]?.display ?? c?.code?.text ?? "Condition";
}

function conditionOnset(c: any): string {
  const d = c?.onsetDateTime ?? c?.recordedDate;
  return d ? displayDob(String(d).slice(0, 10)) : "";
}

function medLabel(m: any): string {
  const cc = m?.medicationCodeableConcept;
  if (cc) return cc.coding?.[0]?.display ?? cc.text ?? "Medication";
  const ref = m?.medicationReference;
  if (ref) return ref.display ?? "Medication";
  return "Medication";
}

function medSig(m: any): string {
  return m?.dosageInstruction?.[0]?.text ?? "";
}

function patientPhone(p: any): string {
  const t = (p?.telecom ?? []).find((x: any) => x.system === "phone");
  return t?.value ?? "";
}

function patientAddress(p: any): string {
  const a = p?.address?.[0];
  if (!a) return "";
  const street = (a.line ?? []).join(" ");
  return [street, a.city, a.state, a.postalCode].filter(Boolean).join(", ");
}

function obsCode(o: any): string {
  return o?.code?.coding?.[0]?.code ?? "";
}

function latestObs(observations: any[], codes: string[]) {
  return observations.find((o) => codes.includes(obsCode(o)));
}

function obsValue(o: any): string {
  const v = o?.valueQuantity;
  if (!v) return "—";
  return `${v.value}${v.unit ? " " + v.unit : ""}`;
}

function obsDate(o: any): string {
  const d = o?.effectiveDateTime;
  return d ? displayDob(d.slice(0, 10)) : "";
}

function bpPart(panel: any, code: string): string {
  const c = panel?.component?.find((x: AnyRes) => x.code?.coding?.[0]?.code === code);
  return c?.valueQuantity ? `${c.valueQuantity.value}` : "—";
}

function isFlagged(code: string, value: number, unit: string): boolean {
  if (code === "8867-4") return value < 60 || value > 100;
  if (code === "9279-1") return value < 12 || value > 20;
  if (code === "59408-5" || code === "2708-6") return value < 95;
  if (code === "8310-5") return unit.includes("Cel") ? value < 36 || value > 37.5 : value < 97 || value > 99.5;
  return false;
}

function obsSeries(observations: any[], codes: string[]) {
  return observations
    .filter((o) => codes.includes(obsCode(o)))
    .map((o) => ({
      date: obsDate(o),
      value: o?.valueQuantity?.value as number | undefined,
      unit: o?.valueQuantity?.unit ?? "",
    }));
}

function bpSeries(observations: any[]) {
  return observations
    .filter((o) => ["85354-9", "55284-4"].includes(obsCode(o)))
    .map((o) => ({
      date: obsDate(o),
      sys: Number(bpPart(o, "8480-6")) || undefined,
      dia: Number(bpPart(o, "8462-4")) || undefined,
    }));
}
function TrendChart({ lines }: { lines: { color: string; points: number[] }[] }) {
  const all = lines.flatMap((l) => l.points);
  if (all.length < 2) {
    return <p className="text-sm opacity-70">Not enough readings to chart yet.</p>;
  }
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const W = 600;
  const H = 160;
  const PAD = 10;
  const toPoints = (pts: number[]) =>
    pts
      .map(
        (v, i) =>
          `${PAD + (i / (pts.length - 1)) * (W - PAD * 2)},${H - PAD - ((v - min) / range) * (H - PAD * 2)}`
      )
      .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {lines.map((l, i) => (
        <polyline key={i} fill="none" stroke={l.color} strokeWidth="2" points={toPoints(l.points)} />
      ))}
    </svg>
  );
}

function Section({ title, defaultOpen = true, children }: any) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mt-8">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left"
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-sm opacity-60">{open ? "▾ Hide" : "▸ Show"}</span>
      </button>
      {open && children}
    </section>
  );
}

export default function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-5xl p-8">
          <p>Loading…</p>
        </main>
      }
    >
      <PatientDetailInner params={params} />
    </Suspense>
  );
}

function PatientDetailInner({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [patient, setPatient] = useState<AnyRes | null>(null);
  const [allergies, setAllergies] = useState<AnyRes[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [encounters, setEncounters] = useState<AnyRes[]>([]);
  const [observations, setObservations] = useState<AnyRes[]>([]);
  const [conditions, setConditions] = useState<any[]>([]);
  const [medRequests, setMedRequests] = useState<any[]>([]);
  const [openVital, setOpenVital] = useState<string | null>(null);
  const [trendMode, setTrendMode] = useState<"table" | "graph">("table");

  useEffect(() => {
  const obsUrl = `/api/fhir/Observation?patient=${id}&category=vital-signs&_sort=-date&_count=100`;
  const condUrl = `/api/fhir/Condition?patient=${id}&clinical-status=active&_count=100`;
  const medUrl = `/api/fhir/MedicationRequest?patient=${id}&_sort=-authoredon&_count=100`;
  Promise.all([
    fetch(`/api/fhir/Patient/${id}`).then((r) => {
      if (!r.ok) throw new Error(`Patient: FHIR server said ${r.status}`);
      return r.json();
    }),
    fetch(`/api/fhir/AllergyIntolerance?patient=${id}`).then((r) =>
      r.ok ? r.json() : { entry: [] }
    ),
    fetch(`/api/fhir/Encounter?patient=${id}&_sort=-date&_count=20`).then((r) =>
      r.ok ? r.json() : { entry: [] }
    ),
    fetch(obsUrl).then((r) => (r.ok ? r.json() : { entry: [] })),
    fetch(condUrl).then((r) => (r.ok ? r.json() : { entry: [] })),
    fetch(medUrl).then((r) => (r.ok ? r.json() : { entry: [] })),
  ])
    .then(([p, ab, eb, ob, cb, mb]) => {
      setPatient(p);
      setAllergies((ab.entry ?? []).map((e: AnyRes) => e.resource));
      setEncounters((eb.entry ?? []).map((e: AnyRes) => e.resource));
      setObservations((ob.entry ?? []).map((e: AnyRes) => e.resource));
      setConditions((cb.entry ?? []).map((e: AnyRes) => e.resource));
      setMedRequests((mb.entry ?? []).map((e: AnyRes) => e.resource));
    })
    .catch((e) => setError(e.message));
}, [id]);

  if (error)
    return (
      <main className="mx-auto max-w-5xl p-8">
        <p className="text-red-600">Error: {error}</p>
      </main>
    );
  if (!patient)
        return (
      <main className="mx-auto max-w-5xl p-8">
        <p>Loading…</p>
      </main>
    );
const realAllergies = allergies.filter((a) => !isNkda(a));
const hasNkda = allergies.some(isNkda);
const visibleConditions = conditions.filter((c) => {
  const v = c?.verificationStatus?.coding?.[0]?.code;
  return v !== "refuted" && v !== "entered-in-error";
});
const activeMeds = medRequests.filter((m) => m.status === "active");
const bp = latestObs(observations, ["85354-9", "55284-4"]);
const hr = latestObs(observations, ["8867-4"]);
const temp = latestObs(observations, ["8310-5"]);
const rr = latestObs(observations, ["9279-1"]);
const spo2 = latestObs(observations, ["59408-5", "2708-6"]);
const heightO = latestObs(observations, ["8302-2"]);
const weightO = latestObs(observations, ["29463-7"]);
const bmiO = latestObs(observations, ["39156-5"]);

const TREND_CODES: Record<string, string[]> = {
  hr: ["8867-4"],
  temp: ["8310-5"],
  rr: ["9279-1"],
  spo2: ["59408-5", "2708-6"],
  height: ["8302-2"],
  weight: ["29463-7"],
  bmi: ["39156-5"],
};

const TREND_TITLES: Record<string, string> = {
  bp: "Blood pressure",
  hr: "Heart rate",
  temp: "Temperature",
  rr: "Resp rate",
  spo2: "SpO2",
  height: "Height",
  weight: "Weight",
  bmi: "BMI",
};

const isBp = openVital === "bp";
const bpRows = isBp ? bpSeries(observations) : [];
const singleRows =
  openVital && !isBp ? obsSeries(observations, TREND_CODES[openVital] ?? []) : [];
const chartLines = isBp
  ? [
      { color: "#f87171", points: [...bpRows].reverse().map((r) => r.sys).filter((v): v is number => typeof v === "number") },
      { color: "#60a5fa", points: [...bpRows].reverse().map((r) => r.dia).filter((v): v is number => typeof v === "number") },
    ]
  : [
      { color: "#7dd3fc", points: [...singleRows].reverse().map((r) => r.value).filter((v): v is number => typeof v === "number") },
    ];

let bmi = bmiO ? obsValue(bmiO) : "—";
if (!bmiO && heightO?.valueQuantity && weightO?.valueQuantity) {
  const m = heightO.valueQuantity.value / 100;
  bmi = (weightO.valueQuantity.value / (m * m)).toFixed(1) + " kg/m2 (calc)";
}

function tile(label: string, o: any, value: string, flagged: boolean,vitalKey: string) {
  return { label, value, date: o ? obsDate(o) : "", flagged, key: vitalKey };
}

const tiles = [
  tile("Blood pressure", bp,
    bp ? `${bpPart(bp, "8480-6")} / ${bpPart(bp, "8462-4")} mmHg` : "—",
    bp ? Number(bpPart(bp, "8480-6")) >= 140 || Number(bpPart(bp, "8462-4")) >= 90 : false, "bp"),
  tile("Heart rate", hr, hr ? obsValue(hr) : "—",
    hr?.valueQuantity ? isFlagged("8867-4", hr.valueQuantity.value, hr.valueQuantity.unit ?? "") : false, "hr"),
  tile("Temperature", temp, temp ? obsValue(temp) : "—",
    temp?.valueQuantity ? isFlagged("8310-5", temp.valueQuantity.value, temp.valueQuantity.unit ?? "") : false, "temp"),
  tile("Resp. rate", rr, rr ? obsValue(rr) : "—",
    rr?.valueQuantity ? isFlagged("9279-1", rr.valueQuantity.value, rr.valueQuantity.unit ?? "") : false, "rr"),
  tile("SpO2", spo2, spo2 ? obsValue(spo2) : "—",
    spo2?.valueQuantity ? isFlagged("2708-6", spo2.valueQuantity.value, spo2.valueQuantity.unit ?? "") : false, "spo2"),
  tile("Height", heightO, heightO ? obsValue(heightO) : "—", false, "height"),
  tile("Weight", weightO, weightO ? obsValue(weightO) : "—", false, "weight"),
  tile("BMI", bmiO ?? heightO, bmi, false, "bmi"),
];

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="sticky top-0 z-10 -mx-8 bg-black px-8 pb-4 dark:bg-black">
        <Link href="/" className="mb-2 inline-block text-sm underline">
          ← Back to patients
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{displayName(patient)}</h1>
<p className="mt-1 text-sm opacity-80">
  {ageFrom(patient.birthDate)} · {patient.gender ?? ""} · DOB{" "}
  {displayDob(patient.birthDate)}
</p>
{(patientPhone(patient) || patientAddress(patient)) && (
  <p className="mt-1 text-sm opacity-80">
    {[patientPhone(patient), patientAddress(patient)].filter(Boolean).join(" · ")}
  </p>
)}
          </div>
          <Link
            href={`/patients/${id}/edit`}
            className="rounded border px-4 py-2"
          >
            Edit
          </Link>
        </div>
        {realAllergies.length > 0 && (
          <div className="mt-4 rounded border border-red-500 bg-red-950 px-4 py-3 text-red-100">
            <strong>⚠ Allergies:</strong>{" "}
            {realAllergies.map(allergyLabel).join(" · ")}
          </div>
        )}
        {realAllergies.length === 0 && hasNkda && (
  <div className="mt-4 rounded border border-slate-300 bg-slate-50 px-4 py-3 text-slate-600">
    ✓ No known allergies — documented
  </div>
)}

{allergies.length === 0 && (
  <div className="mt-4 rounded border border-dashed border-amber-500 bg-amber-50 px-4 py-3 text-amber-800">
    ⚠ Allergies not recorded — verify before prescribing
  </div>
)}
      </div>
      <Section title="Vitals">
  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
    {tiles.map((t) => (
      <div key={t.label} onClick={() => setOpenVital(openVital === t.key ? null : t.key)} className="cursor-pointer rounded border border-neutral-700 p-3">
        <div className="text-xs uppercase tracking-wide opacity-60">{t.label}</div>
        <div className={`mt-1 text-lg font-medium ${t.flagged ? "text-red-400" : ""}`}>
          {t.value}{t.flagged ? " ⚠" : ""}
        </div>
        <div className="text-xs opacity-50">{t.date}</div>
      </div>
    ))}
  </div>

  {openVital && (
  <div className="mt-4 rounded border border-neutral-700 p-4">
    <div className="mb-3 flex items-center gap-2">
      <span className="font-semibold">{TREND_TITLES[openVital]}</span>
      <button type="button" onClick={() => setTrendMode("table")} className={`rounded border px-2 py-1 text-sm ${trendMode === "table" ? "bg-neutral-700" : ""}`}>Table</button>
      <button type="button" onClick={() => setTrendMode("graph")} className={`rounded border px-2 py-1 text-sm ${trendMode === "graph" ? "bg-neutral-700" : ""}`}>Graph</button>
    </div>
    {(isBp ? bpRows.length : singleRows.length) === 0 ? (
      <p className="text-sm opacity-70">No readings recorded.</p>
    ) : trendMode === "table" ? (
      <ul className="space-y-1 text-sm">
        {(isBp ? bpRows : singleRows).map((r: any, i: number) => (
          <li key={i} className="flex justify-between border-b border-neutral-800 py-1">
            <span>{r.date}</span>
            <span>{isBp ? `${r.sys ?? "—"} / ${r.dia ?? "—"} mmHg` : `${r.value ?? "—"} ${r.unit ?? ""}`}</span>
          </li>
        ))}
      </ul>
    ) : (
      <TrendChart lines={chartLines} />
    )}
    
  </div>
)}
</Section>
      <Section title="Past visits">
  {encounters.length === 0 && (
    <p className="opacity-70">No visits on file.</p>
  )}
  <ul className="space-y-2">
    {encounters.map((en) => (
      <li key={en.id} className="rounded border px-4 py-3">
        <span className="font-medium">
          {displayDob((en.period?.start ?? "").slice(0, 10))}
        </span>{" "}
        ·{" "}
        {en.type?.[0]?.coding?.[0]?.display ??
          en.type?.[0]?.text ??
          en.class?.display ??
          "Visit"}
        {en.reasonCode?.[0]?.coding?.[0]?.display && (
          <span className="opacity-80">
            {" "}
            — {en.reasonCode[0].coding[0].display}
          </span>
        )}
      </li>
    ))}
  </ul>
</Section>
<Section title="Conditions">
    {visibleConditions.length === 0 ? (
    <p className="mt-2 opacity-70">No active conditions on file.</p>
  ) : (
    <ul className="mt-3 space-y-2">
      {visibleConditions.map((c) => (
        <li key={c.id} className="rounded border border-neutral-700 p-3">
          {conditionLabel(c)}
          {conditionOnset(c) && (
            <span className="opacity-60"> · since {conditionOnset(c)}</span>
          )}
        </li>
      ))}
    </ul>
  )}
</Section>

<Section title="Medications">
    {activeMeds.length === 0 ? (
    <p className="mt-2 opacity-70">No active medications.</p>
  ) : (
    <ul className="mt-3 space-y-2">
      {activeMeds.map((m) => (
        <li key={m.id} className="rounded border border-neutral-700 p-3">
          <div>{medLabel(m)}</div>
          {medSig(m) && <div className="text-sm opacity-70">{medSig(m)}</div>}
        </li>
      ))}
    </ul>
  )}
</Section>

<Section title="Medication history" defaultOpen={false}>
  {medRequests.length === 0 ? (
    <p className="mt-2 opacity-70">No medication history.</p>
  ) : (
    <ul className="mt-3 space-y-2">
      {medRequests.map((m) => (
        <li key={m.id} className="rounded border border-neutral-700 p-3">
          <div>
            {medLabel(m)}
            <span className="ml-2 rounded border px-2 py-0.5 text-xs uppercase">
              {m.status ?? "unknown"}
            </span>
          </div>
          <div className="text-sm opacity-70">
            {m.authoredOn ? `Ordered ${displayDob(m.authoredOn.slice(0, 10))}` : ""}
            {medSig(m) ? ` · ${medSig(m)}` : ""}
          </div>
        </li>
      ))}
    </ul>
  )}
</Section>
</main>
  );
}
