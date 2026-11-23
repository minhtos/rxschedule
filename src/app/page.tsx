"use client";

import { useEffect, useState } from "react";

type Patient = {
  id: string;
  name?: { family?: string; given?: string[] }[];
  gender?: string;
  birthDate?: string;
};

type Bundle = {
  entry?: { resource: Patient }[];
  link?: { relation: string; url: string }[];
};

const PAGE_SIZE = 5;

export default function Home() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(
      `/api/fhir/Patient?_count=${PAGE_SIZE}&_offset=${offset}&_elements=name,gender,birthDate`
    )
      .then((r) => {
        if (!r.ok) throw new Error(`FHIR server said ${r.status}`);
        return r.json();
      })
      .then((b: Bundle) => {
        setPatients((b.entry ?? []).map((e) => e.resource));
        setHasNext((b.link ?? []).some((l) => l.relation === "next"));
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [offset]);

  const displayName = (p: Patient) => {
    const n = p.name?.[0];
    if (!n) return "(no name)";
    return `${n.family ?? ""}, ${(n.given ?? []).join(" ")}`.trim();
  };

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-6 text-2xl font-semibold">Patients</h1>

      {loading && <p>Loading…</p>}
      {error && <p className="text-red-600">Error: {error}</p>}

      {!loading && !error && (
        <>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b">
                <th className="py-2">Name</th>
                <th className="py-2">Gender</th>
                <th className="py-2">Date of birth</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="py-2">{displayName(p)}</td>
                  <td className="py-2">{p.gender ?? "—"}</td>
                  <td className="py-2">{p.birthDate ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex gap-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="rounded border px-3 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={!hasNext}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="rounded border px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </>
      )}
    </main>
  );
}
