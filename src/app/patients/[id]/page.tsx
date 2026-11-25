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

  useEffect(() => {
  const obsUrl = `/api/fhir/Observation?patient=${id}&category=vital-signs&_sort=-date&_count=100`;
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
  ])
    .then(([p, ab, eb, ob]) => {
      setPatient(p);
      setAllergies((ab.entry ?? []).map((e: AnyRes) => e.resource));
      setEncounters((eb.entry ?? []).map((e: AnyRes) => e.resource));
      setObservations((ob.entry ?? []).map((e: AnyRes) => e.resource));
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

const bp = latestObs(observations, ["85354-9", "55284-4"]);
const hr = latestObs(observations, ["8867-4"]);
const temp = latestObs(observations, ["8310-5"]);
const rr = latestObs(observations, ["9279-1"]);
const spo2 = latestObs(observations, ["59408-5", "2708-6"]);
const heightO = latestObs(observations, ["8302-2"]);
const weightO = latestObs(observations, ["29463-7"]);
const bmiO = latestObs(observations, ["39156-5"]);

let bmi = bmiO ? obsValue(bmiO) : "—";
if (!bmiO && heightO?.valueQuantity && weightO?.valueQuantity) {
  const m = heightO.valueQuantity.value / 100;
  bmi = (weightO.valueQuantity.value / (m * m)).toFixed(1) + " kg/m2 (calc)";
}

function tile(label: string, o: any, value: string, flagged: boolean) {
  return { label, value, date: o ? obsDate(o) : "", flagged };
}

const tiles = [
  tile("Blood pressure", bp,
    bp ? `${bpPart(bp, "8480-6")} / ${bpPart(bp, "8462-4")} mmHg` : "—",
    bp ? Number(bpPart(bp, "8480-6")) >= 140 || Number(bpPart(bp, "8462-4")) >= 90 : false),
  tile("Heart rate", hr, hr ? obsValue(hr) : "—",
    hr?.valueQuantity ? isFlagged("8867-4", hr.valueQuantity.value, hr.valueQuantity.unit ?? "") : false),
  tile("Temperature", temp, temp ? obsValue(temp) : "—",
    temp?.valueQuantity ? isFlagged("8310-5", temp.valueQuantity.value, temp.valueQuantity.unit ?? "") : false),
  tile("Resp. rate", rr, rr ? obsValue(rr) : "—",
    rr?.valueQuantity ? isFlagged("9279-1", rr.valueQuantity.value, rr.valueQuantity.unit ?? "") : false),
  tile("SpO2", spo2, spo2 ? obsValue(spo2) : "—",
    spo2?.valueQuantity ? isFlagged("2708-6", spo2.valueQuantity.value, spo2.valueQuantity.unit ?? "") : false),
  tile("Height", heightO, heightO ? obsValue(heightO) : "—", false),
  tile("Weight", weightO, weightO ? obsValue(weightO) : "—", false),
  tile("BMI", bmiO ?? heightO, bmi, false),
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
          </div>
          <Link
            href={`/patients/${id}/edit`}
            className="rounded border px-4 py-2"
          >
            Edit
          </Link>
        </div>
        {allergies.length > 0 && (
          <div className="mt-4 rounded border border-red-500 bg-red-950 px-4 py-3 text-red-100">
            <strong>⚠ Allergies:</strong>{" "}
            {allergies.map(allergyLabel).join(" · ")}
          </div>
        )}
      </div>
      <section className="mt-8">
  <h2 className="mb-3 text-lg font-semibold">Past visits</h2>
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
</section>
    <section className="mt-8">
  <h2 className="text-lg font-semibold">Vitals</h2>
  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
    {tiles.map((t) => (
      <div key={t.label} className="rounded border border-neutral-700 p-3">
        <div className="text-xs uppercase tracking-wide opacity-60">{t.label}</div>
        <div className={`mt-1 text-lg font-medium ${t.flagged ? "text-red-400" : ""}`}>
          {t.value}{t.flagged ? " ⚠" : ""}
        </div>
        <div className="text-xs opacity-50">{t.date}</div>
      </div>
    ))}
  </div>
</section>
<p className="mt-8 opacity-70">Conditions and medications land here in Session 6.</p>
</main>
  );
}
