/**
 * Backend base URL. In dev, Vite proxies `/api` → FastAPI (see vite.config.js).
 * For production, set VITE_API_BASE to the public API origin (no trailing slash).
 */
export function apiUrl(path) {
  const base = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

export async function fetchPatients() {
  const res = await fetch(apiUrl('/api/patients'));
  if (!res.ok) throw new Error(`Patients: ${res.status}`);
  return res.json();
}

/** Full patient columns + discharge_id per discharge (see GET /api/patient-records). */
export async function fetchPatientRecords() {
  const res = await fetch(apiUrl('/api/patient-records'));
  if (!res.ok) throw new Error(`Patient records: ${res.status}`);
  return res.json();
}

export async function fetchDischarge(dischargeId) {
  const res = await fetch(apiUrl(`/api/discharge/${dischargeId}`));
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Discharge: ${res.status}`);
  }
  return res.json();
}

export async function saveSummary(dischargeId, payload) {
  const res = await fetch(apiUrl(`/api/save-summary/${dischargeId}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Save: ${res.status}`);
  return res.json();
}

/** Insert patient + discharge from PATIENT DISCHARGE SUMMARY form. Returns { patient_id, discharge_id }. */
export async function saveDischargeFromForm(payload) {
  const res = await fetch(apiUrl('/api/discharge/save-new'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `Save: ${res.status}`;
    try {
      const err = await res.json();
      if (typeof err.detail === 'string') msg = err.detail;
      else if (Array.isArray(err.detail)) msg = err.detail.map((d) => d.msg || d).join(' ');
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

/** Update existing patient + discharge (same payload shape as save-new). */
export async function updateDischargeFromForm(dischargeId, payload) {
  const res = await fetch(apiUrl(`/api/discharge/${dischargeId}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `Update: ${res.status}`;
    try {
      const err = await res.json();
      if (typeof err.detail === 'string') msg = err.detail;
      else if (Array.isArray(err.detail)) msg = err.detail.map((d) => d.msg || d).join(' ');
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}
