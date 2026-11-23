#!/usr/bin/env python3
"""
Seed three synthetic demo patients into a FHIR R4 server, in two stages.

  --stage patients   patients, demographics, conditions, allergies, encounters, vitals
  --stage meds       MedicationRequests only (attach to the patients created above)
  --stage all        everything (default)

  --skip KEY [KEY ...]   leave out specific resources by key (e.g. a-lisinopril),
                         so you can post them by hand as practice
  --dry-run              write seed-bundle-<stage>.json and send nothing
  --delete               remove ONLY the resources this script created (all stages)

Medication keys: a-lisinopril a-metformin a-atorvastatin
                 b-lisinopril b-amlodipine b-metoprolol b-furosemide b-levothyroxine
                 b-metformin b-atorvastatin b-amoxicillin
                 c-tirzepatide c-metformin c-ondansetron

Credentials: set FHIR_BASE and FHIR_TOKEN in the environment, or leave them unset and
you will be prompted (hidden input, never printed, never saved).

Safe to re-run: every resource has a stable identifier and is created with a
conditional create, so repeats do not duplicate. All data is invented and tagged
"rxschedule-demo". Standard library only.
"""
import argparse
import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

SYSTEM = "https://rxschedule.example/demo-seed"
MRN_SYSTEM = "https://rxschedule.example/demo-mrn"
TAG = {"system": SYSTEM, "code": "rxschedule-demo"}
UCUM = "http://unitsofmeasure.org"

# RxNorm codes are deliberately NOT guessed. Look each drug up in RxNav and paste the
# code in; the script then adds a proper RxNorm coding. None = plain text only.
RXCUI = {
    "Lisinopril 10 MG Oral Tablet": None,
    "Lisinopril 20 MG Oral Tablet": None,
    "Metformin hydrochloride 500 MG Oral Tablet": None,
    "Metformin hydrochloride 1000 MG Oral Tablet": None,
    "Atorvastatin 20 MG Oral Tablet": None,
    "Atorvastatin 40 MG Oral Tablet": None,
    "Amlodipine 5 MG Oral Tablet": None,
    "24 HR Metoprolol succinate 50 MG Extended Release Oral Tablet": None,
    "Furosemide 20 MG Oral Tablet": None,
    "Levothyroxine sodium 0.075 MG Oral Tablet": None,
    "Amoxicillin 500 MG Oral Capsule": None,
    "Mounjaro (tirzepatide) 5 MG/0.5ML Pen Injector": None,
    "Ondansetron 4 MG Oral Tablet": None,
}

NOW = datetime.now(timezone.utc).replace(microsecond=0)
ENTRIES = []   # (stage, resource_type, key, resource)
CONDITIONAL_REFS = False


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def ident_query(key):
    return "identifier=" + urllib.parse.quote(SYSTEM, safe="") + "%7C" + urllib.parse.quote(key)


def full_url(key):
    return "urn:uuid:" + str(uuid.uuid5(uuid.NAMESPACE_URL, SYSTEM + "/" + key))


def ref(key):
    """Reference to a seeded resource: urn:uuid inside one bundle, or a conditional
    reference (resolved by identifier on the server) when patients already exist."""
    if CONDITIONAL_REFS:
        return {"reference": "Patient?" + ident_query(key)}
    return {"reference": full_url(key)}


def add(stage, rtype, key, body):
    body = dict(body)
    body["resourceType"] = rtype
    body["identifier"] = list(body.get("identifier", [])) + [{"system": SYSTEM, "value": key}]
    body["meta"] = {"tag": [TAG]}
    ENTRIES.append((stage, rtype, key, body))


def timing(freq, period, unit, when=None, dow=None):
    repeat = {"frequency": freq, "period": period, "periodUnit": unit}
    if when:
        repeat["when"] = when
    if dow:
        repeat["dayOfWeek"] = dow
    return {"repeat": repeat}


