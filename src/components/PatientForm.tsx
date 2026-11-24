"use client";

import { useState } from "react";

export type PatientFormValues = {
  family: string;
  given: string;
  gender: string;
  birthDate: string;
  line: string;
  city: string;
  state: string;
  postalCode: string;
};

export const EMPTY_FORM: PatientFormValues = {
  family: "",
  given: "",
  gender: "",
  birthDate: "",
  line: "",
  city: "",
  state: "",
  postalCode: "",
};

// Local today as YYYY-MM-DD (string compare works for ISO dates)
function todayIso() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function PatientForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: PatientFormValues;
  submitLabel: string;
  onSubmit: (v: PatientFormValues) => Promise<void>;
}) {
  const [v, setV] = useState<PatientFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set =
    (field: keyof PatientFormValues) =>
    (
      e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
    ) =>
      setV({ ...v, [field]: e.target.value });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Completeness rules: identity fields are all required,
    // and a birthdate can never be in the future.
    if (!v.family.trim() || !v.given.trim())
      return setError("First and last name are both required.");
    if (!v.gender) return setError("Select a gender.");
    if (!v.birthDate) return setError("Date of birth is required.");
    if (v.birthDate > todayIso())
      return setError("Date of birth can't be in the future.");
  setError(null);
  setSaving(true);
  try {
    await onSubmit(v);
  } catch (err) {
    setError(err instanceof Error ? err.message : "Save failed.");
  } finally {
    setSaving(false);
  }
};


  const inputCls = "w-full rounded border bg-white px-3 py-2 text-black";
  const labelCls = "mb-1 block text-sm opacity-80";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Last name</label>
          <input value={v.family} onChange={set("family")} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>First name</label>
          <input value={v.given} onChange={set("given")} className={inputCls} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Gender</label>
          <select value={v.gender} onChange={set("gender")} className={inputCls}>
            <option value="">Select…</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Date of birth</label>
          <input
            type="date"
            value={v.birthDate}
            max={todayIso()}
            onChange={set("birthDate")}
            className={inputCls}
          />
        </div>
      </div>

      <fieldset className="space-y-4 rounded border p-4">
        <legend className="px-1 text-sm opacity-80">
          Address (optional — shown in the patient list)
        </legend>
        <div>
          <label className={labelCls}>Street</label>
          <input value={v.line} onChange={set("line")} className={inputCls} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>City</label>
            <input value={v.city} onChange={set("city")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>State</label>
            <input value={v.state} onChange={set("state")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>ZIP</label>
            <input
              value={v.postalCode}
              onChange={set("postalCode")}
              className={inputCls}
            />
          </div>
        </div>
      </fieldset>

      {error && <p className="text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="rounded border px-4 py-2 disabled:opacity-40"
      >
        {saving ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
