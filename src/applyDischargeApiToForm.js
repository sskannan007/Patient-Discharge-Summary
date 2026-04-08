/**
 * Maps FastAPI GET /api/discharge/{id} payload into the print form DOM
 * (elements marked with data-ds-field) and lab/med tables.
 */

function setField(root, name, value) {
  const el = root.querySelector(`[data-ds-field="${name}"]`);
  if (!el || value == null || value === '') return;
  const v = String(value);
  if (el.tagName === 'SELECT') {
    const opt = [...el.options].find((o) => o.value === v || o.text === v);
    if (opt) el.value = opt.value;
    else el.value = '';
  } else {
    el.value = v;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function formatLos(val) {
  if (val == null || val === '' || val === 'N/A') return '';
  const n = Number(val);
  if (!Number.isNaN(n)) return `${n} days`;
  return String(val);
}

/** Value for `input type="datetime-local"` from API ISO / SQL datetime strings. */
function toDatetimeLocalValue(raw) {
  if (raw == null || raw === '' || raw === 'N/A') return '';
  const s = String(raw).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?/);
  if (m) return `${m[1]}T${m[2]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * @param {HTMLElement} root — #discharge-summary-print-area
 * @param {object} doc — API JSON with `sections`
 */
export function applyDischargeApiToForm(root, doc) {
  if (!root || !doc?.sections) return;

  const s1 = doc.sections.section_1?.fields || {};
  setField(root, 's1-patient-name', s1.patient_name);
  setField(root, 's1-mrn', s1.mrn_hospital_id);
  setField(root, 's1-ward', s1.ward);
  if (s1.dob && s1.dob !== 'N/A') {
    const d = String(s1.dob);
    setField(root, 's1-dob', d.length >= 10 ? d.slice(0, 10) : d);
  }
  setField(root, 's1-aadhaar', s1.aadhaar);
  setField(root, 's1-address', s1.address);
  setField(root, 's1-emergency-name', s1.emergency_contact_name);
  setField(root, 's1-emergency-phone', s1.emergency_contact_phone);
  setField(root, 's1-age', s1.age);
  setField(root, 's1-gender', s1.gender);
  setField(root, 's1-admission', toDatetimeLocalValue(s1.admission_date_time));
  setField(root, 's1-discharge', toDatetimeLocalValue(s1.discharge_date_time));
  setField(root, 's1-los', formatLos(s1.length_of_stay));
  setField(root, 's1-admitting', s1.admitting_physician);
  setField(root, 's1-discharging', s1.discharging_physician);
  setField(root, 's1-mode', s1.mode_of_admission);
  setField(root, 's1-discharge-type', s1.discharge_type);

  const s2 = doc.sections.section_2?.fields || {};
  const dx = s2.primary_diagnosis && s2.primary_diagnosis !== 'N/A' ? s2.primary_diagnosis : '';
  const icd = s2.primary_diagnosis_icd10_code && s2.primary_diagnosis_icd10_code !== 'N/A' ? s2.primary_diagnosis_icd10_code : '';
  const line = [dx && `${dx}`, icd && `(ICD-10-CM: ${icd})`].filter(Boolean).join(' ');
  setField(root, 's2-primary-line', line);

  const s3 = doc.sections.section_3?.fields || {};
  setField(root, 's3-cc', s3.chief_complaint);
  setField(root, 's3-hpi', s3.history_of_present_illness);
  setField(root, 's3-tobacco', s3.tobacco_use);
  setField(root, 's3-alcohol', s3.alcohol_use);
  setField(root, 's3-substance', s3.substance_use);
  setField(root, 's3-occupation', s3.occupation_exposure);

  const s4 = doc.sections.section_4?.fields || {};
  setField(root, 's4-vitals-combined', s4.vital_signs);
  setField(root, 's4-systemic-combined', s4.systemic_examination);
  const anth = s4.anthropometric;
  if (anth && typeof anth === 'object') {
    if (anth.height_cm != null && anth.height_cm !== '') setField(root, 's4-height', String(anth.height_cm));
    if (anth.weight_kg != null && anth.weight_kg !== '') setField(root, 's4-weight', String(anth.weight_kg));
    if (anth.bmi != null && anth.bmi !== '') setField(root, 's4-bmi', String(anth.bmi));
    if (anth.bsa != null && anth.bsa !== '') setField(root, 's4-bsa', String(anth.bsa));
  }

  fillLabsFromApi(root, doc.sections.section_5?.laboratory_investigations);

  const s6 = doc.sections.section_6?.fields || {};
  setField(root, 's6-course', s6.summary_of_hospital_course);

  const s7 = doc.sections.section_7?.fields || {};
  fillAllergiesFromApi(root, s7.allergies);
  fillMedsFromApi(root, s7.medications_on_discharge);

  const s8 = doc.sections.section_8?.fields || {};
  setField(root, 's8-general-condition', s8.general_condition_discharge);
  setField(root, 's8-functional-combined', s8.functional_status);
  setField(root, 's8-wound', s8.wound_drain_status);

  const s9 = doc.sections.section_9?.fields || {};
  setField(root, 's9-activity', s9.activity_dietary_restrictions);
}

function norm(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function fillAllergiesFromApi(root, allergies) {
  if (!Array.isArray(allergies) || allergies.length === 0) return;
  const section7 = [...root.querySelectorAll('.ds-section-card')].find((c) =>
    c.textContent?.includes('SECTION 7:')
  );
  if (!section7) return;
  const tables = section7.querySelectorAll('table');
  const allergyTable = tables[0];
  if (!allergyTable) return;
  const tbody = allergyTable.querySelector('tbody');
  if (!tbody) return;
  const rows = [...tbody.querySelectorAll('tr')].filter((tr) => tr.querySelectorAll('textarea').length >= 3);
  allergies.slice(0, rows.length).forEach((al, i) => {
    const tr = rows[i];
    const cells = tr.querySelectorAll('textarea');
    const vals = [al.allergen, al.reaction, al.severity];
    vals.forEach((v, j) => {
      if (cells[j] && v != null && v !== '') {
        cells[j].value = String(v);
        cells[j].dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });
}

function fillLabsFromApi(root, labs) {
  if (!Array.isArray(labs) || labs.length === 0) return;
  const table = root.querySelector('.ds-lab-investigations-table tbody');
  if (!table) return;
  const rows = [...table.querySelectorAll('tr')].filter((tr) => tr.querySelector('td.small'));

  for (const lab of labs) {
    const tn = norm(lab.test_name);
    if (!tn) continue;
    const row = rows.find((tr) => {
      const first = tr.querySelector('td.small');
      if (!first) return false;
      const label = norm(first.textContent);
      return label.includes(tn) || tn.includes(label.slice(0, Math.min(24, label.length)));
    });
    if (!row) continue;
    const textareas = row.querySelectorAll('textarea');
    if (textareas[0]) {
      textareas[0].value = lab.admission_value ?? '';
      textareas[0].dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (textareas[1]) {
      textareas[1].value = lab.discharge_value ?? '';
      textareas[1].dispatchEvent(new Event('input', { bubbles: true }));
    }
    const interp = lab.interpretation;
    if (interp) {
      const sel = row.querySelector('select');
      if (sel) {
        const opt = [...sel.options].find((o) => o.value === interp || o.text === interp);
        if (opt) sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }
}

function fillMedsFromApi(root, meds) {
  if (!Array.isArray(meds) || meds.length === 0) return;
  const section7 = [...root.querySelectorAll('.ds-section-card')].find((c) =>
    c.textContent?.includes('SECTION 7:')
  );
  if (!section7) return;
  const headings = section7.querySelectorAll('p.small.fw-semibold');
  let medTable = null;
  for (const p of headings) {
    if (p.textContent.includes('Medications on discharge')) {
      let el = p.nextElementSibling;
      while (el && el.tagName !== 'TABLE') el = el.nextElementSibling;
      medTable = el;
      break;
    }
  }
  if (!medTable) return;
  const tbody = medTable.querySelector('tbody');
  if (!tbody) return;
  const dataRows = [...tbody.querySelectorAll('tr')].filter((tr) => tr.querySelectorAll('td').length >= 7);

  meds.slice(0, dataRows.length).forEach((med, i) => {
    const tr = dataRows[i];
    const cells = tr.querySelectorAll('textarea');
    const fields = ['drug_name', 'dose', 'route', 'frequency', 'duration', 'special_instructions'];
    fields.forEach((key, j) => {
      if (cells[j] && med[key] != null) {
        cells[j].value = med[key];
        cells[j].dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });
}

/** Values for POST /api/save-summary/{id} (editable AI fields). */
export function collectSavePayload(root) {
  const hpi = root.querySelector('[data-ds-field="s3-hpi"]')?.value ?? '';
  const course = root.querySelector('[data-ds-field="s6-course"]')?.value ?? '';
  const restrictions = root.querySelector('[data-ds-field="s9-activity"]')?.value ?? '';
  return { hpi, course, restrictions };
}
