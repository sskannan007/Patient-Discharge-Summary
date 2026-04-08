/**
 * Reads PATIENT DISCHARGE SUMMARY form fields (data-ds-field) for POST /api/discharge/save-new
 */

function val(root, field) {
  const el = root.querySelector(`[data-ds-field="${field}"]`);
  if (!el) return '';
  const v = 'value' in el ? el.value : '';
  return typeof v === 'string' ? v.trim() : String(v ?? '').trim();
}

function collectLabsFromForm(root) {
  const table = root.querySelector('.ds-lab-investigations-table tbody');
  if (!table) return [];
  const out = [];
  for (const tr of table.querySelectorAll('tr')) {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 5) continue;
    const testName = cells[0]?.textContent?.trim();
    if (!testName || testName.startsWith('Other:')) continue;
    const textareas = tr.querySelectorAll('textarea');
    const admission = textareas[0]?.value?.trim() ?? '';
    const discharge = textareas[1]?.value?.trim() ?? '';
    const refRange = cells[3]?.textContent?.trim() ?? '';
    const sel = tr.querySelector('select');
    const interpretation = sel?.value?.trim() ?? '';
    if (!admission && !discharge && !interpretation) continue;
    out.push({
      test_name: testName.slice(0, 100),
      admission_value: admission.slice(0, 50),
      discharge_value: discharge.slice(0, 50),
      reference_range: refRange.slice(0, 100),
      interpretation: interpretation.slice(0, 50),
    });
  }
  return out;
}

function collectMedsFromForm(root) {
  const section7 = [...root.querySelectorAll('.ds-section-card')].find((c) => c.textContent?.includes('SECTION 7:'));
  if (!section7) return [];
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
  if (!medTable) return [];
  const tbody = medTable.querySelector('tbody');
  if (!tbody) return [];
  const dataRows = [...tbody.querySelectorAll('tr')].filter((tr) => tr.querySelectorAll('td').length >= 7);
  const out = [];
  for (const tr of dataRows) {
    const cells = tr.querySelectorAll('textarea');
    const drug_name = cells[0]?.value?.trim() ?? '';
    if (!drug_name) continue;
    out.push({
      drug_name: drug_name.slice(0, 100),
      dose: (cells[1]?.value ?? '').trim().slice(0, 50),
      route: (cells[2]?.value ?? '').trim().slice(0, 30),
      frequency: (cells[3]?.value ?? '').trim().slice(0, 50),
      duration: (cells[4]?.value ?? '').trim().slice(0, 50),
      special_instructions: (cells[5]?.value ?? '').trim().slice(0, 2000),
    });
  }
  return out;
}

function collectAllergiesFromForm(root) {
  const section7 = [...root.querySelectorAll('.ds-section-card')].find((c) => c.textContent?.includes('SECTION 7:'));
  if (!section7) return [];
  const tables = section7.querySelectorAll('table');
  const allergyTable = tables[0];
  if (!allergyTable || !allergyTable.textContent?.includes('Allergen')) return [];
  const out = [];
  for (const tr of allergyTable.querySelectorAll('tbody tr')) {
    const cells = tr.querySelectorAll('textarea');
    if (cells.length < 3) continue;
    const allergen = cells[0]?.value?.trim() ?? '';
    const reaction = cells[1]?.value?.trim() ?? '';
    const severity = cells[2]?.value?.trim() ?? '';
    if (!allergen && !reaction && !severity) continue;
    out.push({
      allergen: allergen.slice(0, 500),
      reaction: reaction.slice(0, 500),
      severity: severity.slice(0, 20),
    });
  }
  return out;
}

/**
 * @param {HTMLElement} root — #discharge-summary-print-area
 * @returns {object} flat payload for API
 */
export function collectDischargeFormInsertPayload(root) {
  if (!root) return {};
  const base = {
    name: val(root, 's1-patient-name'),
    mrn: val(root, 's1-mrn'),
    dob: val(root, 's1-dob'),
    age: val(root, 's1-age'),
    gender: val(root, 's1-gender'),
    aadhaar: val(root, 's1-aadhaar') || null,
    address: val(root, 's1-address') || null,
    emergency_contact_name: val(root, 's1-emergency-name') || null,
    emergency_contact_phone: val(root, 's1-emergency-phone') || null,
    ward: val(root, 's1-ward') || null,
    admission_date_time: val(root, 's1-admission'),
    discharge_date_time: val(root, 's1-discharge'),
    length_of_stay_text: val(root, 's1-los'),
    admitting_physician: val(root, 's1-admitting') || null,
    discharging_physician: val(root, 's1-discharging') || null,
    mode_of_admission: val(root, 's1-mode') || null,
    discharge_type: val(root, 's1-discharge-type') || null,
    tobacco_use: val(root, 's3-tobacco') || null,
    alcohol_use: val(root, 's3-alcohol') || null,
    substance_use: val(root, 's3-substance') || null,
    occupation_exposure: val(root, 's3-occupation') || null,
    chief_complaint: val(root, 's3-cc') || null,
    history_of_present_illness: val(root, 's3-hpi') || null,
    summary_of_hospital_course: val(root, 's6-course') || null,
    activity_restrictions: val(root, 's9-activity') || null,
    vital_signs_narrative: val(root, 's4-vitals-combined') || null,
    systemic_examination_narrative: val(root, 's4-systemic-combined') || null,
    functional_status_narrative: val(root, 's8-functional-combined') || null,
    general_condition_discharge: val(root, 's8-general-condition') || null,
    wound_drain_status: val(root, 's8-wound') || null,
    anthro_height_cm: val(root, 's4-height') || null,
    anthro_weight_kg: val(root, 's4-weight') || null,
    anthro_bmi: val(root, 's4-bmi') || null,
    anthro_bsa: val(root, 's4-bsa') || null,
    primary_diagnosis_line: val(root, 's2-primary-line') || null,
  };
  return {
    ...base,
    labs: collectLabsFromForm(root),
    medications: collectMedsFromForm(root),
    allergies: collectAllergiesFromForm(root),
  };
}
