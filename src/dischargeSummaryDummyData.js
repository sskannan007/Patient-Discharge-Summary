/**
 * Demo / QA values for the discharge summary form (fictional patient).
 * applyDummyDataToDischargeForm() fills inputs, textareas, selects, radios, and checkboxes
 * inside #discharge-summary-print-area for print/PDF layout testing.
 */

import { resizeAllTextareasIn } from './formTextareaAutoResize';

const TEXT = {
  short: 'Stable. Tolerating oral intake.',
  medium:
    'Admitted for CAP. Completed antibiotic course. Afebrile 48h. Ambulating independently.',
  long: `Chief complaint: fever and productive cough × 5 days. CXR: right lower lobe infiltrate. Blood cultures negative. Treated with IV ceftriaxone (Day 1–5) then oral amoxicillin-clavulanate. Oxygen weaned to room air. Discharge meds reviewed with patient. Follow-up with primary care in 7 days; return if worsening dyspnea, fever, or confusion.`,
};

const TEXT_ROTATE = [TEXT.short, TEXT.medium, TEXT.long];

const TEXT_INPUTS = [
  'Rajesh Kumar',
  'MRN-2026-88421',
  '4127-8891-2233',
  'POL-HDFC-998877',
  '42, Lake View Road, Adyar, Chennai 600020',
  'Lakshmi Kumar',
  'Spouse',
  '+91 98765 43210',
  'Ward 3B / Bed 12',
  'Dr. Ananya Sharma',
  'Dr. Vikram Iyer',
  'Dr. Meera Nair',
  'Cardiology OP',
  'Dr. S. Raman',
  'Physiotherapy — gait training',
  'Social services — home assessment',
  'ICD-10: J18.9',
  'ICD-10: I10',
  'CPT: 99223',
  '98.2',
  '88',
  '118/72',
  '18',
  '96',
  '15/15',
  '172',
  '74',
  '24.9',
  '1.9',
  'Hb 13.2',
  'WBC 9.1',
  '112',
  'Dr. Signature — Discharge',
  'Reg. MED-45210',
  'General Medicine',
  'R. Kumar (patient)',
  'Self',
  'Nurse K. Joseph',
  'Coder: P. Das',
  'REF-CLAIM-2026-441',
];

/**
 * @param {HTMLElement | null} root — usually printRef.current (#discharge-summary-print-area)
 */
