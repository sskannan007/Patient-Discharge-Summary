import { Routes, Route } from 'react-router-dom';
import DischargeApp from './DischargeApp.jsx';
import PatientRecordsPage from './PatientRecordsPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DischargeApp />} />
      <Route path="/records" element={<PatientRecordsPage />} />
    </Routes>
  );
}
