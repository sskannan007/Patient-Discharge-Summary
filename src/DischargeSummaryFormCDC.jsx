/**
 * Discharge Summary — CDC / NHS / NIH template UI
 * Requires: react, react-bootstrap, bootstrap (import CSS in your app entry)
 *   npm install react-bootstrap bootstrap
 *   import 'bootstrap/dist/css/bootstrap.min.css';
 */

import React, { useLayoutEffect, useRef } from 'react';
import {
  Container,
  Row,
  Col,
  Form,
  Table,
  Card,
  Badge,
  Alert,
  Button,
} from 'react-bootstrap';
import html2pdf from 'html2pdf.js';
import { applyDummyDataToDischargeForm } from './dischargeSummaryDummyData';
import {
  attachTextareaAutoResize,
  mirrorFormFieldsForHtml2CanvasClone,
  resizeAllTextareasIn,
} from './formTextareaAutoResize';
import './DischargeSummaryPrint.css';
import './DischargeSummaryTheme.css';

/** Interpretation choices per institutional lab table (document-aligned). */
const LAB_INTERP_NORMAL_LOW_HIGH = ['Normal', 'Low', 'High'];
const LAB_INTERP_HBA1C = ['Normal', 'Pre-DM', 'DM'];
const LAB_INTERP_NORMAL_ELEVATED = ['Normal', 'Elevated'];
const LAB_INTERP_ABG = ['Normal', 'Abnormal'];

/** Section 10 IPC — status options per institutional row (document-aligned). */
const IPC_ROWS = [
  { id: 'cauti', label: 'CAUTI — Urinary Catheter Present', statusKind: 'yesNo' },
  { id: 'clabsi', label: 'CLABSI — Central Line Present', statusKind: 'yesNo' },
  { id: 'vap', label: 'VAP — Mechanical Ventilation', statusKind: 'yesNo' },
  { id: 'ssi', label: 'SSI — Surgical Site Infection Noted', statusKind: 'yesNo' },
  { id: 'isolation', label: 'Isolation Precautions (Contact / Droplet / Airborne)', statusKind: 'yesNoType' },
  { id: 'mdro', label: 'MDRO Screening (MRSA / VRE / ESBL)', statusKind: 'mdro' },
  { id: 'notifiable', label: 'Notifiable Disease Reported to Public Health', statusKind: 'yesNoNA', dateDiscontinued: 'emDash' },
];

function IpcStatusCell({ row }) {
  const baseLabel = `${row.label} status`;
  if (row.statusKind === 'yesNo') {
    return (
      <Form.Select size="sm" aria-label={baseLabel}>
        <option value="">Select</option>
        <option>Yes</option>
        <option>No</option>
      </Form.Select>
    );
  }
  if (row.statusKind === 'yesNoType') {
    return (
      <div className="d-flex flex-column gap-1">
        <Form.Select size="sm" aria-label={baseLabel}>
          <option value="">Select</option>
          <option>Yes</option>
          <option>No</option>
        </Form.Select>
        <div className="d-flex align-items-center gap-1 small">
          <span className="text-nowrap flex-shrink-0">Type:</span>
          <Form.Control
            size="sm"
            as="textarea"
            rows={1}
            placeholder=""
            aria-label={`${row.label} precaution type`}
          />
        </div>
      </div>
    );
  }
  if (row.statusKind === 'mdro') {
    return (
      <Form.Select size="sm" aria-label={baseLabel}>
        <option value="">Select</option>
        <option>Positive</option>
        <option>Negative</option>
        <option>Pending</option>
      </Form.Select>
    );
  }
  if (row.statusKind === 'yesNoNA') {
    return (
      <Form.Select size="sm" aria-label={baseLabel}>
        <option value="">Select</option>
        <option>Yes</option>
        <option>No</option>
        <option>N.A.</option>
      </Form.Select>
    );
  }
  return null;
}

/** Section 11 — Complied column matches document (Yes/No, Score field, or Yes/No/N.A.). */
const QUALITY_SAFETY_ROWS = [
  { id: 'vte', label: 'VTE Prophylaxis Administered (DVT/PE Prevention)', complied: 'yesNo' },
  { id: 'fall', label: 'Fall Risk Assessment Completed (Morse / Hendrich)', complied: 'yesNo' },
  { id: 'pressure', label: 'Pressure Ulcer / Decubitus Risk Assessment (Braden Scale)', complied: 'yesNo' },
  { id: 'sepsis', label: 'Sepsis Bundle Compliance (Surviving Sepsis Campaign)', complied: 'yesNo' },
  { id: 'code', label: 'Code Status / Advance Care Planning Documented', complied: 'yesNo' },
  { id: 'consent', label: 'Informed Consent Obtained for All Procedures', complied: 'yesNo' },
  { id: 'idproto', label: 'Patient Identification Protocol (2-Point ID) Followed', complied: 'yesNo' },
  { id: 'pain', label: 'Pain Assessment Documented (NRS / VAS / FLACC Scale)', complied: 'yesNo' },
  { id: 'readmission', label: 'Readmission Risk Screened (LACE / HOSPITAL Score)', complied: 'score' },
  { id: 'adverse', label: 'Adverse Event / Near Miss Reported (Incident Report Filed)', complied: 'yesNoNA' },
];

function QualityCompliedCell({ row }) {
  const base = `${row.label} complied`;
  if (row.complied === 'score') {
    return (
      <div className="d-flex align-items-center gap-2 flex-wrap">
        <span className="small text-nowrap">Score:</span>
        <Form.Control
          size="sm"
          as="textarea"
          rows={1}
          style={{ minWidth: '5rem', maxWidth: '12rem' }}
          aria-label={`${row.label} score`}
        />
      </div>
    );
  }
  if (row.complied === 'yesNoNA') {
    return (
      <Form.Select size="sm" aria-label={base}>
        <option value="">Select</option>
        <option>Yes</option>
        <option>No</option>
        <option>N.A.</option>
      </Form.Select>
    );
  }
  return (
    <Form.Select size="sm" aria-label={base}>
      <option value="">Select</option>
      <option>Yes</option>
      <option>No</option>
    </Form.Select>
  );
}

