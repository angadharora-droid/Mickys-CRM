import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import SalesSidebar from './SalesSidebar';
import Header from './Header';
import SalesMobileNav from './SalesMobileNav';

/**
 * App shell for the Sales Order module — same chrome as AppLayout but with
 * this section's own sidebar and bottom bar, so its navigation is fully
 * separate from the leads CRM.
 */
export default function SalesLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Same document-scroll lock as AppLayout: the shell owns the viewport and
  // <main> scrolls internally.
  useEffect(() => {
    const html = document.documentElement;
    const { overflow: prevHtml } = html.style;
    const { overflow: prevBody } = document.body.style;
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, []);

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <SalesSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8 mb-safe-nav lg:mb-0">
            <Outlet />
          </div>
        </main>
      </div>
      <SalesMobileNav />
    </div>
  );
}
