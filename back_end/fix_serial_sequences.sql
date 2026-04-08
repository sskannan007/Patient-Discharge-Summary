-- Run after restoring dump.sql / pg_restore with explicit IDs.
-- Otherwise SERIAL sequences stay low and new INSERTs hit duplicate primary key errors.
-- The FastAPI app also runs this logic automatically on startup (see sync_serial_sequences in app.py).

SELECT setval(pg_get_serial_sequence('patients', 'patient_id'), COALESCE((SELECT MAX(patient_id) FROM patients), 1), true);
SELECT setval(pg_get_serial_sequence('discharge_summaries', 'discharge_id'), COALESCE((SELECT MAX(discharge_id) FROM discharge_summaries), 1), true);
SELECT setval(pg_get_serial_sequence('diagnoses', 'diag_id'), COALESCE((SELECT MAX(diag_id) FROM diagnoses), 1), true);
SELECT setval(pg_get_serial_sequence('lab_results', 'lab_id'), COALESCE((SELECT MAX(lab_id) FROM lab_results), 1), true);
SELECT setval(pg_get_serial_sequence('microbiology', 'micro_id'), COALESCE((SELECT MAX(micro_id) FROM microbiology), 1), true);
SELECT setval(pg_get_serial_sequence('imaging', 'imaging_id'), COALESCE((SELECT MAX(imaging_id) FROM imaging), 1), true);
SELECT setval(pg_get_serial_sequence('consultations', 'consult_id'), COALESCE((SELECT MAX(consult_id) FROM consultations), 1), true);
SELECT setval(pg_get_serial_sequence('procedures_performed', 'proc_id'), COALESCE((SELECT MAX(proc_id) FROM procedures_performed), 1), true);
SELECT setval(pg_get_serial_sequence('medications_discharge', 'med_id'), COALESCE((SELECT MAX(med_id) FROM medications_discharge), 1), true);
SELECT setval(pg_get_serial_sequence('allergies', 'allergy_id'), COALESCE((SELECT MAX(allergy_id) FROM allergies), 1), true);
SELECT setval(pg_get_serial_sequence('follow_up_appointments', 'fu_id'), COALESCE((SELECT MAX(fu_id) FROM follow_up_appointments), 1), true);
SELECT setval(pg_get_serial_sequence('referrals', 'ref_id'), COALESCE((SELECT MAX(ref_id) FROM referrals), 1), true);
