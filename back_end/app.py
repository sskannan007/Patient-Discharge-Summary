import os
import re
import unicodedata
from datetime import datetime

from dotenv import load_dotenv
from fastapi import FastAPI, Body, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import psycopg2
from psycopg2 import errors as pg_errors
from psycopg2.extras import Json, RealDictCursor
from openai import OpenAI

load_dotenv()

app = FastAPI(title="Apex Discharge Summary Backend")

# ================= CORS =================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ================= LLM =================
client = OpenAI(
    base_url="http://localhost:8002/v1",
    api_key="EMPTY"
)

def call_ai(prompt: str) -> str:
    try:
        response = client.chat.completions.create(
            model="mistralai/Mistral-7B-Instruct-v0.3",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=700
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print("LLM Error:", e)
        return "AI generation failed"


# ================= DB =================
def get_conn():
    """Uses DATABASE_URL from .env when set; otherwise Docker-style defaults."""
    url = os.getenv("DATABASE_URL")
    if url:
        return psycopg2.connect(url, cursor_factory=RealDictCursor)
    return psycopg2.connect(
        dbname="discharge_ai",
        user="postgres",
        password="postgres",
        host="localhost",
        port=5432,
        cursor_factory=RealDictCursor,
    )


# SERIAL columns (schema.sql). After pg_restore / dump loads with explicit IDs, sequences lag → pkey conflicts on INSERT.
_SERIAL_TABLES = (
    ("patients", "patient_id"),
    ("discharge_summaries", "discharge_id"),
    ("diagnoses", "diag_id"),
    ("lab_results", "lab_id"),
    ("microbiology", "micro_id"),
    ("imaging", "imaging_id"),
    ("consultations", "consult_id"),
    ("procedures_performed", "proc_id"),
    ("medications_discharge", "med_id"),
    ("allergies", "allergy_id"),
    ("follow_up_appointments", "fu_id"),
    ("referrals", "ref_id"),
)


def sync_serial_sequences(conn):
    """Align SERIAL next values with MAX(pk) per table (safe after bulk imports)."""
    cur = conn.cursor()
    try:
        for table, col in _SERIAL_TABLES:
            cur.execute(
                f'SELECT COALESCE(MAX("{col}"), 0) AS m FROM "{table}"'  # noqa: S608 — whitelisted names only
            )
            mx = int(cur.fetchone()["m"])
            cur.execute(
                "SELECT pg_get_serial_sequence(%s, %s)",
                (table, col),
            )
            seq = cur.fetchone()["pg_get_serial_sequence"]
            if not seq:
                continue
            if mx == 0:
                cur.execute("SELECT setval(%s, 1, false)", (seq,))
            else:
                cur.execute("SELECT setval(%s, %s, true)", (seq, mx))
    finally:
        cur.close()


@app.on_event("startup")
def _startup_sync_serial_sequences():
    try:
        conn = get_conn()
        try:
            sync_serial_sequences(conn)
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        print("Serial sequence sync failed (DB unreachable or schema mismatch):", e)


# ================= HELPER: Format JSON fields nicely =================
def format_field(field):
    if isinstance(field, dict):
        if field.get("narrative") is not None:
            return str(field["narrative"])
        return " | ".join(f"{k}: {v}" for k, v in field.items())
    return field if field else "N/A"

def format_vitals(vitals):
    if isinstance(vitals, dict):
        if vitals.get("narrative"):
            return str(vitals["narrative"])
        mapping = {
            "temperature": "Temp", "heart_rate": "HR", "blood_pressure": "BP",
            "respiratory_rate": "RR", "spo2": "SpO2", "gcs": "GCS"
        }
        items = [f"{mapping.get(k, k)}: {v}" for k, v in vitals.items() if k != "narrative"]
        return " | ".join(items) if items else str(vitals)
    return str(vitals) if vitals else "N/A"


def _normalize_ts_string(s):
    s = str(s).strip()
    s = re.sub(r"\s+", " ", s)
    if "T" in s and s.endswith("Z"):
        s = s[:-1].strip()
    if "T" in s and "." in s:
        s = s.split(".")[0]
    return s


def parse_datetime_flexible(s):
    if not s or not str(s).strip():
        return None
    s = _normalize_ts_string(s)
    fmts = (
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%d-%m-%Y",
    )
    for fmt in fmts:
        try:
            return datetime.strptime(s[:26], fmt)
        except ValueError:
            try:
                return datetime.strptime(s, fmt)
            except ValueError:
                continue
    # Date-only → midnight (admission/discharge as calendar day)
    donly = parse_date_flexible(s)
    if donly:
        return datetime.combine(donly, datetime.min.time())
    return None


def parse_date_flexible(s):
    """Parse date only; does not call parse_datetime_flexible (avoids recursion with parse_datetime_flexible)."""
    if not s or not str(s).strip():
        return None
    s = re.sub(r"\s*/\s*", "/", str(s).strip())
    s = re.sub(r"\s+", " ", s)
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
    return None


def parse_los_int(text):
    if not text:
        return 1
    m = re.search(r"(\d+)", str(text))
    return max(1, int(m.group(1))) if m else 1


def normalize_mrn_for_storage(raw: str) -> str:
    """NFKC trim, collapse whitespace; max 50 chars (matches patients.mrn)."""
    s = unicodedata.normalize("NFKC", (raw or "")).strip()
    s = re.sub(r"\s+", " ", s)
    return s[:50]


def mrn_duplicate_sql_clause():
    """Match MRNs that differ only by spacing/case (e.g. MRN-15789 vs MRN- 15789)."""
    return "translate(upper(mrn), ' ', '') = translate(upper(%s), ' ', '')"


def anthropometric_from_payload(payload: dict):
    out = {}
    for key, field in (
        ("height_cm", "anthro_height_cm"),
        ("weight_kg", "anthro_weight_kg"),
        ("bmi", "anthro_bmi"),
        ("bsa", "anthro_bsa"),
    ):
        v = payload.get(field)
        if v is None or str(v).strip() == "":
            continue
        s = str(v).strip().replace(",", ".")
        try:
            out[key] = float(s) if "." in s else int(s)
        except ValueError:
            out[key] = s[:50]
    return Json(out) if out else None


def administrative_from_payload(payload: dict):
    ward = payload.get("ward")
    if ward and str(ward).strip():
        return Json({"ward": str(ward).strip()[:500]})
    return None


def split_primary_diagnosis_line(line: str):
    """Returns (diagnosis_text, icd10_or_none) from a line that may include (ICD-10-CM: …)."""
    s = str(line).strip()
    if not s:
        return None, None
    m = re.search(r"\(ICD-10-CM:\s*([^)]+)\)", s, re.I)
    icd = m.group(1).strip()[:20] if m else None
    text = re.sub(r"\s*\(ICD-10-CM:[^)]*\)\s*", " ", s, flags=re.I).strip()
    return (text[:2000] if text else None), icd


def _ward_from_administrative(admin):
    if isinstance(admin, dict):
        w = admin.get("ward")
        return w if w else "N/A"
    return "N/A"


# ================= AI GENERATION =================
def generate_ai(discharge_id: int):
    # (your existing generate_ai function - unchanged)
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT 
            p.name, p.age, p.gender,
            ds.chief_complaint, ds.admission_date, ds.discharge_date, ds.length_of_stay,
            ds.mode_of_admission, ds.discharge_type,
            ds.vital_signs_admission, ds.systemic_examination,
            ds.functional_status,
            array_agg(DISTINCT d.diagnosis_text || ' (' || COALESCE(d.icd10_code,'') || ')') FILTER (WHERE d.diagnosis_text IS NOT NULL) AS diagnoses,
            array_agg(DISTINCT l.test_name || ': ' || l.admission_value || ' → ' || l.discharge_value) FILTER (WHERE l.test_name IS NOT NULL) AS labs,
            array_agg(DISTINCT m.drug_name || ' ' || m.dose || ' ' || m.route || ' ' || m.frequency) FILTER (WHERE m.drug_name IS NOT NULL) AS meds
        FROM discharge_summaries ds
        JOIN patients p ON ds.patient_id = p.patient_id
        LEFT JOIN diagnoses d ON ds.discharge_id = d.discharge_id
        LEFT JOIN lab_results l ON ds.discharge_id = l.discharge_id
        LEFT JOIN medications_discharge m ON ds.discharge_id = m.discharge_id
        WHERE ds.discharge_id = %s
        GROUP BY p.name, p.age, p.gender, ds.chief_complaint, ds.admission_date, 
                 ds.discharge_date, ds.length_of_stay, ds.mode_of_admission, 
                 ds.discharge_type, ds.vital_signs_admission, ds.systemic_examination,
                 ds.functional_status
    """, (discharge_id,))

    row = cur.fetchone()
    if not row:
        cur.close()
        conn.close()
        return None

    context = f"""
Patient: {row['name']}, {row['age']} years, {row['gender']}
Chief Complaint: {row['chief_complaint'] or 'Not recorded'}
Admission Date: {row['admission_date']}
Discharge Date: {row['discharge_date']}
Length of Stay: {row['length_of_stay']} days
Mode: {row['mode_of_admission']} | Type: {row['discharge_type']}
Diagnoses: {", ".join(row['diagnoses'] or ['None recorded'])}
Labs: {", ".join(row['labs'] or ['None recorded'])}
Medications: {", ".join(row['meds'] or ['None recorded'])}
Vitals: {row['vital_signs_admission']}
Systemic Exam: {row['systemic_examination']}
Functional Status: {row['functional_status']}
"""

    prompt_hpi = f"""{context}\n\nWrite History of Present Illness.\nRULES:\n- Use ONLY given data\n- Do NOT assume anything\n- No headings\n- Paragraph format\n\nHPI:"""
    prompt_course = f"""{context}\n\nWrite Summary of Hospital Course.\nRULES:\n- Chronological flow\n- Use ONLY given data\n- No headings\n- No placeholders\n\nSummary:"""
    prompt_restrictions = f"""{context}\n\nWrite discharge instructions.\nRULES:\n- Diagnosis-based only\n- No generic advice\n- Bullet points\n\nRestrictions:"""

    hpi = call_ai(prompt_hpi)
    course = call_ai(prompt_course)
    restrictions = call_ai(prompt_restrictions)

    cur.close()
    conn.close()

    return {"hpi": hpi, "course": course, "restrictions": restrictions} if hpi and course and restrictions else None


# ================= GET PATIENTS =================
@app.get("/api/patients")
def get_patients():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT ds.discharge_id, p.name
        FROM discharge_summaries ds
        JOIN patients p ON ds.patient_id = p.patient_id
        ORDER BY ds.discharge_id
        LIMIT 100
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [{"discharge_id": r["discharge_id"], "name": r["name"]} for r in rows]


def _serialize_record(row: dict) -> dict:
    """JSON-safe dict (dates → ISO strings)."""
    out = dict(row)
    for key in ("dob", "created_at"):
        v = out.get(key)
        if v is not None and hasattr(v, "isoformat"):
            out[key] = v.isoformat()
        elif v is not None:
            out[key] = str(v)
    return out


# ================= PATIENT TABLE (patients.* + discharge_id) =================
@app.get("/api/patient-records")
def get_patient_records():
    """One row per discharge; includes all `patients` table columns plus discharge_id (no cap)."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT
            ds.discharge_id,
            p.patient_id,
            p.name,
            p.mrn,
            p.dob,
            p.age,
            p.gender,
            p.aadhaar,
            p.address,
            p.emergency_contact_name,
            p.emergency_contact_phone,
            p.created_at
        FROM discharge_summaries ds
        JOIN patients p ON p.patient_id = ds.patient_id
        ORDER BY ds.discharge_id DESC
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [_serialize_record(dict(r)) for r in rows]


# ================= GET DISCHARGE (FIXED) =================
@app.get("/api/discharge/{discharge_id}")
def get_discharge(
    discharge_id: int,
    fill_ai: bool = Query(
        False,
        description="If true, run the LLM to fill missing HPI/course/restrictions (slow). Default: return DB only, instantly.",
    ),
):
    conn = get_conn()
    cur = conn.cursor()

    ai_data = None
    if fill_ai:
        cur.execute("""
            SELECT history_of_present_illness, summary_of_hospital_course, activity_restrictions
            FROM discharge_summaries WHERE discharge_id = %s
        """, (discharge_id,))
        chk = cur.fetchone()
        if chk and (
            not chk["history_of_present_illness"]
            or not chk["summary_of_hospital_course"]
            or not chk["activity_restrictions"]
        ):
            ai_data = generate_ai(discharge_id)

    # Main patient data
    cur.execute("""
        SELECT p.*, ds.*
        FROM discharge_summaries ds
        JOIN patients p ON ds.patient_id = p.patient_id
        WHERE ds.discharge_id = %s
    """, (discharge_id,))
    row = cur.fetchone()

    if not row:
        cur.close()
        conn.close()
        return JSONResponse({"error": "Not found"}, status_code=404)

    cur.execute("SELECT * FROM diagnoses WHERE discharge_id=%s", (discharge_id,))
    diagnoses = cur.fetchall()

    cur.execute("SELECT * FROM lab_results WHERE discharge_id=%s", (discharge_id,))
    labs = cur.fetchall()

    cur.execute("SELECT * FROM medications_discharge WHERE discharge_id=%s", (discharge_id,))
    meds = cur.fetchall()

    cur.execute("SELECT * FROM allergies WHERE discharge_id=%s", (discharge_id,))
    allergies = cur.fetchall()

    cur.close()
    conn.close()

    return {
        "document_type": "PATIENT DISCHARGE SUMMARY",
        "sections": {
            "section_1": {"fields": {
                "patient_name": row["name"],
                "mrn_hospital_id": row.get("mrn", "N/A"),
                "dob": str(row["dob"]) if row.get("dob") else "N/A",
                "aadhaar": row.get("aadhaar") or "N/A",
                "address": row.get("address") or "N/A",
                "emergency_contact_name": row.get("emergency_contact_name") or "N/A",
                "emergency_contact_phone": row.get("emergency_contact_phone") or "N/A",
                "age": row.get("age", "N/A"),
                "gender": row.get("gender", "N/A"),
                "ward": _ward_from_administrative(row.get("administrative")),
                "admission_date_time": str(row["admission_date"]) if row.get("admission_date") else "N/A",
                "discharge_date_time": str(row["discharge_date"]) if row.get("discharge_date") else "N/A",
                "length_of_stay": row.get("length_of_stay", "N/A"),          # ← raw number (UI will add " days")
                "admitting_physician": row.get("admitting_physician", "N/A"),
                "discharging_physician": row.get("discharging_physician", "N/A"),
                "mode_of_admission": row.get("mode_of_admission") or "N/A",
                "discharge_type": row.get("discharge_type") or "N/A",
            }},

            "section_2": {"fields": {
                "primary_diagnosis": diagnoses[0]["diagnosis_text"] if diagnoses else "N/A",
                "primary_diagnosis_icd10_code": diagnoses[0]["icd10_code"] if diagnoses else "N/A"
            }},

            "section_3": {"fields": {
                "chief_complaint": row.get("chief_complaint", "N/A"),
                "history_of_present_illness": ai_data["hpi"] if ai_data else (row.get("history_of_present_illness") or "N/A"),
                "tobacco_use": row.get("tobacco_use") or "N/A",
                "alcohol_use": row.get("alcohol_use") or "N/A",
                "substance_use": row.get("substance_use") or "N/A",
                "occupation_exposure": row.get("occupation_exposure") or "N/A",
            }},

            "section_4": {"fields": {
                "vital_signs": format_vitals(row.get("vital_signs_admission")),
                "systemic_examination": format_field(row.get("systemic_examination")),
                "anthropometric": row.get("anthropometric") or {},
            }},

            "section_5": {"laboratory_investigations": labs},

            "section_6": {"fields": {
                "summary_of_hospital_course": ai_data["course"] if ai_data else (row.get("summary_of_hospital_course") or "N/A")
            }},

            "section_7": {"fields": {
                "medications_on_discharge": meds,
                "allergies": allergies,
            }},

            "section_8": {"fields": {
                "functional_status": format_field(row.get("functional_status")),
                "general_condition_discharge": row.get("general_condition_discharge") or "N/A",
                "wound_drain_status": row.get("wound_drain_status") or "N/A",
            }},

            "section_9": {"fields": {
                "activity_dietary_restrictions": ai_data["restrictions"] if ai_data else (row.get("activity_restrictions") or "N/A")
            }},

            "section_10": {"fields": row.get("infection_control", {}) or {}},
            "section_11": {"fields": row.get("quality_indicators", {}) or {}},
            "section_12": {"fields": row.get("signatures", {}) or {}},
            "section_13": {"fields": row.get("administrative", {}) or {}}
        }
    }


# ================= SAVE NEW FROM FORM (PATIENT DISCHARGE SUMMARY) =================
@app.post("/api/discharge/save-new")
def save_new_discharge_from_form(payload: dict = Body(...)):
    """Insert `patients` + `discharge_summaries` from filled form fields (see collectDischargeFormInsert)."""
    req = ("name", "mrn", "dob", "age", "gender", "admission_date_time", "discharge_date_time")
    missing = [k for k in req if not payload.get(k) or str(payload.get(k)).strip() == ""]
    if missing:
        raise HTTPException(status_code=400, detail=f"Fill required fields: {', '.join(missing)}")

    try:
        age = int(str(payload["age"]).strip())
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Age must be a number")

    dob = parse_date_flexible(payload["dob"])
    if not dob:
        raise HTTPException(status_code=400, detail="Invalid Date of birth — use DD/MM/YYYY or YYYY-MM-DD")

    adm = parse_datetime_flexible(payload["admission_date_time"])
    dis = parse_datetime_flexible(payload["discharge_date_time"])
    if not adm or not dis:
        raise HTTPException(status_code=400, detail="Invalid admission or discharge date/time")

    los = parse_los_int(payload.get("length_of_stay_text") or payload.get("length_of_stay") or "1")

    def narr_json(key):
        t = payload.get(key)
        if t and str(t).strip():
            return Json({"narrative": str(t).strip()})
        return None

    mrn = normalize_mrn_for_storage(str(payload["mrn"]))
    if not re.search(r"\d", mrn):
        raise HTTPException(
            status_code=400,
            detail="MRN must include numbers (e.g. MRN-1001). Do not leave only 'MRN-' — type the full id.",
        )

    patient_id = None
    discharge_id = None

    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            f"SELECT patient_id, name, mrn FROM patients WHERE mrn = %s OR {mrn_duplicate_sql_clause()}",
            (mrn, mrn),
        )
        row = cur.fetchone()
        if row:
            existing_name = (row.get("name") or "").strip() or "existing patient"
            stored = row.get("mrn") or mrn
            raise HTTPException(
                status_code=409,
                detail=(
                    f"MRN '{mrn}' matches existing id '{stored}' for {existing_name} "
                    f"(patient id {row['patient_id']}). Use a different MRN."
                ),
            )

        cur.execute(
            """
            INSERT INTO patients (
                name, mrn, dob, age, gender,
                aadhaar, address, emergency_contact_name, emergency_contact_phone
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING patient_id
            """,
            (
                str(payload["name"]).strip()[:100],
                mrn,
                dob,
                age,
                str(payload["gender"]).strip()[:20],
                (str(payload["aadhaar"]).strip()[:20] if payload.get("aadhaar") else None),
                (payload.get("address") or None),
                (str(payload["emergency_contact_name"]).strip()[:100] if payload.get("emergency_contact_name") else None),
                (str(payload["emergency_contact_phone"]).strip()[:20] if payload.get("emergency_contact_phone") else None),
            ),
        )
        patient_id = cur.fetchone()["patient_id"]

        anth = anthropometric_from_payload(payload)
        admin = administrative_from_payload(payload)

        def _strip_or_none(k, mx):
            v = payload.get(k)
            if v is None or str(v).strip() == "":
                return None
            return str(v).strip()[:mx]

        cur.execute(
            """
            INSERT INTO discharge_summaries (
                patient_id, admission_date, discharge_date, length_of_stay,
                admitting_physician, discharging_physician, mode_of_admission, discharge_type,
                chief_complaint, history_of_present_illness, summary_of_hospital_course, activity_restrictions,
                tobacco_use, alcohol_use, substance_use, occupation_exposure,
                vital_signs_admission, anthropometric, systemic_examination,
                general_condition_discharge, wound_drain_status, functional_status,
                administrative
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING discharge_id
            """,
            (
                patient_id,
                adm,
                dis,
                los,
                _strip_or_none("admitting_physician", 100),
                _strip_or_none("discharging_physician", 100),
                _strip_or_none("mode_of_admission", 50),
                _strip_or_none("discharge_type", 50),
                _strip_or_none("chief_complaint", 10000),
                _strip_or_none("history_of_present_illness", 10000),
                _strip_or_none("summary_of_hospital_course", 10000),
                _strip_or_none("activity_restrictions", 10000),
                _strip_or_none("tobacco_use", 20),
                _strip_or_none("alcohol_use", 20),
                _strip_or_none("substance_use", 50),
                _strip_or_none("occupation_exposure", 10000),
                narr_json("vital_signs_narrative"),
                anth,
                narr_json("systemic_examination_narrative"),
                _strip_or_none("general_condition_discharge", 50),
                _strip_or_none("wound_drain_status", 100),
                narr_json("functional_status_narrative"),
                admin,
            ),
        )
        discharge_id = cur.fetchone()["discharge_id"]

        _apply_child_rows_for_discharge(cur, discharge_id, payload)

        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except pg_errors.UniqueViolation as exc:
        conn.rollback()
        diag = getattr(exc, "diag", None)
        cname = (getattr(diag, "constraint_name", None) or "") if diag else ""
        detail_pg = (getattr(diag, "message_detail", None) or str(exc)) if diag else str(exc)
        cur2 = conn.cursor()
        try:
            if cname and "_pkey" in cname:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Database auto-increment (SERIAL) was behind your existing rows — common after "
                        "importing dump.sql. Restart the backend once (it fixes this on startup) or run "
                        "back_end/fix_serial_sequences.sql. Then save again with your new MRN."
                    ),
                ) from exc
            if "mrn" in cname.lower():
                cur2.execute(
                    f"SELECT patient_id, name, mrn FROM patients WHERE mrn = %s OR {mrn_duplicate_sql_clause()}",
                    (mrn, mrn),
                )
                erow = cur2.fetchone()
                if erow:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"MRN conflict: stored as '{erow.get('mrn')}' for {erow.get('name')} "
                            f"(patient id {erow['patient_id']}). Your entry was '{mrn}'."
                        ),
                    ) from exc
            raise HTTPException(
                status_code=409,
                detail=f"Duplicate database value ({cname or 'constraint'}): {detail_pg}",
            ) from exc
        finally:
            cur2.close()
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        cur.close()
        conn.close()

    return {"patient_id": patient_id, "discharge_id": discharge_id}


