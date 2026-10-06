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
    // print: the page flows on paper instead of scrolling inside the shell
    // (the Day End Report prints from here); the chrome hides itself.
    <div className="flex h-[100dvh] overflow-hidden print:block print:h-auto print:overflow-visible">
      <SalesSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto print:overflow-visible">
          <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8 mb-safe-nav lg:mb-0 print:max-w-none print:p-0 print:mb-0">
            <Outlet />
          </div>
        </main>
      </div>
      <SalesMobileNav />
    </div>
  );
}
