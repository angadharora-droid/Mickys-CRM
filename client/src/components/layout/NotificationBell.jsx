import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Bell, CheckCheck, Inbox } from 'lucide-react';

// "5m ago" — compact relative time for the notification list.
function timeAgo(d) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * Header bell: shows the signed-in user's in-app notification inbox (every
 * push notification is also stored server-side, so this works even on devices
 * without web push). Unread count polls in the background; opening an item
 * marks it read and navigates to the lead it points at.
 */
export default function NotificationBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications');
      setItems(data.data);
      setUnread(data.meta?.unread || 0);
    } catch {
      // Silent: the bell must never toast on a background poll hiccup.
    }
  }, []);

  // Load on mount, then keep the badge fresh with a light background poll.
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Re-fetch when the menu opens so the list is current the moment it shows.
  const onOpenChange = (next) => {
    setOpen(next);
    if (next) refresh();
  };

  const openItem = async (n) => {
    setOpen(false);
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x._id === n._id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      api.post(`/notifications/${n._id}/read`).catch(() => {});
    }
    if (n.url && n.url !== '/') navigate(n.url);
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
    api.post('/notifications/read-all').catch(() => {});
  };

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title="Notifications"
          aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'}
          className="relative text-muted-foreground rounded-full"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={markAllRead}>
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="grid place-items-center gap-2 px-4 py-8 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Nothing yet — lead assignments will show up here.
            </p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto py-1">
            {items.map((n) => (
              <button
                key={n._id}
                type="button"
                onClick={() => openItem(n)}
                className={cn(
                  'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/60 focus:bg-accent/60 focus:outline-none',
                  !n.read && 'bg-primary/[0.04]'
                )}
              >
                <span
                  className={cn(
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                    n.read ? 'bg-transparent' : 'bg-primary'
                  )}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className={cn('block text-sm leading-snug', !n.read && 'font-medium')}>
                    {n.title}
                  </span>
                  {n.body && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{n.body}</span>
                  )}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground/80">
                    {timeAgo(n.createdAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
