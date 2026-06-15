import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { getInitials } from '@/lib/utils';
import { ROLE_LABELS } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Moon, Sun, LogOut, KeyRound, ChevronDown } from 'lucide-react';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Header() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/70 bg-background/80 backdrop-blur-md px-4 sm:px-6">
      <div className="flex items-center gap-3 min-w-0">
        {/* Brand mark — mobile only (sidebar carries it on desktop) */}
        <div className="flex items-center gap-2.5 lg:hidden">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gold text-gold-foreground font-display font-black text-lg shadow-soft">
            M
          </div>
          <span className="font-display font-bold text-lg leading-none tracking-tight">Micky&rsquo;s</span>
        </div>

        {/* Greeting — desktop only */}
        <div className="hidden lg:block min-w-0">
          <p className="text-sm font-semibold truncate">
            {greeting()}, {user?.name?.split(' ')[0]} 👋
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          title="Toggle theme"
          aria-label="Toggle theme"
          className="text-muted-foreground rounded-full"
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2.5 rounded-full sm:rounded-xl sm:pl-1.5 sm:pr-2.5 sm:py-1.5 hover:bg-accent/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar className="h-9 w-9 sm:h-8 sm:w-8 ring-1 ring-primary/15">
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                  {getInitials(user?.name)}
                </AvatarFallback>
              </Avatar>
              <span className="hidden sm:block text-left">
                <span className="block text-sm font-medium leading-tight">{user?.name}</span>
                <span className="block text-[11px] text-muted-foreground leading-tight">
                  {ROLE_LABELS[user?.role]}
                </span>
              </span>
              <ChevronDown className="hidden sm:block h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <p className="font-medium">{user?.name}</p>
              <p className="text-xs text-muted-foreground font-normal">{user?.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/change-password')}>
              <KeyRound /> Change password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
              <LogOut /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
