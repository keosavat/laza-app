import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { useSession } from './lib/store';
import { startConnectivity } from './lib/offline';
import { can, type Perm } from './lib/format';
import { AskHost, Spinner, Toaster } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';
import Customer from './pages/Customer';
import Dashboard from './pages/Dashboard';
import Tables from './pages/Tables';
import OrderScreen from './pages/OrderScreen';
import Takeaway from './pages/Takeaway';
import Kitchen from './pages/Kitchen';
import Orders from './pages/Orders';
import Transactions from './pages/Transactions';
import Customers from './pages/Customers';
import Reservations from './pages/Reservations';
import ShiftPage from './pages/Shift';
import MenuAdmin from './pages/MenuAdmin';
import FloorAdmin from './pages/FloorAdmin';
import Staff from './pages/Staff';
import SettingsPage from './pages/Settings';
import Printers from './pages/Printers';
import Inventory from './pages/Inventory';
import AuditLog from './pages/AuditLog';
import Promotions from './pages/Promotions';
import Debts from './pages/Debts';

function Guard({ perm, children }: { perm: Perm; children: React.ReactElement }) {
  const role = useSession((s) => s.user?.role);
  return can(role, perm) ? children : <Navigate to="/" replace />;
}

function Home() {
  const role = useSession((s) => s.user?.role);
  if (role === 'kitchen') return <Navigate to="/kitchen" replace />;
  if (role === 'waiter') return <Navigate to="/tables" replace />;
  return <Dashboard />;
}

function App() {
  const { user, ready, refresh } = useSession();
  const isCustomer = window.location.pathname.startsWith('/m/');
  useEffect(() => {
    if (!isCustomer) refresh();
  }, [refresh, isCustomer]);
  // Customers scanning a table QR never see the staff app or need to log in.
  if (isCustomer) return <Customer />;
  if (!ready) return <Spinner />;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="tables" element={<Guard perm="pos"><Tables /></Guard>} />
        <Route path="order/:id" element={<Guard perm="pos"><OrderScreen /></Guard>} />
        <Route path="takeaway" element={<Guard perm="pos"><Takeaway /></Guard>} />
        <Route path="kitchen" element={<Guard perm="kitchen"><Kitchen /></Guard>} />
        <Route path="orders" element={<Guard perm="reports"><Orders /></Guard>} />
        <Route path="transactions" element={<Guard perm="reports"><Transactions /></Guard>} />
        <Route path="customers" element={<Guard perm="pay"><Customers /></Guard>} />
        <Route path="reservations" element={<Guard perm="pos"><Reservations /></Guard>} />
        <Route path="shift" element={<Guard perm="shift"><ShiftPage /></Guard>} />
        <Route path="menu" element={<Guard perm="admin"><MenuAdmin /></Guard>} />
        <Route path="floor" element={<Guard perm="admin"><FloorAdmin /></Guard>} />
        <Route path="staff" element={<Guard perm="admin"><Staff /></Guard>} />
        <Route path="settings" element={<Guard perm="admin"><SettingsPage /></Guard>} />
        <Route path="inventory" element={<Guard perm="admin"><Inventory /></Guard>} />
        <Route path="debts" element={<Guard perm="pay"><Debts /></Guard>} />
        <Route path="promotions" element={<Guard perm="admin"><Promotions /></Guard>} />
        <Route path="audit" element={<Guard perm="admin"><AuditLog /></Guard>} />
        <Route path="printers" element={<Guard perm="admin"><Printers /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster />
      <AskHost />
    </BrowserRouter>
  </React.StrictMode>,
);

startConnectivity();
// Service worker (production build only): the app opens and shows its last data even if the server is down for a while.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
