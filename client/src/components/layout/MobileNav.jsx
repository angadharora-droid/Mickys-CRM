import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Contact, Plus, Menu } from 'lucide-react';

/**
 * Mobile-first bottom tab bar — shown only on phones / small tablets
 * (hidden from `lg` up where the persistent sidebar takes over).
 * Four evenly-weighted tabs; "New" is the accented primary action and
 * "Menu" opens the full navigation drawer for the remaining routes.
 * Everything stays inside the bar height so nothing overlaps page content.
 */
const tabClass = ({ isActive }) =>
  cn(
    'flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
  );

export default function MobileNav({ onMenuClick }) {
  const navigate = useNavigate();

  return (
    <nav className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-md shadow-nav pb-safe">
      <div className="grid grid-cols-4 h-16">
        <NavLink to="/" end className={tabClass}>
          {({ isActive }) => (
            <>
              <span className="flex h-7 items-center">
                <LayoutDashboard className={cn('h-[22px] w-[22px]', isActive && 'stroke-[2.4]')} />
              </span>
              Home
            </>
          )}
        </NavLink>

        <NavLink to="/leads" className={tabClass}>
          {({ isActive }) => (
            <>
              <span className="flex h-7 items-center">
                <Contact className={cn('h-[22px] w-[22px]', isActive && 'stroke-[2.4]')} />
              </span>
              Leads
            </>
          )}
        </NavLink>

        <button
          type="button"
          onClick={() => navigate('/leads/new')}
          className="flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          aria-label="New lead"
        >
          <span className="flex h-7 items-center">
            <Plus className="h-[22px] w-[22px]" />
          </span>
          New
        </button>

        <button
          type="button"
          onClick={onMenuClick}
          className="flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Open menu"
        >
          <span className="flex h-7 items-center">
            <Menu className="h-[22px] w-[22px]" />
          </span>
          Menu
        </button>
      </div>
    </nav>
  );
}
