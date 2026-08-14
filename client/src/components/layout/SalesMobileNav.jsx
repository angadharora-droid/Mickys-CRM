import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Boxes, ReceiptText, UserCheck, ArrowLeftRight } from 'lucide-react';

/**
 * Bottom tab bar for the Sales Order module (phones/small tablets only).
 * Mirrors MobileNav but with this section's own destinations; the fourth tab
 * jumps back to the leads CRM.
 */
const tabClass = ({ isActive }) =>
  cn(
    'flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
  );

export default function SalesMobileNav() {
  const navigate = useNavigate();

  return (
    <nav className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-md shadow-nav pb-safe">
      <div className="grid grid-cols-5 h-16">
        <NavLink to="/sales" end className={tabClass}>
          {({ isActive }) => (
            <>
              <span className="flex h-7 items-center">
                <LayoutDashboard className={cn('h-[22px] w-[22px]', isActive && 'stroke-[2.4]')} />
              </span>
              Overview
            </>
          )}
        </NavLink>

        <NavLink to="/sales/stock" className={tabClass}>
          {({ isActive }) => (
            <>
              <span className="flex h-7 items-center">
                <Boxes className={cn('h-[22px] w-[22px]', isActive && 'stroke-[2.4]')} />
              </span>
              Stock
            </>
          )}
        </NavLink>

        <NavLink to="/sales/orders" className={tabClass}>
          {({ isActive }) => (
            <>
              <span className="flex h-7 items-center">
                <ReceiptText className={cn('h-[22px] w-[22px]', isActive && 'stroke-[2.4]')} />
              </span>
              Orders
            </>
          )}
        </NavLink>

        <NavLink to="/sales/customers" className={tabClass}>
          {({ isActive }) => (
            <>
              <span className="flex h-7 items-center">
                <UserCheck className={cn('h-[22px] w-[22px]', isActive && 'stroke-[2.4]')} />
              </span>
              Customers
            </>
          )}
        </NavLink>

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
      </div>
    </nav>
  );
}