def _apply_child_rows_for_discharge(cur, discharge_id: int, payload: dict):
    """Insert labs, meds, allergies for a discharge (used after clearing child rows)."""
    line = payload.get("primary_diagnosis_line")
    if line and str(line).strip():
        dx_text, dx_icd = split_primary_diagnosis_line(str(line))
        if not dx_text:
            dx_text = str(line).strip()[:2000]
        cur.execute(
            """
            INSERT INTO diagnoses (discharge_id, diagnosis_type, diagnosis_text, icd10_code)
            VALUES (%s, %s, %s, %s)
            """,
            (discharge_id, "Primary", dx_text, dx_icd),
        )

    def _clip_opt(val, n):
        if val is None:
            return None
        s = str(val).strip()
        return s[:n] if s else None

    labs = payload.get("labs")
    if isinstance(labs, list):
        for lab in labs:
            if not isinstance(lab, dict):
                continue
            tn = (lab.get("test_name") or "").strip()
            if not tn:
                continue
            cur.execute(
                """
                INSERT INTO lab_results (
                    discharge_id, test_name, admission_value, discharge_value,
                    reference_range, interpretation
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    discharge_id,
                    tn[:100],
                    _clip_opt(lab.get("admission_value"), 50),
                    _clip_opt(lab.get("discharge_value"), 50),
                    _clip_opt(lab.get("reference_range"), 100),
                    _clip_opt(lab.get("interpretation"), 50),
                ),
            )

    meds = payload.get("medications")
    if isinstance(meds, list):
        for med in meds:
            if not isinstance(med, dict):
                continue
            dn = (med.get("drug_name") or "").strip()
            if not dn:
                continue
            cur.execute(
                """
                INSERT INTO medications_discharge (
                    discharge_id, drug_name, dose, route, frequency,
                    duration, special_instructions
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    discharge_id,
                    dn[:100],
                    (med.get("dose") or None) and str(med["dose"])[:50],
                    (med.get("route") or None) and str(med["route"])[:30],
                    (med.get("frequency") or None) and str(med["frequency"])[:50],
                    (med.get("duration") or None) and str(med["duration"])[:50],
                    (med.get("special_instructions") or None) and str(med["special_instructions"])[:10000],
                ),
            )

    allergies = payload.get("allergies")
    if isinstance(allergies, list):
        for al in allergies:
            if not isinstance(al, dict):
                continue
            ag = (al.get("allergen") or "").strip()
            if not ag:
                continue
            cur.execute(
                """
                INSERT INTO allergies (discharge_id, allergen, reaction, severity)
                VALUES (%s, %s, %s, %s)
                """,
                (
                    discharge_id,
                    ag[:10000],
                    (al.get("reaction") or None) and str(al["reaction"])[:10000],
                    (al.get("severity") or None) and str(al["severity"])[:20],
                ),
            )


