import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Container, Form, Pagination, Spinner, Table } from 'react-bootstrap';
import { fetchPatientRecords } from './api.js';
import './PatientRecordsPage.css';

const PAGE_SIZE = 20;

function clip(text, max = 48) {
  if (text == null || text === '') return '—';
  const s = String(text);
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD');
}

/** Quick search across common columns (substring match). */
function recordMatchesQuery(r, q) {
  const needle = normalize(q).trim();
  if (!needle) return true;
  const hay = normalize(
    [
      r.discharge_id,
      r.patient_id,
      r.name,
      r.mrn,
      r.dob,
      r.age,
      r.gender,
      r.aadhaar,
      r.address,
      r.emergency_contact_name,
      r.emergency_contact_phone,
      r.created_at,
    ].join(' ')
  );
  return hay.includes(needle);
}

export default function PatientRecordsPage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchPatientRecords();
      setRecords(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e.message || String(e));
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const filtered = useMemo(() => records.filter((r) => recordMatchesQuery(r, search)), [records, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageSlice = useMemo(() => {
    const p = Math.min(Math.max(1, page), totalPages);
    const start = (p - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page, totalPages]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const startIdx = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const endIdx = filtered.length === 0 ? 0 : Math.min(safePage * PAGE_SIZE, filtered.length);

  const handleView = (dischargeId) => {
    navigate(`/?discharge=${dischargeId}`);
  };

  return (
    <div className="ds-records-page">
      <header className="ds-records-page__header" role="banner">
        <div className="ds-records-page__header-inner">
          <div className="ds-records-page__title-block">
            <div className="ds-records-page__title-row">
              <Link to="/" className="ds-records-page__nav-back">
                <span className="ds-records-page__nav-back-icon" aria-hidden="true">
                  ‹
                </span>
                Back
              </Link>
              <div>
                <h1 className="ds-records-page__title">Patient records</h1>
                <p className="ds-records-page__subtitle mb-0">
                  Search and open a discharge summary. {filtered.length} match{filtered.length === 1 ? '' : 'es'}
                  {search.trim() ? ` (of ${records.length} total)` : ''}.
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <Container fluid className="ds-records-page__body py-4 px-3">
        {error && (
          <div className="alert alert-danger ds-records-page__alert" role="alert">
            {error}
          </div>
        )}

        <div className="ds-records-page__toolbar">
          <Form.Label htmlFor="ds-records-search" className="visually-hidden">
            Search records
          </Form.Label>
          <div className="ds-records-page__search-wrap">
            <span className="ds-records-page__search-icon" aria-hidden="true">
              <svg className="ds-records-page__search-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M15.2 15.2 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <Form.Control
              id="ds-records-search"
              type="search"
              placeholder="Search name, MRN, ID, phone…"
              title="Search by name, MRN, discharge ID, patient ID, phone, address, and more"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
              className="ds-records-page__search"
            />
          </div>
          <div className="ds-records-page__meta">
            {filtered.length > 0 ? (
              <span>
                Showing <strong>{startIdx}</strong>–<strong>{endIdx}</strong> of <strong>{filtered.length}</strong>
              </span>
            ) : (
              <span className="text-muted">No rows match your search.</span>
            )}
          </div>
        </div>

        {loading && records.length === 0 ? (
          <div className="ds-records-page__loading text-center py-5">
            <Spinner animation="border" role="status" className="ds-records-page__spinner" />
            <p className="mt-3 mb-0 text-muted">Loading records…</p>
          </div>
        ) : (
          <>
            <div className="ds-records-page__card">
              <div className="ds-records-page__table-scroll">
                <Table responsive className="ds-records-table mb-0">
                  <thead>
                    <tr>
                      {/* HIDDEN: Discharge # — uncomment block below to show column
                      <th scope="col" className="ds-records-col-id">
                        Discharge #
                      </th>
                      */}
                      <th scope="col">Patient ID</th>
                      <th scope="col">Name</th>
                      <th scope="col">MRN</th>
                      {/* HIDDEN: DOB — uncomment block below to show column
                      <th scope="col">DOB</th>
                      */}
                      <th scope="col">Age</th>
                      <th scope="col">Gender</th>
                      <th scope="col">Aadhaar</th>
                      <th scope="col">Address</th>
                      <th scope="col">Emergency name</th>
                      <th scope="col">Emergency phone</th>
                      <th scope="col">Created</th>
                      <th scope="col" className="ds-records-col-action text-end">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageSlice.map((r) => (
                      <tr key={`${r.discharge_id}-${r.patient_id}`}>
                        {/* HIDDEN: Discharge # — uncomment to match thead
                        <td className="ds-records-cell-id">{r.discharge_id}</td>
                        */}
                        <td>{r.patient_id}</td>
                        <td className="ds-records-cell-name">{clip(r.name, 32)}</td>
                        <td className="text-nowrap">
                          <span className="ds-records-mrn">{r.mrn}</span>
                        </td>
                        {/* HIDDEN: DOB — uncomment to match thead
                        <td className="text-nowrap small">{r.dob ? String(r.dob).slice(0, 10) : '—'}</td>
                        */}
                        <td>{r.age}</td>
                        <td>{r.gender}</td>
                        <td className="small text-muted">{r.aadhaar ?? '—'}</td>
                        <td className="ds-records-address" title={r.address || ''}>
                          {clip(r.address, 40)}
                        </td>
                        <td className="small">{clip(r.emergency_contact_name, 24)}</td>
                        <td className="text-nowrap small">{r.emergency_contact_phone ?? '—'}</td>
                        <td className="text-nowrap small text-muted">
                          {r.created_at ? String(r.created_at).replace('T', ' ').slice(0, 19) : '—'}
                        </td>
                        <td className="text-end text-nowrap">
                          <Button
                            type="button"
                            className="ds-records-btn-view"
                            onClick={() => handleView(r.discharge_id)}
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </div>

            {!loading && filtered.length === 0 && (
              <p className="text-center text-muted py-5 mb-0 ds-records-page__empty">No discharge records found.</p>
            )}

            {totalPages > 1 && (
              <div className="ds-records-page__pagination-wrap">
                <Pagination className="ds-records-pagination mb-0 flex-wrap justify-content-center">
                  <Pagination.First disabled={safePage <= 1} onClick={() => setPage(1)} />
                  <Pagination.Prev disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} />
                  <Pagination.Next
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  />
                  <Pagination.Last disabled={safePage >= totalPages} onClick={() => setPage(totalPages)} />
                </Pagination>
                <span className="ds-records-page__page-label">
                  Page {safePage} of {totalPages}
                </span>
              </div>
            )}
          </>
        )}
      </Container>
    </div>
  );
}
