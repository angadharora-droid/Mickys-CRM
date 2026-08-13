import { NavLink } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { cn, getInitials } from '@/lib/utils';
import { ROLE_LABELS } from '@/lib/constants';
import { LayoutDashboard, Boxes, ReceiptText, ArrowLeftRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

/**
 * Sidebar for the Sales Order module — deliberately separate from the main
 * CRM sidebar: this section has its own navigation universe, with a single
 * escape hatch back to the leads CRM.
 */
const NAV_SECTIONS = [
  {
    label: 'Sales Orders',
    items: [
      { to: '/sales', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/sales/stock', label: 'Stock from Tally', icon: Boxes },
      { to: '/sales/orders', label: 'Sales Orders', icon: ReceiptText },
    ],
  },
  {
    label: 'Switch',
    items: [{ to: '/', label: 'Back to Leads CRM', icon: ArrowLeftRight, end: true }],
  },
];

export default function SalesSidebar({ open, onClose }) {
  const { user } = useAuth();

  return (
    <>
      {/* Mobile overlay */}
      {open && <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" onClick={onClose} />}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-[17rem] max-w-[82%] bg-sidebar text-sidebar-foreground brand-texture flex flex-col transition-transform duration-300 ease-out rounded-r-2xl lg:rounded-none lg:w-64 lg:max-w-none lg:translate-x-0 lg:static lg:z-auto',
          open ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        )}
      >
        {/* Brand */}
        <div className="flex items-center justify-between h-16 px-5 border-b border-sidebar-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-gold to-amber-500 flex items-center justify-center text-gold-foreground font-display font-black text-xl shadow-soft ring-1 ring-gold/30">
              M
            </div>
            <div>
              <p className="font-display font-bold text-xl leading-none tracking-tight">Micky&rsquo;s</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-sidebar-muted leading-tight mt-1">
                Sales Orders
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden text-sidebar-foreground hover:bg-sidebar-active hover:text-sidebar-foreground"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Navigation */}
        <nav className="sidebar-scroll flex-1 overflow-y-auto py-5 px-3 space-y-6">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-muted">
                {section.label}
              </p>
              <div className="space-y-1">
                {section.items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={onClose}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-sidebar-active text-white shadow-soft'
                          : 'text-sidebar-foreground/75 hover:bg-sidebar-active/60 hover:text-white'
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-gold" />
                        )}
                        <Icon
                          size={18}
                          className={cn(
                            'shrink-0 transition-colors',
                            isActive ? 'text-gold' : 'text-sidebar-muted group-hover:text-gold/80'
                          )}
                        />
                        {label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* User card */}
        <div className="border-t border-sidebar-border p-3 shrink-0">
          <div className="flex items-center gap-3 rounded-xl bg-sidebar-active/50 px-3 py-2.5">
            <Avatar className="h-9 w-9 ring-2 ring-gold/40">
              <AvatarFallback className="bg-gold/15 text-gold text-xs font-semibold">
                {getInitials(user?.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <p className="text-[11px] text-sidebar-muted truncate">{ROLE_LABELS[user?.role]}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