@app.put("/api/discharge/{discharge_id}")
def update_discharge_from_form(discharge_id: int, payload: dict = Body(...)):
    """Update existing `patients` + `discharge_summaries` + child rows from the same payload as save-new."""
    req = ("name", "mrn", "dob", "age", "gender", "admission_date_time", "discharge_date_time")
    missing = [k for k in req if not payload.get(k) or str(payload.get(k)).strip() == ""]
    if missing:
        raise HTTPException(status_code=400, detail=f"Fill required fields: {', '.join(missing)}")

    try:
        age = int(str(payload["age"]).strip())
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Age must be a number")

    dob = parse_date_flexible(payload["dob"])
    if not dob:
        raise HTTPException(status_code=400, detail="Invalid Date of birth — use DD/MM/YYYY or YYYY-MM-DD")

    adm = parse_datetime_flexible(payload["admission_date_time"])
    dis = parse_datetime_flexible(payload["discharge_date_time"])
    if not adm or not dis:
        raise HTTPException(status_code=400, detail="Invalid admission or discharge date/time")

    los = parse_los_int(payload.get("length_of_stay_text") or payload.get("length_of_stay") or "1")

    def narr_json(key):
        t = payload.get(key)
        if t and str(t).strip():
            return Json({"narrative": str(t).strip()})
        return None

    mrn = normalize_mrn_for_storage(str(payload["mrn"]))
    if not re.search(r"\d", mrn):
        raise HTTPException(
            status_code=400,
            detail="MRN must include numbers (e.g. MRN-1001). Do not leave only 'MRN-' — type the full id.",
        )

    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT patient_id FROM discharge_summaries WHERE discharge_id = %s",
            (discharge_id,),
        )
        ds_row = cur.fetchone()
        if not ds_row:
            raise HTTPException(status_code=404, detail="Discharge not found")
        patient_id = ds_row["patient_id"]

        cur.execute(
            f"""
            SELECT patient_id FROM patients
            WHERE (mrn = %s OR {mrn_duplicate_sql_clause()})
              AND patient_id != %s
            """,
            (mrn, mrn, patient_id),
        )
        if cur.fetchone():
            raise HTTPException(
                status_code=409,
                detail="That MRN belongs to another patient. Use a unique MRN or leave this patient's MRN unchanged.",
            )

        anth = anthropometric_from_payload(payload)
        admin = administrative_from_payload(payload)

        def _strip_or_none(k, mx):
            v = payload.get(k)
            if v is None or str(v).strip() == "":
                return None
            return str(v).strip()[:mx]

        cur.execute(
            """
            UPDATE patients SET
                name = %s, mrn = %s, dob = %s, age = %s, gender = %s,
                aadhaar = %s, address = %s, emergency_contact_name = %s, emergency_contact_phone = %s
            WHERE patient_id = %s
            """,
            (
                str(payload["name"]).strip()[:100],
                mrn,
                dob,
                age,
                str(payload["gender"]).strip()[:20],
                (str(payload["aadhaar"]).strip()[:20] if payload.get("aadhaar") else None),
                (payload.get("address") or None),
                (str(payload["emergency_contact_name"]).strip()[:100] if payload.get("emergency_contact_name") else None),
                (str(payload["emergency_contact_phone"]).strip()[:20] if payload.get("emergency_contact_phone") else None),
                patient_id,
            ),
        )

        cur.execute(
            """
            UPDATE discharge_summaries SET
                admission_date = %s, discharge_date = %s, length_of_stay = %s,
                admitting_physician = %s, discharging_physician = %s, mode_of_admission = %s, discharge_type = %s,
                chief_complaint = %s, history_of_present_illness = %s, summary_of_hospital_course = %s, activity_restrictions = %s,
                tobacco_use = %s, alcohol_use = %s, substance_use = %s, occupation_exposure = %s,
                vital_signs_admission = %s, anthropometric = %s, systemic_examination = %s,
                general_condition_discharge = %s, wound_drain_status = %s, functional_status = %s,
                administrative = %s
            WHERE discharge_id = %s
            """,
            (
                adm,
                dis,
                los,
                _strip_or_none("admitting_physician", 100),
                _strip_or_none("discharging_physician", 100),
                _strip_or_none("mode_of_admission", 50),
                _strip_or_none("discharge_type", 50),
                _strip_or_none("chief_complaint", 10000),
                _strip_or_none("history_of_present_illness", 10000),
                _strip_or_none("summary_of_hospital_course", 10000),
                _strip_or_none("activity_restrictions", 10000),
                _strip_or_none("tobacco_use", 20),
                _strip_or_none("alcohol_use", 20),
                _strip_or_none("substance_use", 50),
                _strip_or_none("occupation_exposure", 10000),
                narr_json("vital_signs_narrative"),
                anth,
                narr_json("systemic_examination_narrative"),
                _strip_or_none("general_condition_discharge", 50),
                _strip_or_none("wound_drain_status", 100),
                narr_json("functional_status_narrative"),
                admin,
                discharge_id,
            ),
        )

        cur.execute("DELETE FROM diagnoses WHERE discharge_id = %s", (discharge_id,))
        cur.execute("DELETE FROM lab_results WHERE discharge_id = %s", (discharge_id,))
        cur.execute("DELETE FROM medications_discharge WHERE discharge_id = %s", (discharge_id,))
        cur.execute("DELETE FROM allergies WHERE discharge_id = %s", (discharge_id,))

        _apply_child_rows_for_discharge(cur, discharge_id, payload)

        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        cur.close()
        conn.close()

    return {"patient_id": patient_id, "discharge_id": discharge_id}


# ================= SAVE =================
@app.post("/api/save-summary/{discharge_id}")
def save_summary(discharge_id: int, payload: dict = Body(...)):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        UPDATE discharge_summaries
        SET history_of_present_illness = %s,
            summary_of_hospital_course = %s,
            activity_restrictions = %s
        WHERE discharge_id = %s
    """, (payload.get("hpi"), payload.get("course"), payload.get("restrictions"), discharge_id))
    conn.commit()
    cur.close()
    conn.close()
    return {"message": "Saved successfully"}