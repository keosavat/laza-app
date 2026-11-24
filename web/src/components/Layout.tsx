import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  LayoutDashboard, Armchair, ShoppingBag, ChefHat, Receipt, Wallet, UtensilsCrossed, LayoutGrid, Users, Settings, LogOut, Menu as MenuIcon, X, Printer, AlertTriangle, Boxes, ScrollText, Tag, HandCoins, FileBarChart, Contact, CalendarClock, Truck, Beer, Store, Smartphone,
} from 'lucide-react';
import { useSession } from '../lib/store';
import { can, ROLE_LABEL, type Perm } from '../lib/format';
import { cx } from './ui';
import QrAlerts from './QrAlerts';
import OfflineBar from './OfflineBar';
import { get } from '../lib/api';
import { useSync } from '../lib/store';
import { useLoad } from './ui';

const NAV: { to: string; label: string; icon: typeof LayoutDashboard; perm: Perm; group?: string }[] = [
  { to: '/owner', label: 'ແອັບເຈົ້າຂອງ', icon: Smartphone, perm: 'owner' },
  { to: '/', label: 'ພາບລວມ', icon: LayoutDashboard, perm: 'reports' },
  { to: '/tables', label: 'ໂຕະ', icon: Armchair, perm: 'pos' },
  { to: '/reservations', label: 'ຈອງໂຕະ', icon: CalendarClock, perm: 'pos' },
  { to: '/deposits', label: 'ມັດຈຳ / ຝາກເບຍ', icon: Beer, perm: 'pos' },
  { to: '/takeaway', label: 'ຂາຍໜ້າຮ້ານ / ກັບບ້ານ', icon: ShoppingBag, perm: 'pos' },
  { to: '/kitchen', label: 'ຄົວ', icon: ChefHat, perm: 'kitchen' },
  { to: '/orders', label: 'ປະຫວັດບິນ', icon: Receipt, perm: 'reports' },
  { to: '/transactions', label: 'ລາຍງານທຸລະກຳ', icon: FileBarChart, perm: 'reports' },
  { to: '/customers', label: 'ລູກຄ້າ (CRM)', icon: Contact, perm: 'pay' },
  { to: '/debts', label: 'ລູກໜີ້', icon: HandCoins, perm: 'pay' },
  { to: '/shift', label: 'ກະ ແລະ ລິ້ນຊັກເງິນ', icon: Wallet, perm: 'shift' },
  { to: '/menu', label: 'ເມນູອາຫານ', icon: UtensilsCrossed, perm: 'admin', group: 'ຈັດການ' },
  { to: '/floor', label: 'ຈັດການໂຕະ', icon: LayoutGrid, perm: 'admin' },
  { to: '/staff', label: 'ພະນັກງານ', icon: Users, perm: 'admin' },
  { to: '/inventory', label: 'ສະຕັອກ', icon: Boxes, perm: 'admin' },
  { to: '/branches', label: 'ຫຼາຍສາຂາ', icon: Store, perm: 'owner' },
  { to: '/purchasing', label: 'ຈັດຊື້ / ຜູ້ສະໜອງ', icon: Truck, perm: 'admin' },
  { to: '/printers', label: 'ເຄື່ອງພິມ', icon: Printer, perm: 'admin' },
  { to: '/promotions', label: 'ໂປຣໂມຊັນ', icon: Tag, perm: 'admin' },
  { to: '/audit', label: 'ປະຫວັດການກະທຳ', icon: ScrollText, perm: 'admin' },
  { to: '/settings', label: 'ຕັ້ງຄ່າ', icon: Settings, perm: 'admin' },
];

export default function Layout() {
  const { user, restaurant, branch, shift, logout } = useSession();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const items = NAV.filter((n) => can(user?.role, n.perm));

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 py-4">
        <img src="/laza.svg" alt="" className="size-10" />
        <div className="min-w-0">
          <div className="truncate font-bold text-white">{restaurant?.name ?? 'LAZA app'}</div>
          {user?.role === 'owner' ? (
            <button onClick={() => nav('/branches')} title="ປ່ຽນ/ຈັດການສາຂາ" className="block max-w-full truncate text-left text-xs text-slate-400 hover:text-white">{branch?.name} ▾</button>
          ) : (
            <div className="truncate text-xs text-slate-400">{branch?.name}</div>
          )}
        </div>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2">
        {items.map((n, i) => (
          <div key={n.to}>
            {n.group && i > 0 && <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{n.group}</div>}
            <NavLink
              to={n.to}
              end={n.to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm', isActive ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white')
              }
            >
              <n.icon className="size-4.5 shrink-0" />
              {n.label}
            </NavLink>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-800 p-3">
        <PrintAlert onOpen={() => nav('/printers')} canOpen={can(user?.role, 'admin')} />
        <button
          onClick={() => nav('/shift')}
          className={cx('mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs', shift ? 'bg-emerald-900/50 text-emerald-300' : 'bg-amber-900/40 text-amber-300')}
        >
          <span className={cx('size-2 rounded-full', shift ? 'bg-emerald-400' : 'bg-amber-400')} />
          {shift ? 'ກະເປີດຢູ່' : 'ຍັງບໍ່ໄດ້ເປີດກະ'}
        </button>
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="min-w-0">
            <div className="truncate text-sm text-white">{user?.name}</div>
            <div className="text-xs text-slate-400">{user && ROLE_LABEL[user.role]}</div>
          </div>
          <button onClick={logout} title="ອອກຈາກລະບົບ" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 bg-slate-900 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/50" />
          <aside className="absolute inset-y-0 left-0 w-64 bg-slate-900" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded p-1 text-slate-600" aria-label="ເມນູ">
            {open ? <X className="size-5" /> : <MenuIcon className="size-5" />}
          </button>
          <span className="font-bold text-brand-700">LAZA app</span>
        </header>
        <OfflineBar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
        <QrAlerts />
      </div>
    </div>
  );
}

/** Red chip when a printer is failing or tickets could not be printed. */
function PrintAlert({ onOpen, canOpen }: { onOpen: () => void; canOpen: boolean }) {
  const role = useSession((s) => s.user?.role);
  const [s, reload] = useLoad(
    () => (can(role, 'kitchen') ? get<{ failed: number; problems: { id: number; name: string }[] }>('/print/status') : Promise.resolve({ failed: 0, problems: [] })),
    [role],
  );
  useSync(['print'], reload);
  if (!s || (!s.failed && !s.problems.length)) return null;
  const text = s.problems.length ? `ເຄື່ອງພິມ ${s.problems.map((p) => p.name).join(', ')} ມີບັນຫາ` : `ພິມບໍ່ສຳເລັດ ${s.failed} ງານ`;
  return (
    <button onClick={canOpen ? onOpen : undefined} className="mb-2 flex w-full items-center gap-2 rounded-lg bg-rose-900/60 px-3 py-2 text-left text-xs text-rose-200">
      <AlertTriangle className="size-4 shrink-0" />
      {text}
    </button>
  );
}
