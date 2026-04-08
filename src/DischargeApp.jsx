import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Container } from 'react-bootstrap';
import DischargeSummaryFormCDC from './DischargeSummaryFormCDC.jsx';
import './DischargeAppShell.css';
import { fetchDischarge, saveDischargeFromForm, updateDischargeFromForm } from './api.js';
import { collectDischargeFormInsertPayload } from './collectDischargeFormInsert.js';
import { applyDummyDataToDischargeForm } from './dischargeSummaryDummyData';
import { resizeAllTextareasIn } from './formTextareaAutoResize';

/** True if any discharge form control has non-empty value (screen reader: form started). */
function scanFormHasContent(root) {
  if (!root) return false;
  const fields = root.querySelectorAll(
    'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select'
  );
  for (const el of fields) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      if (el.checked) return true;
      continue;
    }
    const v = el.value != null ? String(el.value).trim() : '';
    if (v.length > 0) return true;
  }
  return false;
}

export default function DischargeApp() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [dischargeId, setDischargeId] = useState('');
  const [apiDocument, setApiDocument] = useState(null);

  const [loadingDoc, setLoadingDoc] = useState(false);
  const [saveDataBusy, setSaveDataBusy] = useState(false);
  const saveDataInFlight = useRef(false);
  const formRef = useRef(null);
  const [formHasContent, setFormHasContent] = useState(false);
  const [error, setError] = useState(null);
  const [saveOk, setSaveOk] = useState(null);

  const loadDischargeById = useCallback(async (id) => {
    const n = Number(id);
    if (!n || Number.isNaN(n)) {
      setError('Invalid discharge.');
      return;
    }
    setDischargeId(String(n));
    setLoadingDoc(true);
    setApiDocument(null);
    setError(null);
    setSaveOk(null);
    try {
      const doc = await fetchDischarge(n);
      setApiDocument(doc);
    } catch (e) {
      setError(e.message || String(e));
      setApiDocument(null);
    } finally {
      setLoadingDoc(false);
    }
  }, []);

  const dischargeFromUrl = searchParams.get('discharge');
  useEffect(() => {
    if (!dischargeFromUrl) return;
    const n = Number(dischargeFromUrl);
    if (!n || Number.isNaN(n)) {
      setSearchParams({}, { replace: true });
      return;
    }
    loadDischargeById(n);
    setSearchParams({}, { replace: true });
  }, [dischargeFromUrl, loadDischargeById, setSearchParams]);

  useEffect(() => {
    let teardown;
    const id = window.setTimeout(() => {
      const root = document.getElementById('discharge-summary-print-area');
      if (!root) return;
      const sync = () => setFormHasContent(scanFormHasContent(root));
      sync();
      root.addEventListener('input', sync, true);
      root.addEventListener('change', sync, true);
      teardown = () => {
        root.removeEventListener('input', sync, true);
        root.removeEventListener('change', sync, true);
      };
    }, 0);
    return () => {
      window.clearTimeout(id);
      teardown?.();
    };
  }, []);

  useEffect(() => {
    if (loadingDoc) return undefined;
    const id = window.setTimeout(() => {
      const root = document.getElementById('discharge-summary-print-area');
      setFormHasContent(scanFormHasContent(root));
    }, 0);
    return () => window.clearTimeout(id);
  }, [loadingDoc, apiDocument]);

  const handleSaveData = async () => {
    const root = document.getElementById('discharge-summary-print-area');
    if (!root) return;
    const payload = collectDischargeFormInsertPayload(root);
    setError(null);
    setSaveOk(null);

    const reqLabels = {
      name: 'Patient name',
      mrn: 'MRN',
      dob: 'Date of birth',
      age: 'Age',
      gender: 'Gender',
      admission_date_time: 'Admission date & time',
      discharge_date_time: 'Discharge date & time',
    };
    const reqKeys = Object.keys(reqLabels);
    const missing = reqKeys.filter((k) => !payload[k] || String(payload[k]).trim() === '');
    if (missing.length) {
      setError(`Please fill: ${missing.map((k) => reqLabels[k]).join(', ')}.`);
      return;
    }

    const mrnVal = String(payload.mrn).trim();
    if (!/\d/.test(mrnVal)) {
      setError('MRN must include digits (e.g. MRN-1001). "MRN-" alone is incomplete — add your new number.');
      return;
    }

    if (saveDataInFlight.current) return;
    saveDataInFlight.current = true;
    setSaveDataBusy(true);
    try {
      const id = Number(dischargeId);
      const isEdit = id > 0 && !Number.isNaN(id) && apiDocument;
      if (isEdit) {
        await updateDischargeFromForm(id, payload);
        setSaveOk(`Updated discharge #${id} in the database.`);
        await loadDischargeById(id);
      } else {
        const { discharge_id } = await saveDischargeFromForm(payload);
        setSaveOk(`Stored in database as discharge #${discharge_id}.`);
        await loadDischargeById(discharge_id);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      saveDataInFlight.current = false;
      setSaveDataBusy(false);
    }
  };

  const handleDemoData = () => {
    const root = document.getElementById('discharge-summary-print-area');
    if (!root) return;
    setApiDocument(null);
    setDischargeId('');
    applyDummyDataToDischargeForm(root);
    resizeAllTextareasIn(root);
    window.requestAnimationFrame(() => setFormHasContent(scanFormHasContent(root)));
  };

  return (
    <>
      <header className="ds-app-command d-print-none" role="banner">
        <div className="ds-app-command__inner">
          <div className="ds-app-command__brand">
            <span className="ds-app-command__title">Discharge Summary</span>
            <span className="ds-app-command__tagline">Clinical records · API workspace</span>
          </div>

          <div className="ds-app-command__panel">
            <div className="ds-app-command__toolbar">
              <div className="ds-app-command__toolbar-group ds-app-command__toolbar-group--workspace">
                <span className="ds-app-command__toolbar-label">Workspace</span>
                <div className="ds-app-command__actions">
                  <button
                    type="button"
                    className="ds-app-command__btn ds-app-command__btn--record"
                    onClick={() => navigate('/records')}
                  >
                    Records
                  </button>
                  <button type="button" className="ds-app-command__btn ds-app-command__btn--demo" onClick={handleDemoData}>
                    Demo data
                  </button>
                </div>
              </div>
              <div className="ds-app-command__toolbar-divider" aria-hidden="true" />
              <div className="ds-app-command__toolbar-group ds-app-command__toolbar-group--document">
                <span className="ds-app-command__toolbar-label">Document</span>
                <div className="ds-app-command__actions">
                  <button
                    type="button"
                    className="ds-app-command__btn ds-app-command__btn--print"
                    onClick={() => formRef.current?.print?.()}
                  >
                    Print
                  </button>
                  <button
                    type="button"
                    className="ds-app-command__btn ds-app-command__btn--pdf"
                    onClick={() => formRef.current?.downloadPdf?.()}
                  >
                    Download PDF
                  </button>
                  <button
                    type="button"
                    className={`ds-app-command__btn ds-app-command__btn--savedata ${
                      saveDataBusy
                        ? 'ds-app-command__btn--savedata-saving'
                        : formHasContent
                          ? 'ds-app-command__btn--savedata-ready'
                          : 'ds-app-command__btn--savedata-idle'
                    }`}
                    onClick={handleSaveData}
                    disabled={saveDataBusy || !formHasContent}
                    title={
                      formHasContent
                        ? 'Save to database'
                        : 'Fill the discharge summary first, then save'
                    }
                  >
                    {saveDataBusy ? (
                      <span className="ds-app-command__spinner" role="status" aria-label="Saving" />
                    ) : null}
                    Save Data
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* <div className="ds-app-command__foot">
            <span className="ds-app-command__hint">
              <strong>Save Data</strong> — create a new patient/discharge, or update the full form when a discharge is
              already open. <strong>Record</strong> — full page list of patients.
            </span>
          </div> */}
        </div>
      </header>

      <Container fluid className="py-2 px-3 ds-app-alerts d-print-none">
        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {saveOk && !error && <Alert variant="success">{saveOk}</Alert>}
      </Container>

      {loadingDoc && (
        <Container fluid className="ds-app-loading-banner d-print-none">
          Loading discharge summary…
        </Container>
      )}

      <DischargeSummaryFormCDC ref={formRef} apiDocument={apiDocument} />
    </>
  );
}
