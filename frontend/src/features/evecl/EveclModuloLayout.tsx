import { BarChart3, BookOpen, ClipboardList } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { cn } from '@/lib/utils';

const ENLACES = [
  { to: '/evecl', label: 'Ensayos', icon: ClipboardList, end: true },
  { to: '/evecl/comparar', label: 'Comparar', icon: BarChart3, end: false },
  { to: '/evecl/referencia', label: 'Metodología', icon: BookOpen, end: false },
] as const;

export function EveclModuloLayout() {
  return (
    <div className="space-y-4">
      <nav data-print-control aria-label="Secciones EVECL" className="flex flex-wrap gap-1 rounded-lg border border-brand-c bg-brand-l p-1">
        {ENLACES.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => cn(
              'flex min-h-tap items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-brand-d text-white' : 'text-brand-ink hover:bg-brand-l',
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