export function applyDummyDataToDischargeForm(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;

  const fire = (el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  let ti = 0;
  root.querySelectorAll('textarea').forEach((el, idx) => {
    el.value = TEXT_ROTATE[idx % TEXT_ROTATE.length];
    fire(el);
  });

  root.querySelectorAll('input').forEach((el) => {
    const t = (el.type || 'text').toLowerCase();
    if (t === 'hidden' || t === 'file') return;

    if (t === 'checkbox') {
      el.checked = ti % 2 === 0;
      ti += 1;
      fire(el);
      return;
    }

    if (t === 'radio') return;

    if (t === 'date') {
      el.value = '2026-03-15';
    } else if (t === 'datetime-local') {
      el.value = '2026-03-20T10:30';
    } else if (t === 'time') {
      el.value = '14:00';
    } else if (t === 'number') {
      const ph = (el.placeholder || '').toLowerCase();
      if (ph.includes('yrs')) el.value = '62';
      else if (ph.includes('day')) el.value = '6';
      else el.value = String(20 + (ti % 30));
    } else if (t === 'tel') {
      el.value = '+91 98765 43210';
    } else {
      el.value = TEXT_INPUTS[ti % TEXT_INPUTS.length];
      ti += 1;
    }
    fire(el);
  });

  const radiosByName = {};
  root.querySelectorAll('input[type="radio"]').forEach((el) => {
    if (!el.name) return;
    (radiosByName[el.name] ||= []).push(el);
  });
  Object.values(radiosByName).forEach((group) => {
    const yes = group.find((r) => (r.labels?.[0]?.textContent || '').trim().toLowerCase() === 'yes');
    const pick = yes || group[0];
    if (pick) {
      pick.checked = true;
      fire(pick);
    }
  });

  root.querySelectorAll('select').forEach((el) => {
    if (el.options.length < 2) return;
    const preferred = ['Yes', 'Normal', 'Active', 'Ambulatory', 'Emergency', 'Routine'];
    let idx = 1;
    for (let i = 1; i < el.options.length; i += 1) {
      const text = (el.options[i].text || '').trim();
      if (preferred.some((p) => text === p || text.startsWith(p))) {
        idx = i;
        break;
      }
    }
    el.selectedIndex = idx;
    fire(el);
  });

  /** Map long demo strings to the right Section 1 fields (avoid address in “Emergency contact — Name”). */
  const setTextareaNearLabel = (labelIncludes, value) => {
    root.querySelectorAll('label').forEach((lab) => {
      if (!lab.textContent.includes(labelIncludes)) return;
      const group = lab.closest('.mb-3') || lab.parentElement;
      const ta = group?.querySelector('textarea');
      if (ta) {
        ta.value = value;
        fire(ta);
      }
    });
  };
  setTextareaNearLabel('Patient Name', TEXT_INPUTS[0]);
  setTextareaNearLabel('MRN / Hospital ID', TEXT_INPUTS[1]);
  setTextareaNearLabel('National ID / Aadhaar', TEXT_INPUTS[2]);
  setTextareaNearLabel('Insurance / Payer ID', TEXT_INPUTS[3]);
  setTextareaNearLabel('Address', TEXT_INPUTS[4]);
  setTextareaNearLabel('Emergency contact', TEXT_INPUTS[5]);
  setTextareaNearLabel('Relationship', TEXT_INPUTS[6]);

  /**
   * Generic input/textarea fill above assigns random TEXT_INPUTS to date fields (DOB, admission, …),
   * which breaks POST /api/discharge/save-new. Override all data-ds-field Section 1 values with parseable demo data.
   */
  const setDs = (field, value) => {
    const el = root.querySelector(`[data-ds-field="${field}"]`);
    if (el && 'value' in el) {
      el.value = value;
      fire(el);
    }
  };
  const stamp = Date.now().toString(36).toUpperCase();
  setDs('s1-patient-name', 'Demo Patient');
  setDs('s1-mrn', `MRN-DEMO-${stamp}`);
  setDs('s1-dob', '1980-06-15');
  setDs('s1-age', '45');
  setDs('s1-gender', 'Male');
  setDs('s1-aadhaar', 'XXXX-XXXX-1234');
  setDs('s1-address', TEXT_INPUTS[4]);
  setDs('s1-emergency-name', TEXT_INPUTS[5]);
  setDs('s1-emergency-phone', '+91 98765 43210');
  setDs('s1-admission', '2026-03-10T09:00');
  setDs('s1-discharge', '2026-03-16T11:00');
  setDs('s1-los', '6 days');
  setDs('s1-ward', 'Ward 3B / Bed 12');
  setDs('s1-mode', 'Emergency');
  setDs('s1-discharge-type', 'Routine');
  setDs('s1-admitting', 'Dr. Ananya Sharma');
  setDs('s1-discharging', 'Dr. Vikram Iyer');

  resizeAllTextareasIn(root);
}

/** Fictional summary for manual copy-paste or external tools */
export const DUMMY_CASE_SUMMARY = {
  patient: 'Rajesh Kumar',
  mrn: 'MRN-2026-88421',
  age: 62,
  diagnosis: 'Community-acquired pneumonia, resolved',
  course: TEXT.long,
  dischargeMeds: 'Amoxicillin-clavulanate 625 mg PO TID × 5 days (complete course). Paracetamol 500 mg PRN fever.',
  followUp: 'OPD General Medicine — 2026-03-27 10:30',
};
