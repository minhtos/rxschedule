"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import PatientForm, {
  EMPTY_FORM,
  PatientFormValues,
} from "@/components/PatientForm";

type ExistingPatient = {
  id: string;
  name?: { family?: string; given?: string[] }[];
  birthDate?: string;
  address?: { line?: string[]; city?: string; state?: string }[];
};

// Create is gated behind a search (registration workflow):
// search last + first + DOB, review who already exists,
// and only then does the create form appear.
export default function NewPatientPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"search" | "form">("search");
  const [family, setFamily] = useState("");
  const [given, setGiven] = useState("");
  const [dob, setDob] = useState("");
  const [results, setResults] = useState<ExistingPatient[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const runGateSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearching(true);
    setSearchError(null);
    const params = new URLSearchParams({
      family: family.trim(),
      given: given.trim(),
      birthdate: dob,
    });
    try {
      const r = await fetch(`/api/fhir/Patient?${params}`);
      if (!r.ok) throw new Error(`FHIR server said ${r.status}`);
      const b = await r.json();
      setResults(
        (b.entry ?? []).map(
          (en: { resource: ExistingPatient }) => en.resource
        )
      );
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : "Search failed."
      );
    } finally {
      setSearching(false);
    }
  };

  const doCreate = async (v: PatientFormValues) => {
    const patient: Record<string, unknown> = {
      resourceType: "Patient",
      name: [{ family: v.family.trim(), given: [v.given.trim()] }],
      gender: v.gender,
      birthDate: v.birthDate,
    };
    if (v.line || v.city || v.state || v.postalCode) {
      patient.address = [
        {
          line: v.line ? [v.line] : [],
          city: v.city,
          state: v.state,
          postalCode: v.postalCode,
        },
      ];
    }
    const r = await fetch("/api/fhir/Patient", {
      method: "POST",
      headers: { "Content-Type": "application/fhir+json" },
      body: JSON.stringify(patient),
    });
    if (!r.ok) {
      let msg = `FHIR server said ${r.status}`;
      try {
        const oo = await r.json();
        const d = oo?.issue?.[0]?.diagnostics;
        if (d) msg = d;
      } catch {}
      throw new Error(msg);
    }
    router.push("/");
  };

  const describe = (p: ExistingPatient) => {
    const n = p.name?.[0];
    const a = p.address?.[0];
    const addr = a
      ? ` — ${(a.line ?? []).join(" ")}, ${a.city ?? ""}, ${a.state ?? ""}`
      : "";
    return `${n?.family ?? ""}, ${(n?.given ?? []).join(" ")} · DOB ${p.birthDate ?? "?"}${addr}`;
  };

  const inputCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900";
  const labelCls = "mb-1 block text-sm text-slate-600";

  if (phase === "form") {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="mb-6 text-2xl font-semibold text-mist-900">New patient</h1>
        <PatientForm
          initial={{
            ...EMPTY_FORM,
            family,
            given,
            birthDate: dob,
          }}
          submitLabel="Create patient"
          onSubmit={doCreate}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
    <Link href="/" className="mb-4 inline-block text-sm underline">
  ← Back to patients
</Link>
      <h1 className="mb-6 text-2xl font-semibold text-mist-900">New patient</h1>
      <p className="mb-4 text-slate-600">
        First, search to make sure this patient doesn&apos;t already exist.
      </p>

      <form onSubmit={runGateSearch} className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Last name</label>
            <input
              value={family}
              onChange={(e) => setFamily(e.target.value)}
              className={inputCls}
              autoFocus
            />
          </div>
          <div>
            <label className={labelCls}>First name</label>
            <input
              value={given}
              onChange={(e) => setGiven(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Date of birth</label>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={searching || !family || !given || !dob}
          className="rounded-lg bg-mist-600 px-4 py-2 text-white hover:bg-mist-700 disabled:opacity-40"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {searchError && <p className="mt-4 text-red-600">{searchError}</p>}

      {results !== null && (
        <div className="mt-6">
          {results.length === 0 ? (
            <p className="mb-4">No existing patient matches that search.</p>
          ) : (
            <>
              <p className="mb-2 font-medium">
                Existing patients matching that search:
              </p>
              <ul className="mb-4 list-inside list-disc">
                {results.map((p) => (
                  <li key={p.id} className="py-1">
  <Link href={`/patients/${p.id}`} className="text-mist-700 underline">
    {describe(p)}
  </Link>
</li>

                ))}
              </ul>
            </>
          )}
          <button
            onClick={() => setPhase("form")}
            className="rounded-lg bg-mist-600 px-4 py-2 text-white hover:bg-mist-700"
          >
            {results.length === 0
              ? "Create new patient"
              : "None of these is my patient — create new"}
          </button>
        </div>
      )}
    </main>
  );
}
