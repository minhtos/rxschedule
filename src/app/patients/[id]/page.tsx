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

  useEffect(() => {
    Promise.all([
      fetch(`/api/fhir/Patient/${id}`).then((r) => {
        if (!r.ok) throw new Error(`Patient: FHIR server said ${r.status}`);
        return r.json();
      }),
      fetch(`/api/fhir/AllergyIntolerance?patient=${id}`).then((r) =>
        r.ok ? r.json() : { entry: [] }
      ),
      fetch(`/api/fhir/Encounter?patient=${id}&_sort=-date&_count=20`
      ).then((r) => (r.ok ? r.json() : { entry: [] })
      ),
    ])
      .then(([p, ab, eb]) => {
        setPatient(p);
        setAllergies((ab.entry ?? []).map((e: AnyRes) => e.resource));
        setEncounters((eb.entry ?? []).map((e: AnyRes) => e.resource));
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
<p className="mt-8 opacity-70">
  Vitals, conditions, and medications land here in Session 6.
</p>
</main>
  );
}
