"use client";

import { Suspense, use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PatientForm, {
  EMPTY_FORM,
  PatientFormValues,
} from "@/components/PatientForm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPatient = Record<string, any>;

export default function EditPatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-3xl p-8">
          <p>Loading…</p>
        </main>
      }
    >
      <EditPatientInner params={params} />
    </Suspense>
  );
}

function EditPatientInner({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [original, setOriginal] = useState<AnyPatient | null>(null);
  const [initial, setInitial] = useState<PatientFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/fhir/Patient/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`FHIR server said ${r.status}`);
        return r.json();
      })
      .then((p: AnyPatient) => {
        setOriginal(p);
        const n = p.name?.[0];
        const a = p.address?.[0];
        setInitial({
          family: n?.family ?? "",
          given: (n?.given ?? []).join(" "),
          gender: p.gender ?? "",
          birthDate: p.birthDate ?? "",
          line: (a?.line ?? []).join(" "),
          city: a?.city ?? "",
          state: a?.state ?? "",
          postalCode: a?.postalCode ?? "",
        });
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const save = async (v: PatientFormValues) => {
    if (!original) return;
    // GET-whole → change edited fields → PUT-whole.
    // Everything the form doesn't show (identifiers, telecom,
    // meta) rides along untouched in `original`.
    const updated: AnyPatient = {
      ...original,
      name: [
        {
          ...(original.name?.[0] ?? {}),
          family: v.family.trim(),
          given: [v.given.trim()],
        },
      ],
      gender: v.gender,
      birthDate: v.birthDate,
    };
    if (v.line || v.city || v.state || v.postalCode) {
      updated.address = [
        {
          line: v.line ? [v.line] : [],
          city: v.city,
          state: v.state,
          postalCode: v.postalCode,
        },
      ];
    } else {
      delete updated.address;
    }

    const r = await fetch(`/api/fhir/Patient/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/fhir+json" },
      body: JSON.stringify(updated),
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

  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href="/" className="mb-4 inline-block text-sm underline">
        ← Back to patients
      </Link>
      <h1 className="mb-6 text-2xl font-semibold">Edit patient</h1>
      {error && <p className="text-red-600">Error: {error}</p>}
      {!original && !error && <p>Loading…</p>}
      {original && (
        <PatientForm
          initial={initial}
          submitLabel="Save changes"
          onSubmit={save}
        />
      )}
    </main>
  );
}
