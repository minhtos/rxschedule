"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Patient = {
  id: string;
  name?: { family?: string; given?: string[] }[];
  gender?: string;
  birthDate?: string;
  address?: {
    line?: string[];
    city?: string;
    state?: string;
    postalCode?: string;
  }[];
};

type Bundle = {
  entry?: { resource: Patient }[];
  link?: { relation: string; url: string }[];
};

type Parsed = { family: string; given: string; dob: string };

const PAGE_SIZE = 5;
const EMPTY: Parsed = { family: "", given: "", dob: "" };

// Smart-bar grammar: words = last name, comma switches to first name,
// numbers = date of birth (1984, 1984-06-21, 06/21/1984, or 06/21/84).
// Two-digit years use a pivot: birthdates are never in the future, so
// YY above the current year's last two digits means 19YY, else 20YY.
function parseSmart(raw: string): Parsed {
  let rest = raw;
  let dob = "";

  const slash = rest.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/);
  const iso = rest.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const year = rest.match(/\b(\d{4})\b/);
  if (slash) {
    const [, m, d, yRaw] = slash;
    const y =
      yRaw.length === 2
        ? Number(yRaw) <= new Date().getFullYear() % 100
          ? 2000 + Number(yRaw)
          : 1900 + Number(yRaw)
        : Number(yRaw);
    dob = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    rest = rest.replace(slash[0], " ");
  } else if (iso) {
    dob = iso[1];
    rest = rest.replace(iso[0], " ");
  } else if (year) {
    dob = year[1];
    rest = rest.replace(year[0], " ");
  }

  let family = "";
  let given = "";
  if (rest.includes(",")) {
    const [fam, giv] = rest.split(",", 2);
    family = fam.trim();
    given = (giv ?? "").trim();
  } else {
    const words = rest.trim().split(/\s+/).filter(Boolean);
    family = words[0] ?? "";
    given = words.slice(1).join(" ");
  }
  return { family, given, dob };
}

export default function Home() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [parsed, setParsed] = useState<Parsed>(EMPTY);

  // On first load, pick up ?q= from the URL and run that search
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("q");
    if (initial) {
      setQuery(initial);
      setParsed(parseSmart(initial));
    }
  }, []);

  // Query-then-list: typing only updates the bar + preview (both local).
  // The server query fires once, on submit — Enter key or Search button.
  const runSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    setParsed(parseSmart(query));
    setOffset(0);
    const url = new URL(window.location.href);
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  };

  const clearSearch = () => {
    setQuery("");
    setParsed(EMPTY);
    setOffset(0);
    const url = new URL(window.location.href);
    url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  };

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      _count: String(PAGE_SIZE),
      _offset: String(offset),
      _elements: "name,gender,birthDate,address",
    });
    if (parsed.family) params.set("family", parsed.family);
    if (parsed.given) params.set("given", parsed.given);
    if (parsed.dob) params.set("birthdate", parsed.dob);
    fetch(`/api/fhir/Patient?${params}`)
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
  }, [offset, parsed]);

  const displayName = (p: Patient) => {
    const n = p.name?.[0];
    if (!n) return "(no name)";
    return `${n.family ?? ""}, ${(n.given ?? []).join(" ")}`.trim();
  };

  // Display DOB the US way (MM/DD/YYYY); storage stays ISO.
  // Partial dates (YYYY, YYYY-MM) display as stored.
  const displayDob = (d?: string) => {
    if (!d) return "—";
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return d;
    return `${m[2]}/${m[3]}/${m[1]}`;
  };

  // Address rides with identity: it disambiguates same-name patients.
  const displayAddress = (p: Patient) => {
    const a = p.address?.[0];
    if (!a) return "";
    const street = (a.line ?? []).join(" ");
    const cityState = [a.city, a.state].filter(Boolean).join(", ");
    return [street, cityState, a.postalCode].filter(Boolean).join(" · ");
  };

  // Preview parses the bar live — pure local string work, no server call.
  const live = parseSmart(query);
  const preview = [
    live.family && `Last: ${live.family}`,
    live.given && `First: ${live.given}`,
    live.dob && `DOB: ${live.dob}`,
  ].filter(Boolean);
  const isSearching = parsed.family || parsed.given || parsed.dob;

  return (
    <main className="mx-auto max-w-3xl p-8">
     <div className="mb-6 flex items-center justify-between">
  <h1 className="ext-2xl font-semibold text-mist-900">Patients</h1>
   <Link href="/patients/new" className="rounded-lg bg-mist-600 px-4 py-2 text-white hover:bg-mist-700">
    New patient
   </Link>
  </div>



      <form onSubmit={runSearch} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search: Last, First, or DOB — e.g. Delaney, Marcus 1958"
          autoFocus
          className="w-full rounded border px-3 py-2"
        />
        <button type="submit" className="rounded-lg bg-mist-600 px-4 py-2 text-white hover:bg-mist-700">
          Search
        </button>
        {isSearching && (
          <button
            type="button"
            onClick={clearSearch}
            className="rounded-lg bg-white px-4 py-2 text-slate-700 ring-1 ring-slate-300 hover:bg-mist-50"
          >
            Clear
          </button>
        )}
      </form>
      <p className="mb-6 mt-1 h-5 text-sm text-slate-600">
        {preview.length > 0
          ? `Will search — ${preview.join(" · ")}`
          : "Formats: Last · Last, First · add a year or MM/DD/YYYY"}
      </p>

      {loading && <p>Loading…</p>}
      {error && <p className="text-red-600">Error: {error}</p>}

      {!loading && !error && patients.length === 0 && (
        <p>No patients match that search.</p>
      )}

      {!loading && !error && patients.length > 0 && (
        <>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Gender</th>
                <th className="py-2">Date of birth</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className="border-b hover:bg-mist-50">
                  <td className="py-2 pr-4">
                    <div>
                      <Link href={`/patients/${p.id}`} className="font-medium text-mist-700 underline">
                      {displayName(p)}
                      </Link>
                    </div>
                    <div className="text-sm text-slate-600">
                      {displayAddress(p)}
                    </div>
                  </td>
                  <td className="py-2 pr-4">{p.gender ?? "—"}</td>
                  <td className="py-2">{displayDob(p.birthDate)}</td>
                  <td className="py-2 pl-4">
  <Link
    href={`/patients/${p.id}/edit`}
    className="underline"
  >
    Edit
  </Link>
</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex gap-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="rounded-lg bg-white px-3 py-1 text-slate-700 ring-1 ring-slate-300 hover:bg-mist-50 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={!hasNext}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="rounded-lg bg-white px-3 py-1 text-slate-700 ring-1 ring-slate-300 hover:bg-mist-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </>
      )}
    </main>
  );
}