function SectionCard({ number, title, children }) {
  return (
    <Card className="ds-section-card mb-4">
      <Card.Header className="ds-section-card__header border-0 py-2 px-3 small">
        SECTION {number}: {title}
      </Card.Header>
      <Card.Body className="ds-section-card__body py-3 px-3">{children}</Card.Body>
    </Card>
  );
}

function LabRow({ test, refRange, interpretationOptions }) {
  return (
    <tr>
      <td className="small">{test}</td>
      <td>
        <Form.Control size="sm" as="textarea" rows={1} />
      </td>
      <td>
        <Form.Control size="sm" as="textarea" rows={1} />
      </td>
      <td className="small text-muted">{refRange}</td>
      <td>
        <Form.Select size="sm" aria-label={`${test} interpretation`}>
          <option value="">Select the interpretation</option>
          {interpretationOptions.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </Form.Select>
      </td>
    </tr>
  );
}

export default function DischargeSummaryFormCDC() {
  const printRef = useRef(null);

  useLayoutEffect(() => {
    const root = printRef.current;
    if (!root) return undefined;
    return attachTextareaAutoResize(root);
  }, []);

  const handlePrint = () => {
    resizeAllTextareasIn(printRef.current);
    window.print();
  };

  const handleFillDummyData = () => {
    applyDummyDataToDischargeForm(printRef.current);
  };

  const handleDownloadPdf = () => {
    const el = printRef.current;
    if (!el) return;
    resizeAllTextareasIn(el);
    const stamp = new Date().toISOString().slice(0, 10);
    const opt = {
      margin: [10, 10, 10, 10],
      filename: `discharge-summary-${stamp}.pdf`,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        /* Match desktop layout (Container maxWidth) — html2canvas ignores @media print */
        windowWidth: 1200,
        scrollY: 0,
        scrollX: 0,
        /* html2canvas uses default row height unless we expand — avoids overlapped text in PDF */
        onclone(clonedDoc) {
          const root = clonedDoc.getElementById('discharge-summary-print-area');
          if (!root) return;
          /* html2canvas draws custom appearance:none + SVG chevron poorly — use native menulist + room for arrow */
          const fixSelect = clonedDoc.createElement('style');
          fixSelect.setAttribute('data-html2pdf-select-fix', '');
          fixSelect.textContent = `
            #discharge-summary-print-area.ds-pdf-capture select.form-select,
            #discharge-summary-print-area.ds-pdf-capture select {
              -webkit-appearance: menulist !important;
              appearance: auto !important;
              background-image: none !important;
              background-color: #fbf9f6 !important;
              padding: 0.375rem 2.25rem 0.375rem 0.65rem !important;
              font-weight: 500 !important;
            }
            #discharge-summary-print-area.ds-pdf-capture select.form-select-sm {
              padding: 0.25rem 2rem 0.25rem 0.5rem !important;
              min-height: calc(1.5em + 0.5rem + 2px) !important;
            }
          `;
          const head = clonedDoc.head;
          if (head) {
            head.appendChild(fixSelect);
          } else if (root.firstChild) {
            root.insertBefore(fixSelect, root.firstChild);
          } else {
            root.appendChild(fixSelect);
          }
          /* html2canvas clips textarea / text-input paint; div mirrors wrap & show full content */
          mirrorFormFieldsForHtml2CanvasClone(root);
        },
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      /*
       * avoid-all walks every node and can corrupt layout. Use CSS break-* + explicit breaks between sections.
       */
      pagebreak: {
        mode: ['css', 'legacy'],
        before: [
          '#discharge-summary-print-area .container-fluid > .card.ds-section-card + .card.ds-section-card',
        ],
      },
    };
    el.classList.add('ds-pdf-capture');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        html2pdf()
          .set(opt)
          .from(el)
          .save()
          .finally(() => el.classList.remove('ds-pdf-capture'));
      });
    });
  };

  return (
    <div className="ds-app-shell">
      <div
        ref={printRef}
        id="discharge-summary-print-area"
        className="discharge-summary-print-area"
      >
        <Container fluid className="ds-print-inner py-4 px-3" style={{ maxWidth: '1200px' }}>
      {/* Document header — matches PDF masthead */}
      <Card className="ds-masthead mb-4 border-0">
        <div className="ds-masthead__accent-bar" aria-hidden="true" />
        <div className="ds-masthead__ribbon">
          <Row className="align-items-start">
            <Col md={8}>
              <div className="ds-masthead__org text-uppercase">
                Apex Tertiary Care Hospital &amp; Research Institute
              </div>
              <div className="ds-masthead__dept">
                Dept. of Medical Records &amp; Clinical Documentation
              </div>
            </Col>
            <Col md={4} className="ds-masthead__badge-wrap mt-2 mt-md-0">
              <div className="ds-masthead__badge">
                Discharge Summary
              </div>
              <div className="ds-masthead__meta">Form DS-2025 | Version 4.1</div>
            </Col>
          </Row>
        </div>
        <div className="ds-masthead__title-block text-center">
          <h3 className="ds-masthead__title">PATIENT DISCHARGE SUMMARY</h3>
          <p className="ds-masthead__subtitle mb-1">
            Compliant with CDC, NHS, and NIH Documentation Standards
          </p>
          {/* <div className="ds-masthead__confidential-line">
            <span className="fw-semibold">CONFIDENTIAL — For Authorized Use Only</span>
            <span className="ds-masthead__confidential-sep">|</span>
            <span>Apex Tertiary Care Hospital</span>
            <span className="ds-masthead__confidential-sep">|</span>
            <span>Compliant: CDC / NHS / NIH</span>
            <span className="ds-masthead__confidential-sep">|</span>
            <span>Page&nbsp;PageNumber</span>
          </div> */}
        </div>
      </Card>

      {/* SECTION 1 — table grid, matches PDF layout */}
      <SectionCard number={1} title="Patient Identification & Admission Details">
        <Table bordered size="sm" className="mb-0 ds-section1-table">
          <tbody>
            <tr>
              <td className="ds-section1-label-cell">Patient Name</td>
              <td className="ds-section1-value-cell">
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
              <td className="ds-section1-label-cell">MRN / Hospital ID</td>
              <td className="ds-section1-value-cell">
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
            </tr>
            <tr>
              <td className="ds-section1-label-cell">Date of Birth</td>
              <td className="ds-section1-value-cell">
                <Form.Control
                  size="sm"
                  type="text"
                  placeholder="DD / MM / YYYY"
                  aria-label="Date of birth"
                />
              </td>
              <td className="ds-section1-label-cell">Age / Gender</td>
              <td className="ds-section1-value-cell">
                <div className="ds-section1-split-row">
                  <Form.Control
                    size="sm"
                    type="text"
                    placeholder="___ yrs"
                    aria-label="Age in years"
                  />
                  <Form.Control
                    size="sm"
                    type="text"
                    placeholder="M / F / Other"
                    aria-label="Gender"
                  />
                </div>
              </td>
            </tr>
            <tr>
              <td className="ds-section1-label-cell">National ID / Aadhaar</td>
              <td className="ds-section1-value-cell">
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
              <td className="ds-section1-label-cell">Insurance / Payer ID</td>
              <td className="ds-section1-value-cell">
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
            </tr>
            <tr>
              <td className="ds-section1-label-cell">Address</td>
              <td className="ds-section1-value-cell" colSpan={3}>
                <Form.Control size="sm" as="textarea" rows={2} />
              </td>
            </tr>
            <tr>
              <td className="ds-section1-label-cell">Emergency Contact</td>
              <td className="ds-section1-value-cell">
                <Form.Control
                  size="sm"
                  as="textarea"
                  rows={1}
                  placeholder="Name"
                  aria-label="Emergency contact name"
                />
              </td>
              <td className="ds-section1-label-cell">Relationship / Phone</td>
              <td className="ds-section1-value-cell">
                <div className="ds-section1-split-row">
                  <Form.Control
                    size="sm"
                    as="textarea"
                    rows={1}
                    placeholder="Relationship"
                    aria-label="Emergency contact relationship"
                  />
                  <Form.Control
                    size="sm"
                    type="tel"
                    placeholder="Phone"
                    aria-label="Emergency contact phone"
                  />
                </div>
              </td>
            </tr>
            <tr>
              <td className="ds-section1-label-cell">Admission Date &amp; Time</td>
              <td className="ds-section1-value-cell">
                <Form.Control
                  size="sm"
                  type="text"
                  placeholder="DD/MM/YYYY HH:MM"
                  aria-label="Admission date and time"
                />
              </td>
              <td className="ds-section1-label-cell">Discharge Date &amp; Time</td>
              <td className="ds-section1-value-cell">
                <Form.Control
                  size="sm"
                  type="text"
                  placeholder="DD/MM/YYYY HH:MM"
                  aria-label="Discharge date and time"
                />
              </td>
            </tr>
            <tr>
              <td className="ds-section1-label-cell">Ward / Unit / Bed No.</td>
              <td className="ds-section1-value-cell">
                <Form.Control
                  size="sm"
                  type="text"
                  placeholder="___ / ___ / ___"
                  aria-label="Ward unit bed number"
                />
              </td>
              <td className="ds-section1-label-cell">Total Length of Stay</td>
              <td className="ds-section1-value-cell">
                <Form.Control
                  size="sm"
                  type="text"
                  placeholder="___ days"
                  aria-label="Total length of stay in days"
                />
              </td>
            </tr>
            <tr>
              <td className="ds-section1-label-cell">Admitting Physician</td>
              <td className="ds-section1-value-cell">
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
              <td className="ds-section1-label-cell">Discharging Physician</td>
              <td className="ds-section1-value-cell">
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
            </tr>
            <tr>
              <td className="ds-section1-label-cell">Mode of Admission</td>
              <td className="ds-section1-value-cell">
                <Form.Control
                  size="sm"
                  as="textarea"
                  rows={1}
                  placeholder="Emergency / Elective / Transfer / OPD Referral"
                  aria-label="Mode of admission"
                />
              </td>
              <td className="ds-section1-label-cell">Discharge Type</td>
              <td className="ds-section1-value-cell">
                <Form.Control
                  size="sm"
                  as="textarea"
                  rows={1}
                  placeholder="Routine / LAMA / Transfer / Expired"
                  aria-label="Discharge type"
                />
              </td>
            </tr>
          </tbody>
        </Table>
      </SectionCard>

      {/* SECTION 2 */}
      <SectionCard number={2} title="Diagnosis">
        <Alert variant="light" className="small py-2 mb-3 border fst-italic">
          Note: ICD-10 coding aligns with CDC NCHS guidelines. Dual coding (ICD-10-CM/PCS) required for
          inpatient encounters.
        </Alert>
        <Table bordered responsive size="sm" className="mb-0 ds-band-header">
          <thead className="table-light">
            <tr>
              <th>Diagnosis</th>
              <th style={{ width: '22%' }}>ICD-10-CM Code</th>
              <th style={{ width: '18%' }}>Type</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Primary Diagnosis', 'Primary'],
              ['Secondary Diagnosis 1', 'Comorbidity'],
              ['Secondary Diagnosis 2', 'Comorbidity'],
              ['Complication (if any)', 'Complication'],
              ['Procedure (Primary)', 'CPT / ICD-10-PCS'],
              ['Procedure (Secondary)', 'CPT / ICD-10-PCS'],
            ].map(([label, type]) => (
              <tr key={label}>
                <td className="small align-middle fw-semibold">{label}</td>
                <td>
                  <Form.Control size="sm" as="textarea" rows={1} />
                </td>
                <td className="small text-muted align-middle">{type}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </SectionCard>

      {/* SECTION 3 */}
      <SectionCard number={3} title="Presenting Complaint & History of Present Illness">
        <Form.Group className="mb-3">
          <Form.Label className="small fw-semibold">Chief complaint (CC)</Form.Label>
          <Form.Control as="textarea" rows={2} />
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label className="small fw-semibold">History of present illness (HPI)</Form.Label>
          <Form.Control as="textarea" rows={4} />
        </Form.Group>
        <p className="small fw-semibold mb-2">Relevant past medical, surgical &amp; family history</p>
        <Table bordered size="sm" className="mb-3 ds-section3-history-table ds-band-header">
          <thead>
            <tr>
              <th>Past medical history</th>
              <th>Past surgical history</th>
              <th>Family history</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Form.Control size="sm" as="textarea" rows={3} />
              </td>
              <td>
                <Form.Control size="sm" as="textarea" rows={3} />
              </td>
              <td>
                <Form.Control size="sm" as="textarea" rows={3} />
              </td>
            </tr>
          </tbody>
        </Table>
        <p className="small fw-semibold mb-2">Social &amp; occupational history</p>
        <Table bordered size="sm" className="mb-0 ds-band-header">
          <thead>
            <tr>
              <th>Tobacco use</th>
              <th>Alcohol use</th>
              <th>Substance use</th>
              <th>Occupation / exposure</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Form.Select size="sm" aria-label="Tobacco use">
                  <option value="">Yes / No / Ex</option>
                  <option>Yes</option>
                  <option>No</option>
                  <option>Ex</option>
                </Form.Select>
              </td>
              <td>
                <Form.Select size="sm" aria-label="Alcohol use">
                  <option value="">Yes / No / Ex</option>
                  <option>Yes</option>
                  <option>No</option>
                  <option>Ex</option>
                </Form.Select>
              </td>
              <td>
                <Form.Select size="sm" aria-label="Substance use">
                  <option value="">Yes / No / Type</option>
                  <option>Yes</option>
                  <option>No</option>
                  <option>Type specified</option>
                </Form.Select>
              </td>
              <td>
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
            </tr>
          </tbody>
        </Table>
      </SectionCard>

      {/* SECTION 4 */}
      <SectionCard number={4} title="Clinical Examination on Admission">
        <p className="small fw-semibold mb-2 ds-section4-subtitle">Vital Signs on Admission:</p>
        <Table bordered size="sm" className="mb-3 ds-section4-vitals-table">
          <thead>
            <tr>
              <th>Temp (°C)</th>
              <th>HR (bpm)</th>
              <th>BP (mmHg)</th>
              <th>RR (/min)</th>
              <th>SpO₂ (%)</th>
              <th>GCS</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
              <td>
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
              <td>
                <Form.Control size="sm" as="textarea" rows={1} placeholder="____/____" />
              </td>
              <td>
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
              <td>
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
              <td>
                <Form.Control size="sm" as="textarea" rows={1} placeholder="E_V_M_" />
              </td>
            </tr>
          </tbody>
        </Table>

        <p className="small fw-semibold mb-2 ds-section4-subtitle">Anthropometric Measurements:</p>
        <Table bordered size="sm" className="mb-3 ds-section4-anthro-table">
          <thead>
            <tr>
              <th>Height (cm)</th>
              <th>Weight (kg)</th>
              <th>BMI (kg/m²)</th>
              <th>BSA (m²)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
              <td>
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
              <td>
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
              <td>
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
            </tr>
          </tbody>
        </Table>

        <p className="small fw-semibold mb-2 ds-section4-subtitle">Systemic Examination Findings:</p>
        <Table bordered size="sm" className="mb-0 ds-section4-systemic-table">
          <tbody>
            {[
              'Cardiovascular',
              'Respiratory',
              'Gastrointestinal',
              'Neurological',
              'Musculoskeletal',
              'Genitourinary',
              'Skin / Lymph Nodes',
            ].map((label) => (
              <tr key={label}>
                <td className="ds-section4-label-cell">{label}</td>
                <td>
                  <Form.Control size="sm" as="textarea" rows={1} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </SectionCard>

      {/* SECTION 5 */}
      <SectionCard number={5} title="Investigations & Diagnostic Results">
        <p className="small fw-semibold mb-2">Laboratory investigations</p>
        {/* No `responsive` wrapper: Bootstrap .table-responsive uses overflow-x:auto and clips native <select> dropdowns in the Interpretation column. */}
        <Table bordered size="sm" className="mb-4 ds-lab-investigations-table ds-band-header">
          <thead>
            <tr>
              <th>Test / panel</th>
              <th>Admission value</th>
              <th>Discharge value</th>
              <th>Reference range</th>
              <th>Interpretation</th>
            </tr>
          </thead>
          <tbody>
            <LabRow
              test="CBC — Hb (g/dL)"
              refRange="12–16 (F) / 13–17 (M)"
              interpretationOptions={LAB_INTERP_NORMAL_LOW_HIGH}
            />
            <LabRow
              test="CBC — WBC (×10³/μL)"
              refRange="4.5–11.0"
              interpretationOptions={LAB_INTERP_NORMAL_LOW_HIGH}
            />
            <LabRow
              test="CBC — Platelets (×10³/μL)"
              refRange="150–400"
              interpretationOptions={LAB_INTERP_NORMAL_LOW_HIGH}
            />
            <LabRow
              test="Serum Sodium (mEq/L)"
              refRange="136–145"
              interpretationOptions={LAB_INTERP_NORMAL_LOW_HIGH}
            />
            <LabRow
              test="Serum Potassium (mEq/L)"
              refRange="3.5–5.0"
              interpretationOptions={LAB_INTERP_NORMAL_LOW_HIGH}
            />
            <LabRow
              test="Creatinine (mg/dL)"
              refRange="0.6–1.2"
              interpretationOptions={LAB_INTERP_NORMAL_LOW_HIGH}
            />
            <LabRow
              test="Blood Urea Nitrogen (mg/dL)"
              refRange="7–20"
              interpretationOptions={LAB_INTERP_NORMAL_LOW_HIGH}
            />
            <LabRow
              test="Random/Fasting Blood Glucose"
              refRange="<140 / <100 mg/dL"
              interpretationOptions={LAB_INTERP_NORMAL_LOW_HIGH}
            />
            <LabRow test="HbA1c (%)" refRange="<5.7 (Normal)" interpretationOptions={LAB_INTERP_HBA1C} />
            <LabRow
              test="LFT — Total Bilirubin (mg/dL)"
              refRange="0.3–1.0"
              interpretationOptions={LAB_INTERP_NORMAL_ELEVATED}
            />
            <LabRow
              test="CRP / ESR / Procalcitonin"
              refRange="Institution-specific"
              interpretationOptions={LAB_INTERP_NORMAL_ELEVATED}
            />
            <LabRow
              test="ABG (pH / pO₂ / pCO₂)"
              refRange="7.35–7.45 / >80 / 35–45"
              interpretationOptions={LAB_INTERP_ABG}
            />
            <LabRow
              test="Cardiac Markers (Troponin I/T)"
              refRange="<0.04 ng/mL"
              interpretationOptions={LAB_INTERP_NORMAL_ELEVATED}
            />
            <tr>
              <td colSpan={5}>
                <Row className="g-2 align-items-center">
                  <Col xs="auto" className="small">
                    Other:
                  </Col>
                  <Col>
                    <Form.Control size="sm" as="textarea" rows={1} placeholder="Specify test" />
                  </Col>
                  <Col md={2}>
                    <Form.Control size="sm" as="textarea" rows={1} />
                  </Col>
                  <Col md={2}>
                    <Form.Control size="sm" as="textarea" rows={1} />
                  </Col>
                  <Col md={2}>
                    <Form.Control size="sm" as="textarea" rows={1} placeholder="Ref / interp." />
                  </Col>
                </Row>
              </td>
            </tr>
          </tbody>
        </Table>

        <p className="small fw-semibold mb-2">Microbiology &amp; culture reports</p>
        <Table bordered responsive size="sm" className="mb-4 ds-band-header ds-band-firstcol">
          <thead>
            <tr>
              <th>Specimen type</th>
              <th>Date collected</th>
              <th>Organism isolated</th>
              <th>Sensitivity pattern</th>
              <th>Action taken</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2].map((i) => (
              <tr key={i}>
                {Array.from({ length: 5 }).map((_, j) => (
                  <td key={j}>
                    <Form.Control size="sm" as="textarea" rows={1} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>

        <p className="small fw-semibold mb-2">Imaging &amp; diagnostic procedures</p>
        <Table bordered responsive size="sm" className="mb-0 ds-band-header ds-band-firstcol">
          <thead>
            <tr>
              <th>Study type</th>
              <th>Date</th>
              <th>Key findings</th>
              <th>Radiologist / report ref.</th>
            </tr>
          </thead>
          <tbody>
            {[
              'X-Ray / CT / MRI / USG',
              'ECG / Echo / Stress Test',
              'Endoscopy / Bronchoscopy',
              'Biopsy / Histopathology',
            ].map((study) => (
              <tr key={study}>
                <td className="small align-middle">{study}</td>
                <td>
                  <Form.Control size="sm" type="date" />
                </td>
                <td>
                  <Form.Control size="sm" as="textarea" rows={2} />
                </td>
                <td>
                  <Form.Control size="sm" as="textarea" rows={1} placeholder="Dr. / Ref." />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </SectionCard>

      {/* SECTION 6 */}
      <SectionCard number={6} title="Clinical Course & Management During Hospitalization">
        <Form.Group className="mb-3">
          <Form.Label className="small fw-semibold">Summary of Hospital Course</Form.Label>
          <Form.Control as="textarea" rows={5} />
          <Form.Text className="text-muted fst-italic">
            (Describe chronological course of illness, response to treatment, complications, consultations, procedures performed, ICU/HDU stay if
              applicable)
          </Form.Text>
        </Form.Group>
        <p className="small fw-semibold mb-2">Specialist consultations</p>
        <Table bordered responsive size="sm" className="mb-3 ds-band-header ds-band-firstcol">
          <thead>
            <tr>
              <th>Specialty</th>
              <th>Consultant name</th>
              <th>Date</th>
              <th>Key recommendation</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2].map((i) => (
              <tr key={i}>
                <td>
                  <Form.Control size="sm" as="textarea" rows={1} />
                </td>
                <td>
                  <Form.Control size="sm" as="textarea" rows={1} />
                </td>
                <td>
                  <Form.Control size="sm" type="date" />
                </td>
                <td>
                  <Form.Control size="sm" as="textarea" rows={2} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="small fw-semibold mb-2">Surgeries / Procedures Performed</p>
        <Table bordered responsive size="sm" className="mb-3 ds-band-header">
          <thead>
            <tr>
              <th>Procedure name</th>
              <th>Date</th>
              <th>Operating surgeon</th>
              <th>Anaesthesia type</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2].map((i) => (
              <tr key={i}>
                <td>
                  <Form.Control size="sm" as="textarea" rows={1} />
                </td>
                <td>
                  <Form.Control size="sm" type="date" />
                </td>
                <td>
                  <Form.Control size="sm" as="textarea" rows={1} />
                </td>
                <td>
                  <Form.Select size="sm" aria-label="Anaesthesia type">
                    <option value="">Select the anaesthesia type</option>
                    <option>GA</option>
                    <option>SA</option>
                    <option>LA</option>
                    <option>RA</option>
                  </Form.Select>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="small fw-semibold mb-2">Blood Transfusions / Blood Products</p>
        <Table bordered responsive size="sm" className="mb-0">
          <thead className="table-light">
            <tr>
              <th>Product type</th>
              <th>Volume (mL)</th>
              <th>Date</th>
              <th>Units</th>
              <th>Pre/post Hb</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="small">PRBC / FFP / platelets / cryo</td>
              <td>
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
              <td>
                <Form.Control size="sm" type="date" />
              </td>
              <td>
                <Form.Control size="sm" as="textarea" rows={1} />
              </td>
              <td>
                <Form.Control size="sm" as="textarea" rows={1} placeholder="g/dL → g/dL" />
              </td>
            </tr>
          </tbody>
        </Table>
      </SectionCard>

      {/* SECTION 7 */}
      <SectionCard number={7} title="Medication Record">
        <p className="small fw-semibold mb-2">Allergy & Adverse Reaction Alert</p>
        <Alert variant="warning" className="small py-2 mb-3">
          Known allergies / adverse drug reactions — document below (none if not applicable).
        </Alert>
        <Table bordered responsive size="sm" className="mb-3 ds-band-header ds-band-firstcol">
          <thead>
            <tr>
              <th>Allergen / drug</th>
              <th>Type of reaction</th>
              <th>Severity (mild/mod/severe)</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2].map((i) => (
              <tr key={i}>
                <td>
                  <Form.Control size="sm" as="textarea" rows={1} />
                </td>
                <td>
                  <Form.Control size="sm" as="textarea" rows={1} />
                </td>
                <td>
                  <Form.Control size="sm" as="textarea" rows={1} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="small fw-semibold mb-2">Medications on discharge (reconciled list)</p>
        <p className="small text-muted mb-2 fst-italic">(per NHS medicines reconciliation and Joint
          Commission NPSG.03.06.01)
        </p>
        <Table bordered responsive size="sm" className="mb-3 ds-band-header ds-band-firstcol">
          <thead>
            <tr>
              <th style={{ width: '4%' }}>#</th>
              <th>Drug name (generic)</th>
              <th>Dose</th>
              <th>Route</th>
              <th>Freq.</th>
              <th>Duration</th>
              <th>Special instructions</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
              <tr key={n}>
                <td className="small align-middle">{n}.</td>
                <td>
                  <Form.Control size="sm" as="textarea" rows={1} />
                </td>
                <td>
                  <Form.Control size="sm" as="textarea" rows={1} />
                </td>
                <td>
                  <Form.Control size="sm" as="textarea" rows={1} />
                </td>
                <td>
                  <Form.Control size="sm" as="textarea" rows={1} />
                </td>
                <td>
                  <Form.Control size="sm" as="textarea" rows={1} />
                </td>
                <td>
                  <Form.Control size="sm" as="textarea" rows={1} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Form.Group>
          <Form.Label className="small fw-semibold">
            Medications stopped / changed (with reason)
          </Form.Label>
          <Form.Control as="textarea" rows={2} />
        </Form.Group>
      </SectionCard>

      {/* SECTION 8 */}
      <SectionCard number={8} title="Condition at Discharge & Functional Status">
        <Row className="g-3 mb-3">
          <Col md={4}>
            <Form.Label className="small fw-semibold">General condition</Form.Label>
            <Form.Select aria-label="General condition">
              <option value="">Select the general condition</option>
              <option>Stable</option>
              <option>Improving</option>
              <option>Critical</option>
            </Form.Select>
          </Col>
          <Col md={4}>
            <Form.Label className="small fw-semibold">Vital signs at discharge</Form.Label>
            <Form.Control as="textarea" rows={2} placeholder="BP / HR / SpO₂" />
          </Col>
          <Col md={4}>
            <Form.Label className="small fw-semibold">Wound / drain status</Form.Label>
            <Form.Control as="textarea" rows={2} placeholder="Healed / healing / open / drain in situ" />
          </Col>
        </Row>
        <p className="small fw-semibold mb-2">Functional &amp; nutritional status</p>
        <Row className="g-3">
          <Col md={3}>
            <Form.Label className="small">Mobility status</Form.Label>
            <Form.Select size="sm" aria-label="Mobility status">
              <option value="">Select the mobility status</option>
              <option>Ambulatory</option>
              <option>Assisted</option>
              <option>Bedbound</option>
            </Form.Select>
          </Col>
          <Col md={3}>
            <Form.Label className="small">Diet / nutrition</Form.Label>
            <Form.Control size="sm" as="textarea" rows={1} placeholder="Oral / NG / TPN / modified" />
          </Col>
          <Col md={3}>
            <Form.Label className="small">Continence</Form.Label>
            <Form.Control size="sm" as="textarea" rows={1} placeholder="Continent / incontinent" />
          </Col>
          <Col md={3}>
            <Form.Label className="small">Cognition (MMSE)</Form.Label>
            <Form.Control size="sm" placeholder="/30" type="number" />
          </Col>
        </Row>
      </SectionCard>

      {/* SECTION 9 */}
      <SectionCard number={9} title="Discharge Instructions & Follow-Up Plan">
        <p className="small fw-semibold mb-2">Patient &amp; Caregiver Education (Per NHS &amp; NIH Standards)</p>
        <div className="mb-3 border rounded overflow-hidden">
          {[
            'Diagnosis explanation and prognosis communicated to patient/guardian',
            'Written discharge instructions provided',
            'Medication counselling completed (dose, timing, side effects, adherence)',
            'Warning signs / red flags explained (when to seek emergency care)',
            'Dietary and lifestyle modifications discussed',
            'Wound care / dressing instructions given',
          ].map((label, idx) => (
            <div key={label} className={`small px-3 py-2 ${idx < 5 ? 'border-bottom' : ''}`}>
              <div className="d-flex align-items-center gap-2 flex-wrap w-100">
                <span className="text-muted flex-shrink-0">{idx + 1}.</span>
                {idx === 1 ? (
                  <>
                    <div className="d-flex align-items-center gap-2 flex-wrap min-w-0">
                      <span>{label}</span>
                      <Form.Control
                        size="sm"
                        as="textarea"
                        rows={1}
                        className="flex-shrink-0"
                        style={{ maxWidth: '200px', width: '9.5rem' }}
                        placeholder="Language"
                        aria-label="Language of written discharge instructions"
                      />
                    </div>
                    <div className="d-flex align-items-center gap-2 ms-auto flex-shrink-0">
                      <Form.Check type="radio" name={`edu-${idx}`} label="Yes" inline />
                      <Form.Check type="radio" name={`edu-${idx}`} label="No" inline />
                    </div>
                  </>
                ) : (
                  <>
                    <span className="flex-grow-1">{label}</span>
                    <Form.Check type="radio" name={`edu-${idx}`} label="Yes" inline />
                    <Form.Check type="radio" name={`edu-${idx}`} label="No" inline />
                    {idx === 5 && (
                      <Form.Check type="radio" name={`edu-${idx}`} label="N.A." inline />
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <Form.Group className="mb-3">
          <Form.Label className="small fw-semibold">Activity &amp; Dietary Restrictions</Form.Label>
          <Form.Control as="textarea" rows={3} />
        </Form.Group>
        <p className="small fw-semibold mb-2">Follow-up appointments</p>
        <Table bordered responsive size="sm" className="mb-3 ds-band-header">
          <thead>
            <tr>
              <th>Department / clinic</th>
              <th>Physician</th>
              <th style={{ width: '16%' }}>Date &amp; time</th>
              <th>Purpose / tests pending</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3].map((i) => (
              <tr key={i}>
                <td>
                  <Form.Control
                    size="sm"
                    as="textarea"
                    rows={1}
                    aria-label={`Follow-up row ${i} department or clinic`}
                  />
                </td>
                <td>
                  <Form.Control
                    size="sm"
                    as="textarea"
                    rows={1}
                    aria-label={`Follow-up row ${i} physician`}
                  />
                </td>
                <td>
                  <Form.Control size="sm" type="datetime-local" aria-label={`Follow-up row ${i} date and time`} />
                </td>
                <td>
                  <Form.Control size="sm" as="textarea" rows={2} aria-label={`Follow-up row ${i} purpose or tests pending`} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="small fw-semibold mb-2">Referrals &amp; Community Services</p>
        <Table bordered responsive size="sm" className="mb-3">
          <thead className="table-light">
            <tr>
              <th>Service / agency</th>
              <th>Contact / number</th>
              <th>Reason for referral</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Physiotherapy / Rehab', 'Post-procedure / Mobility'],
              ['Social Worker / Palliative', ''],
              ['Community Nursing / Home Health', ''],
            ].map(([svc, hint]) => (
              <tr key={svc}>
                <td className="small align-middle">{svc}</td>
                <td>
                  <Form.Control
                    size="sm"
                    as="textarea"
                    rows={1}
                    aria-label={`${svc} contact or number`}
                  />
                </td>
                <td>
                  <Form.Control
                    size="sm"
                    as="textarea"
                    rows={1}
                    placeholder={hint || undefined}
                    aria-label={`${svc} reason for referral`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Form.Group className="mb-0">
          <Form.Label className="small fw-semibold">Tests / Reports Pending at Discharge</Form.Label>
          <Form.Control as="textarea" rows={3} />
        </Form.Group>
      </SectionCard>

      {/* SECTION 10 */}
      <SectionCard number={10} title="Infection Prevention & Control (CDC Compliance)">
        <p className="small text-muted mb-2 fst-italic">
          Per CDC Healthcare-Associated Infection (HAI) Prevention and NHSN Reporting Guidelines:
        </p>
        <Table bordered responsive size="sm" className="mb-0 ds-band-header ds-band-firstcol">
          <thead>
            <tr>
              <th style={{ width: '48%' }}>IPC parameter</th>
              <th style={{ width: '20%' }}>Status</th>
              <th style={{ width: '14%' }}>Date initiated</th>
              <th style={{ width: '14%' }}>Date discontinued</th>
            </tr>
          </thead>
          <tbody>
            {IPC_ROWS.map((row) => (
              <tr key={row.id}>
                <td className="small">{row.label}</td>
                <td>
                  <IpcStatusCell row={row} />
                </td>
                <td>
                  <Form.Control size="sm" type="date" aria-label={`${row.label} date initiated`} />
                </td>
                {row.dateDiscontinued === 'emDash' ? (
                  <td
                    className="align-middle text-muted small text-center"
                    aria-label="Date discontinued not applicable"
                  >
                    —
                  </td>
                ) : (
                  <td className="align-middle">
                    <Form.Control size="sm" type="date" aria-label={`${row.label} date discontinued`} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      </SectionCard>

      {/* SECTION 11 */}
      <SectionCard number={11} title="Quality Indicators & Patient Safety (Joint Commission / NIH)">
        <Table bordered responsive size="sm" className="mb-3">
          <thead className="table-light">
            <tr>
              <th>Quality / safety parameter</th>
              <th style={{ width: '18%' }}>Applicable</th>
              <th style={{ width: '18%' }}>Complied</th>
            </tr>
          </thead>
          <tbody>
            {QUALITY_SAFETY_ROWS.map((row) => (
              <tr key={row.id}>
                <td className="small">{row.label}</td>
                <td>
                  <Form.Select size="sm" aria-label={`${row.label} applicable`}>
                    <option value="">Select</option>
                    <option>Yes</option>
                    <option>No</option>
                  </Form.Select>
                </td>
                <td>
                  <QualityCompliedCell row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="small fw-semibold mb-2">Advance Directives / DNAR Status</p>
        <Row className="g-3 align-items-end">
          <Col md={4} lg={3}>
            <Form.Label className="small mb-1">Advance directive on file</Form.Label>
            <Form.Select size="sm" aria-label="Advance directive on file">
              <option value="">Select</option>
              <option>Yes</option>
              <option>No</option>
            </Form.Select>
          </Col>
          <Col md={4} lg={3}>
            <Form.Label className="small mb-1">DNAR order</Form.Label>
            <Form.Select size="sm" aria-label="DNAR order">
              <option value="">Select</option>
              <option>Active</option>
              <option>Not Active</option>
              <option>N.A.</option>
            </Form.Select>
          </Col>
          <Col md={4} lg={6}>
            <Form.Label className="small mb-1">Surrogate decision maker</Form.Label>
            <Form.Control size="sm" as="textarea" rows={2} aria-label="Surrogate decision maker" />
          </Col>
        </Row>
      </SectionCard>

      {/* SECTION 12 */}
      <SectionCard number={12} title="Authorisation & Signatures">
        <Row className="g-0 ds-section12-grid">
          <Col md={6} className="ds-section12-cell ds-section12-left">
            <h6 className="small fw-bold text-uppercase border-bottom pb-1 mb-5">
              Discharging physician
            </h6>
            <div className="ds-section12-line">
              <span className="ds-section12-line-label">Name: Dr.</span>
              <Form.Control className="ds-section12-line-input" type="text" />
            </div>
            <div className="ds-section12-line">
              <span className="ds-section12-line-label">Reg. no.:</span>
              <Form.Control className="ds-section12-line-input" type="text" />
            </div>
            <div className="ds-section12-line">
              <span className="ds-section12-line-label">Department:</span>
              <Form.Control className="ds-section12-line-input" type="text" />
            </div>
            <div className="ds-section12-line">
              <span className="ds-section12-line-label">Signature:</span>
              <Form.Control className="ds-section12-line-input" type="text" />
            </div>
            <div className="ds-section12-line">
              <span className="ds-section12-line-label">Date &amp; time:</span>
              <Form.Control className="ds-section12-line-input" type="text" placeholder="DD/MM/YYYY HH:MM" />
            </div>
          </Col>
          <Col md={6} className="ds-section12-cell ds-section12-right-highlight">
            <h6 className="small fw-bold text-uppercase border-bottom pb-1 mb-3">
              Patient / legal guardian acknowledgement
            </h6>
            <p className="small text-muted mb-3">
              I confirm receipt of discharge instructions, medications list, and follow-up schedule.
            </p>
            <div className="ds-section12-line">
              <span className="ds-section12-line-label">Name:</span>
              <Form.Control className="ds-section12-line-input" type="text" />
            </div>
            <div className="ds-section12-line">
              <span className="ds-section12-line-label">Relationship to patient:</span>
              <Form.Control className="ds-section12-line-input" type="text" />
            </div>
            <div className="ds-section12-line">
              <span className="ds-section12-line-label">Signature:</span>
              <Form.Control className="ds-section12-line-input" type="text" />
            </div>
            <div className="ds-section12-line">
              <span className="ds-section12-line-label">Date &amp; time:</span>
              <Form.Control className="ds-section12-line-input" type="text" placeholder="DD/MM/YYYY HH:MM" />
            </div>
          </Col>
          <Col md={6} className="ds-section12-cell ds-section12-left">
            <h6 className="small fw-bold text-uppercase border-bottom pb-1 mb-3">
              Senior resident / registrar review
            </h6>
            <div className="ds-section12-line">
              <span className="ds-section12-line-label">Name: Dr.</span>
              <Form.Control className="ds-section12-line-input" type="text" />
            </div>
            <div className="ds-section12-line">
              <span className="ds-section12-line-label">Signature:</span>
              <Form.Control className="ds-section12-line-input" type="text" />
            </div>
            <div className="ds-section12-line">
              <span className="ds-section12-line-label">Date:</span>
              <Form.Control className="ds-section12-line-input" type="text" placeholder="DD/MM/YYYY" />
            </div>
          </Col>
          <Col md={6} className="ds-section12-cell ds-section12-right">
            <h6 className="small fw-bold text-uppercase border-bottom pb-1 mb-3">
              Nursing in-charge sign-off
            </h6>
            <div className="ds-section12-line">
              <span className="ds-section12-line-label">Name:</span>
              <Form.Control className="ds-section12-line-input" type="text" />
            </div>
            <div className="ds-section12-line">
              <span className="ds-section12-line-label">Signature:</span>
              <Form.Control className="ds-section12-line-input" type="text" />
            </div>
            <div className="ds-section12-line">
              <span className="ds-section12-line-label">Date:</span>
              <Form.Control className="ds-section12-line-input" type="text" placeholder="DD/MM/YYYY" />
            </div>
          </Col>
        </Row>
      </SectionCard>

      {/* SECTION 13 */}
      <SectionCard number={13} title="Administrative & Records Management">
        <Table bordered responsive size="sm" className="mb-0 ds-band-header ds-band-firstcol">
          <thead className="table-light">
            <tr>
              <th>Document / record</th>
              <th style={{ width: '22%' }}>Completed</th>
              <th style={{ width: '28%' }}>Filed / submitted</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Discharge summary sent to GP / referring doctor', 'date'],
              ['Copy given to patient / guardian', 'date'],
              ['Electronic health record (EHR) updated', 'time'],
              ['Medical records coded (ICD-10 / DRG)', 'coder'],
              ['Insurance pre-authorization / final claim submitted', 'ref'],
              ['Mortality / morbidity review flagged', 'mm'],
              ['Organ / tissue donation documentation  (if applicable)', 'date']
            ].map(([label, kind]) => (
              <tr key={label}>
                <td className="small">{label}</td>
                <td>
                  <div className="d-flex gap-2 align-items-center">
                    <Form.Select size="sm" aria-label={`${label} completed`}>
                      <option value="">Select the completed response</option>
                      <option>Yes</option>
                      <option>No</option>
                      <option>N.A.</option>
                    </Form.Select>
                  </div>
                </td>
                <td>
                  {kind === 'date' && <Form.Control size="sm" type="date" />}
                  {kind === 'time' && <Form.Control size="sm" type="time" />}
                  {kind === 'coder' && (
                    <Form.Control size="sm" as="textarea" rows={1} placeholder="Coder" />
                  )}
                  {kind === 'ref' && (
                    <Form.Control size="sm" as="textarea" rows={1} placeholder="Ref. no." />
                  )}
                  {kind === 'mm' && (
                    <Form.Control size="sm" as="textarea" rows={1} placeholder="M&amp;M date" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </SectionCard>

      {/* Regulatory footer */}
      <Card className="ds-regulatory-card mt-4 border-0 text-center">
        <Card.Body className="small text-muted">
          <h5 className="fw-semibold text-body mb-2 text-uppercase">Regulatory Compliance Declaration</h5>
          <p className="mb-2 fw-semibold fst-italic">
          This document complies with: CDC NHSN Surveillance Standards (2024)  |  NHS England Discharge Planning Guidelines (2023)  |  NIH Clinical Documentation Best Practices  |  ICD-10-CM/PCS (FY2025 Edition)  |  Joint Commission NPSG Requirements

          </p>
          <p className="mb-0">
            Data privacy: processed under applicable patient data protection law (HIPAA / GDPR /
            DPDPA 2023 as applicable). Retention: 7 years minimum.
          </p>
        </Card.Body>
      </Card>
        </Container>
      </div>

      <Container
        fluid
        className="d-print-none pb-5 px-3"
        style={{ maxWidth: '1200px' }}
      >
        <div className="ds-action-bar py-4 px-4 text-center">
          <div className="d-flex flex-wrap gap-2 justify-content-center mb-2">
            <Button variant="secondary" size="lg" type="button" onClick={handleFillDummyData}>
              Fill sample (demo) data
            </Button>
            <Button variant="primary" size="lg" type="button" onClick={handlePrint}>
              Print
            </Button>
            <Button variant="outline-primary" size="lg" type="button" onClick={handleDownloadPdf}>
              Download PDF
            </Button>
          </div>
          <span className="text-muted small text-center text-md-start" style={{ maxWidth: '28rem' }}>
            Download PDF applies the same layout rules as print (full-width grid, field borders, white
            background). You can also use Print → Save as PDF for a browser-native copy.
          </span>
        </div>
      </Container>
    </div>
  );
}
