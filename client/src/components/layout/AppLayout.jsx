import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { registerServiceWorker, syncPushSubscription } from '@/lib/push';
import Sidebar from './Sidebar';
import Header from './Header';
import MobileNav from './MobileNav';

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Register the push service worker up front and re-attach any existing push
  // subscription to the account now signed in, so a shared device always
  // notifies its current user.
  useEffect(() => {
    registerServiceWorker().then(() => syncPushSubscription());
  }, []);

  // The app shell owns the viewport (h-[100dvh]) and scrolls internally via <main>.
  // Lock document-level scrolling while it's mounted so the page can never grow a
  // second, stray scrollbar next to the main one. Restored on unmount so the
  // standalone login / 404 pages keep their normal document scrolling.
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
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8 mb-safe-nav lg:mb-0">
            <Outlet />
          </div>
        </main>
      </div>
      <MobileNav onMenuClick={() => setSidebarOpen(true)} />
    </div>
  );
}