def patient(pk, family, given, gender, birth, mrn, phone, street, city, postal,
            marital, language):
    add("patients", "Patient", f"patient-{pk}", {
        "identifier": [{
            "type": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v2-0203",
                                 "code": "MR"}]},
            "system": MRN_SYSTEM, "value": mrn}],
        "name": [{"use": "official", "family": family, "given": [given]}],
        "gender": gender, "birthDate": birth, "active": True,
        "telecom": [{"system": "phone", "value": phone, "use": "home"}],
        "address": [{"use": "home", "line": [street], "city": city,
                     "state": "TX", "postalCode": postal, "country": "US"}],
        "maritalStatus": {"coding": [{
            "system": "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus",
            "code": marital[0], "display": marital[1]}]},
        "communication": [{"language": {"text": language}, "preferred": True}],
    })


def condition(pk, key, text):
    add("patients", "Condition", f"{pk}-cond-{key}", {
        "clinicalStatus": {"coding": [{
            "system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
            "code": "active"}]},
        "verificationStatus": {"coding": [{
            "system": "http://terminology.hl7.org/CodeSystem/condition-ver-status",
            "code": "confirmed"}]},
        "category": [{"coding": [{
            "system": "http://terminology.hl7.org/CodeSystem/condition-category",
            "code": "problem-list-item"}]}],
        "code": {"text": text},
        "subject": ref(f"patient-{pk}"),
        "recordedDate": iso(NOW - timedelta(days=400)),
    })


def allergy(pk, key, text, reaction=None):
    body = {
        "clinicalStatus": {"coding": [{
            "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
            "code": "active"}]},
        "verificationStatus": {"coding": [{
            "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
            "code": "confirmed"}]},
        "code": {"text": text},
        "patient": ref(f"patient-{pk}"),
    }
    if reaction:
        body.update({"type": "allergy", "category": ["medication"], "criticality": "low",
                     "reaction": [{"manifestation": [{"text": reaction}],
                                   "severity": "moderate"}]})
    add("patients", "AllergyIntolerance", f"{pk}-allergy-{key}", body)


def encounter(pk, tag, days_ago, kind, reason):
    start = NOW - timedelta(days=days_ago)
    add("patients", "Encounter", f"{pk}-enc-{tag}", {
        "status": "finished",
        "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                  "code": "AMB", "display": "ambulatory"},
        "type": [{"text": kind}],
        "subject": ref(f"patient-{pk}"),
        "period": {"start": iso(start), "end": iso(start + timedelta(minutes=30))},
        "reasonCode": [{"text": reason}],
    })


def medication(pk, key, name, reason, sig, route, dose, tm, prn=None):
    med = {"text": name}
    if RXCUI.get(name):
        med["coding"] = [{"system": "http://www.nlm.nih.gov/research/umls/rxnorm",
                          "code": RXCUI[name], "display": name}]
    dosage = {"text": sig, "timing": tm, "route": {"text": route},
              "doseAndRate": [{"doseQuantity": {
                  "value": dose[0], "unit": dose[1], "system": UCUM, "code": dose[2]}}]}
    if prn:
        dosage["asNeededCodeableConcept"] = {"text": prn}
    add("meds", "MedicationRequest", key, {
        "status": "active", "intent": "order",
        "category": [{"coding": [{
            "system": "http://terminology.hl7.org/CodeSystem/medicationrequest-category",
            "code": "community"}]}],
        "medicationCodeableConcept": med,
        "subject": ref(f"patient-{pk}"),
        "authoredOn": iso(NOW - timedelta(days=30)),
        "reasonCode": [{"text": reason}],
        "dosageInstruction": [dosage],
    })


