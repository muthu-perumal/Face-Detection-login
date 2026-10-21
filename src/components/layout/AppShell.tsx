import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { CalendarDays, ClipboardList, ChevronDown, LayoutDashboard, LogOut, Shield, UserRound } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/cn';

const items = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/attendance', label: 'Attendance', icon: ClipboardList },
  { to: '/history', label: 'History', icon: CalendarDays },
  { to: '/profile', label: 'Profile', icon: UserRound },
];

export function AppShell() {
  const { user, signOut } = useAuth();
  return (
    <div className="min-h-screen md:grid md:grid-cols-[248px_1fr]">
      <aside className="hidden bg-ink-950 text-white md:flex md:flex-col">
        <div className="px-5 py-6">
          <Brand />
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {items.map((item) => (
            <SideLink key={item.to} {...item} />
          ))}
          {user?.role === 'admin' ? <SideLink to="/admin" label="Admin" icon={Shield} /> : null}
        </nav>
        <div className="border-t border-white/10 p-4">
          <p className="truncate text-sm font-medium">{user?.fullName}</p>
          <p className="truncate text-xs text-white/60">{user?.employeeId}</p>
          <button className="mt-3 inline-flex items-center gap-2 text-sm text-white/80 hover:text-white" onClick={() => void signOut()}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-mist/90 px-4 py-3 backdrop-blur md:px-8">
          <div className="md:hidden">
            <Brand dark />
          </div>
          <p className="hidden text-sm text-ink-700 md:block">{user?.department} · {user?.designation}</p>
          <UserMenu />
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 pb-32 pt-4 md:px-8 md:pb-10 md:pt-6 [&_button]:scroll-mb-28">
          <Outlet />
        </main>
      </div>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-[60] grid grid-cols-4 border-t border-line bg-white md:hidden">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => cn('flex flex-col items-center gap-1 py-2 text-[11px] font-medium', isActive ? 'text-pine-800' : 'text-ink-700')}
          >
            <item.icon size={20} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function SideLink({ to, label, icon: Icon, end }: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium', isActive ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white')}
    >
      <Icon size={18} /> {label}
    </NavLink>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const initials = user.fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || user.employeeId.slice(0, 2).toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        className="flex min-h-11 items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-white"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        {user.avatarData ? (
          <img src={user.avatarData} alt="" className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <span className="grid h-9 w-9 place-items-center rounded-full bg-pine-800 text-xs font-semibold text-white">{initials}</span>
        )}
        <span className="hidden max-w-[10rem] truncate text-left text-sm font-medium text-ink-950 sm:block">{user.fullName}</span>
        <ChevronDown size={16} className="text-ink-700" />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-line bg-white p-3 shadow-card">
          <div className="border-b border-line pb-3">
            <p className="truncate font-semibold text-ink-950">{user.fullName}</p>
            <p className="truncate text-sm text-ink-700">{user.email}</p>
            <p className="mt-1 text-sm text-ink-700">{user.employeeId} · {user.role}</p>
            <p className="text-sm text-ink-700">{user.department} · {user.designation}</p>
          </div>
          <NavLink
            to="/profile"
            role="menuitem"
            className="mt-2 flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-ink-900 hover:bg-mist"
            onClick={() => setOpen(false)}
          >
            <UserRound size={16} /> Profile
          </NavLink>
          {user.role === 'admin' ? (
            <NavLink
              to="/admin"
              role="menuitem"
              className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-ink-900 hover:bg-mist"
              onClick={() => setOpen(false)}
            >
              <Shield size={16} /> Admin
            </NavLink>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
            onClick={() => void signOut()}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('grid h-9 w-9 place-items-center rounded-xl', dark ? 'bg-pine-800 text-white' : 'bg-white text-pine-800')}>
        <span className="h-4 w-4 rounded-full border-2 border-current" />
      </span>
      <span>
        <span className={cn('block text-sm font-semibold leading-none', dark ? 'text-ink-950' : 'text-white')}>Attendance</span>
        <span className={cn('text-xs', dark ? 'text-ink-700' : 'text-white/60')}>Workplace</span>
      </span>
    </div>
  );
}
