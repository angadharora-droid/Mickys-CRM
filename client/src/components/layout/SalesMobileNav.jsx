import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { MODULES, hasModule, canUseSalesPages } from '@/lib/constants';
import { LayoutDashboard, Boxes, ReceiptText, UserCheck, ArrowLeftRight, Workflow, Banknote, Truck } from 'lucide-react';

/**
 * Bottom tab bar for the Sales Order module (phones/small tablets only).
 * Mirrors MobileNav but with this section's own destinations. The tabs follow
 * the desk: a sales user gets the booking pages (the pipeline and the other
 * desks are a tap away from the Overview header); an accounts or dispatch
 * user gets the pipeline plus their own queue. The last tab, when the user has
 * the leads module, jumps back to the leads CRM.
 */
const tabClass = ({ isActive }) =>
  cn(
    'flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
  );

const COLS = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' };

export default function SalesMobileNav() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const showCrmTab = hasModule(user, MODULES.LEADS);
  const sales = canUseSalesPages(user);

  const tabs = sales
    ? [
        { to: '/sales', end: true, label: 'Overview', icon: LayoutDashboard },
        { to: '/sales/stock', label: 'Stock', icon: Boxes },
        { to: '/sales/orders', label: 'Orders', icon: ReceiptText },
        { to: '/sales/customers', label: 'Customers', icon: UserCheck },
      ]
    : [
        { to: '/sales/pipeline', label: 'Pipeline', icon: Workflow },
        ...(hasModule(user, MODULES.INVOICING) ? [{ to: '/sales/invoicing', label: 'Invoicing', icon: Banknote }] : []),
        ...(hasModule(user, MODULES.DISPATCH) ? [{ to: '/sales/dispatch', label: 'Dispatch', icon: Truck }] : []),
      ];
  const count = tabs.length + (showCrmTab ? 1 : 0);

  return (
    <nav className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-md shadow-nav pb-safe">
      <div className={cn('grid h-16', COLS[Math.min(5, Math.max(1, count))])}>
        {tabs.map(({ to, end, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={end} className={tabClass}>
            {({ isActive }) => (
              <>
                <span className="flex h-7 items-center">
                  <Icon className={cn('h-[22px] w-[22px]', isActive && 'stroke-[2.4]')} />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}

        {showCrmTab && (
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to Leads CRM"
          >
            <span className="flex h-7 items-center">
              <ArrowLeftRight className="h-[22px] w-[22px]" />
            </span>
            CRM
          </button>
        )}
      </div>
    </nav>
  );
}