def vitals(pk, when, tag, sbp, dbp, hr, temp_c, rr, spo2):
    t = iso(when)

    def q(v, unit, code):
        return {"value": v, "unit": unit, "system": UCUM, "code": code}

    def obs(suffix, loinc, display, quantity=None, components=None):
        body = {"status": "final",
                "category": [{"coding": [{
                    "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                    "code": "vital-signs"}]}],
                "code": {"coding": [{"system": "http://loinc.org", "code": loinc,
                                     "display": display}], "text": display},
                "subject": ref(f"patient-{pk}"), "effectiveDateTime": t}
        if quantity:
            body["valueQuantity"] = quantity
        if components:
            body["component"] = components
        add("patients", "Observation", f"{pk}-{tag}-{suffix}", body)

    obs("bp", "85354-9", "Blood pressure panel", components=[
        {"code": {"coding": [{"system": "http://loinc.org", "code": "8480-6",
                              "display": "Systolic blood pressure"}]},
         "valueQuantity": q(sbp, "mmHg", "mm[Hg]")},
        {"code": {"coding": [{"system": "http://loinc.org", "code": "8462-4",
                              "display": "Diastolic blood pressure"}]},
         "valueQuantity": q(dbp, "mmHg", "mm[Hg]")}])
    obs("hr", "8867-4", "Heart rate", q(hr, "beats/min", "/min"))
    obs("temp", "8310-5", "Body temperature", q(temp_c, "Cel", "Cel"))
    obs("rr", "9279-1", "Respiratory rate", q(rr, "breaths/min", "/min"))
    obs("spo2", "2708-6", "Oxygen saturation", q(spo2, "%", "%"))


# ---------------------------------------------------------------- the data
def build(conditional_refs):
    global CONDITIONAL_REFS
    CONDITIONAL_REFS = conditional_refs
    ENTRIES.clear()
    old, recent = NOW - timedelta(days=90), NOW - timedelta(days=2)
    oral = "Oral"

    # ---- A: simple, 3 medications ----
    patient("a", "Delaney", "Marcus", "male", "1958-03-14", "DEMO-1001", "555-0101",
            "100 Sample Lane", "Houston", "77001", ("M", "Married"), "English")
    for k, t in [("htn", "Essential hypertension"), ("t2dm", "Type 2 diabetes mellitus"),
                 ("lipids", "Hyperlipidemia")]:
        condition("a", k, t)
    allergy("a", "nka", "No known allergies")
    encounter("a", "1", 120, "Office visit", "Diabetes follow-up")
    encounter("a", "2", 20, "Office visit", "Blood pressure check")
    vitals("a", old, "old", 142, 88, 76, 36.7, 16, 97)
    vitals("a", recent, "new", 134, 82, 72, 36.6, 16, 98)
    medication("a", "a-lisinopril", "Lisinopril 10 MG Oral Tablet", "high blood pressure",
               "Take 1 tablet by mouth every morning", oral, (10, "mg", "mg"),
               timing(1, 1, "d", when=["MORN"]))
    medication("a", "a-metformin", "Metformin hydrochloride 500 MG Oral Tablet",
               "type 2 diabetes", "Take 1 tablet by mouth twice daily with meals",
               oral, (500, "mg", "mg"), timing(2, 1, "d", when=["CM", "CV"]))
    medication("a", "a-atorvastatin", "Atorvastatin 20 MG Oral Tablet", "high cholesterol",
               "Take 1 tablet by mouth at bedtime", oral, (20, "mg", "mg"),
               timing(1, 1, "d", when=["HS"]))

    # ---- B: complex, 8 medications, penicillin allergy + active amoxicillin ----
    patient("b", "Marlowe", "Evelyn", "female", "1949-09-02", "DEMO-1002", "555-0102",
            "200 Example Road", "Sugar Land", "77478", ("W", "Widowed"), "English")
    for k, t in [("htn", "Essential hypertension"), ("hf", "Chronic heart failure"),
                 ("t2dm", "Type 2 diabetes mellitus"), ("thyroid", "Hypothyroidism"),
                 ("lipids", "Hyperlipidemia"), ("sinus", "Acute sinusitis")]:
        condition("b", k, t)
    allergy("b", "penicillin", "Penicillin", reaction="Rash")
    encounter("b", "1", 150, "Office visit", "Heart failure follow-up")
    encounter("b", "2", 60, "Office visit", "Medication review")
    encounter("b", "3", 5, "Office visit", "Sinus pain and congestion")
    vitals("b", old, "old", 150, 90, 82, 36.8, 18, 95)
    vitals("b", recent, "new", 138, 84, 78, 37.1, 18, 96)
    medication("b", "b-lisinopril", "Lisinopril 20 MG Oral Tablet", "high blood pressure",
               "Take 1 tablet by mouth every morning", oral, (20, "mg", "mg"),
               timing(1, 1, "d", when=["MORN"]))
    medication("b", "b-amlodipine", "Amlodipine 5 MG Oral Tablet", "high blood pressure",
               "Take 1 tablet by mouth every morning", oral, (5, "mg", "mg"),
               timing(1, 1, "d", when=["MORN"]))
    medication("b", "b-metoprolol",
               "24 HR Metoprolol succinate 50 MG Extended Release Oral Tablet",
               "heart condition", "Take 1 tablet by mouth every morning. Do not crush.",
               oral, (50, "mg", "mg"), timing(1, 1, "d", when=["MORN"]))
    medication("b", "b-furosemide", "Furosemide 20 MG Oral Tablet", "fluid retention",
               "Take 1 tablet by mouth every morning", oral, (20, "mg", "mg"),
               timing(1, 1, "d", when=["MORN"]))
    medication("b", "b-levothyroxine", "Levothyroxine sodium 0.075 MG Oral Tablet",
               "underactive thyroid",
               "Take 1 tablet by mouth every morning, 30 to 60 minutes before breakfast",
               oral, (75, "mcg", "ug"), timing(1, 1, "d", when=["ACM"]))
    medication("b", "b-metformin", "Metformin hydrochloride 1000 MG Oral Tablet",
               "type 2 diabetes", "Take 1 tablet by mouth twice daily with meals",
               oral, (1000, "mg", "mg"), timing(2, 1, "d", when=["CM", "CV"]))
    medication("b", "b-atorvastatin", "Atorvastatin 40 MG Oral Tablet", "high cholesterol",
               "Take 1 tablet by mouth at bedtime", oral, (40, "mg", "mg"),
               timing(1, 1, "d", when=["HS"]))
    # Deliberately no 'when': the grid should show "needs review", not guess a time.
    medication("b", "b-amoxicillin", "Amoxicillin 500 MG Oral Capsule", "sinus infection",
               "Take 1 capsule by mouth every 8 hours for 10 days", oral,
               (500, "mg", "mg"), timing(1, 8, "h"))

    # ---- C: GLP-1, weekly + scheduled + PRN ----
    patient("c", "Raman", "Priya", "female", "1984-06-21", "DEMO-1003", "555-0103",
            "300 Demo Court", "Austin", "78701", ("S", "Never Married"), "English")
    for k, t in [("t2dm", "Type 2 diabetes mellitus"), ("obesity", "Obesity")]:
        condition("c", k, t)
    allergy("c", "nka", "No known allergies")
    encounter("c", "1", 90, "Office visit", "Start of tirzepatide therapy")
    encounter("c", "2", 14, "Office visit", "Dose review and nausea")
    vitals("c", old, "old", 124, 78, 80, 36.7, 16, 99)
    vitals("c", recent, "new", 120, 76, 76, 36.6, 16, 99)
    medication("c", "c-tirzepatide", "Mounjaro (tirzepatide) 5 MG/0.5ML Pen Injector",
               "type 2 diabetes",
               "Inject 5 mg under the skin once weekly, on the same day each week",
               "Subcutaneous", (5, "mg", "mg"), timing(1, 1, "wk", dow=["mon"]))
    medication("c", "c-metformin", "Metformin hydrochloride 500 MG Oral Tablet",
               "type 2 diabetes", "Take 1 tablet by mouth twice daily with meals",
               oral, (500, "mg", "mg"), timing(2, 1, "d", when=["CM", "CV"]))
    medication("c", "c-ondansetron", "Ondansetron 4 MG Oral Tablet", "nausea",
               "Take 1 tablet by mouth every 8 hours as needed for nausea",
               oral, (4, "mg", "mg"), timing(1, 8, "h"), prn="nausea")


# ---------------------------------------------------------------- bundles
def selected(stage, skip):
    return [(s, t, k, r) for s, t, k, r in ENTRIES
            if (stage == "all" or s == stage) and k not in skip]


def create_bundle(stage, skip):
    return {"resourceType": "Bundle", "type": "transaction", "entry": [
        {"fullUrl": full_url(k), "resource": r,
         "request": {"method": "POST", "url": t, "ifNoneExist": ident_query(k)}}
        for _, t, k, r in selected(stage, skip)]}


def delete_bundle():
    ordered = sorted(ENTRIES, key=lambda e: e[1] == "Patient")  # patients last
    return {"resourceType": "Bundle", "type": "transaction", "entry": [
        {"request": {"method": "DELETE", "url": f"{t}?{ident_query(k)}"}}
        for _, t, k, _r in ordered]}


# ---------------------------------------------------------------- network
def get_credentials():
    base = os.environ.get("FHIR_BASE") or getpass.getpass("FHIR base URL (hidden): ")
    token = os.environ.get("FHIR_TOKEN") or getpass.getpass("Bearer token (hidden): ")
    base = base.strip().rstrip("/")
    host = urllib.parse.urlparse(base).hostname or ""
    if not base.startswith("https://") and host not in ("localhost", "127.0.0.1"):
        sys.exit("Refusing to send a token over a non-HTTPS URL.")
    return base, token.strip()


def send(base, token, bundle):
    req = urllib.request.Request(
        base, data=json.dumps(bundle).encode("utf-8"), method="POST",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/fhir+json",
                 "Accept": "application/fhir+json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"Server answered HTTP {e.code}.")
        try:
            for issue in json.loads(e.read().decode("utf-8", "replace")).get("issue", [])[:5]:
                print(" -", issue.get("diagnostics")
                      or (issue.get("details") or {}).get("text") or issue.get("code"))
        except ValueError:
            pass
        sys.exit(1)
    except urllib.error.URLError as e:
        sys.exit(f"Could not reach the server: {e.reason}")


def summarize(result):
    counts = {}
    for e in result.get("entry", []):
        s = (e.get("response") or {}).get("status", "?").split(" ")[0]
        counts[s] = counts.get(s, 0) + 1
    return counts


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stage", choices=["patients", "meds", "all"], default="all")
    ap.add_argument("--skip", nargs="*", default=[], metavar="KEY")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--delete", action="store_true")
    args = ap.parse_args()

    build(conditional_refs=(args.stage == "meds"))
    known = {k for _, _, k, _ in ENTRIES}
    unknown = [k for k in args.skip if k not in known]
    if unknown:
        sys.exit("Unknown --skip key(s): " + ", ".join(unknown))

    if args.delete:
        chosen = [(None, t, k, None) for _, t, k, _ in ENTRIES]
    else:
        chosen = selected(args.stage, set(args.skip))
    kinds = {}
    for _, t, _, _ in chosen:
        kinds[t] = kinds.get(t, 0) + 1
    print("Resources:", ", ".join(f"{n} {t}" for t, n in sorted(kinds.items())))
    if args.skip:
        print("Skipping:", ", ".join(args.skip))

    if args.dry_run:
        name = f"seed-bundle-{args.stage}.json"
        with open(name, "w", encoding="utf-8") as f:
            json.dump(delete_bundle() if args.delete else
                      create_bundle(args.stage, set(args.skip)), f, indent=2)
        print(f"Dry run: wrote {name}. Nothing was sent.")
        return

    base, token = get_credentials()
    if args.delete:
        print("Delete finished. Response codes:", summarize(send(base, token, delete_bundle())))
    else:
        print("Create finished. Response codes:",
              summarize(send(base, token, create_bundle(args.stage, set(args.skip)))),
              "(201 = created, 200 = already existed)")


if __name__ == "__main__":
    main()
