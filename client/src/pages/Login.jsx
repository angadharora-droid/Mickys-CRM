import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { apiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Loader2, ShieldCheck, UserRound, Lock } from 'lucide-react';

// Mirrors the server rule: email for everyone, phone number for admins.
const phonePattern = /^\+?[\d\s()-]{7,20}$/;
const schema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, 'Email or phone number is required')
    .refine(
      (value) => z.string().email().safeParse(value).success || phonePattern.test(value),
      'Enter a valid email or phone number'
    ),
  password: z.string().min(1, 'Password is required'),
});

export default function Login() {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema) });

  if (!loading && user) {
    return <Navigate to={location.state?.from?.pathname || '/'} replace />;
  }

  const onSubmit = async (values) => {
    setSubmitting(true);
    try {
      await login(values.identifier, values.password);
      toast.success('Welcome back!');
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center brand-aurora px-4 py-4 sm:px-6 overflow-hidden">
      {/* Soft ambient brand glows */}
      <div className="pointer-events-none absolute -top-24 -right-16 h-80 w-80 rounded-full bg-gold/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -left-16 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative w-full max-w-sm animate-fade-in-up">
        {/* Brand */}
        <div className="flex flex-col items-center text-center mb-5 sm:mb-8">
          <div className="h-14 w-14 sm:h-16 sm:w-16 rounded-2xl bg-gradient-to-br from-gold to-amber-500 flex items-center justify-center text-gold-foreground font-display font-black text-3xl shadow-lifted ring-1 ring-gold/30">
            M
          </div>
          <h1 className="mt-3.5 font-display font-bold text-3xl leading-none tracking-tight text-foreground">
            Micky&rsquo;s
          </h1>
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground mt-2.5 font-medium">
            Sales CRM
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card/90 backdrop-blur-sm text-card-foreground shadow-lifted p-6 sm:p-8">
          <div className="text-center sm:text-left">
            <h2 className="font-display text-2xl font-bold tracking-tight">Welcome back</h2>
            <p className="text-sm text-muted-foreground mt-1.5">
              Sign in to access your sales dashboard.
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="identifier">Email or phone number</Label>
              <div className="relative">
                <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="identifier"
                  type="text"
                  placeholder="you@mickys.com or 98765 43210"
                  autoComplete="username"
                  className="h-12 pl-10"
                  {...register('identifier')}
                />
              </div>
              {errors.identifier && (
                <p className="text-sm text-destructive">{errors.identifier.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Phone sign-in is available for admins only.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="h-12 pl-10 pr-11"
                  {...register('password')}
                />
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  onClick={() => setShowPassword((s) => !s)}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>

            <Button type="submit" size="lg" className="w-full h-12 text-[15px] mt-1" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-6 flex items-center gap-2.5 rounded-xl border border-border bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
            Accounts are created by your administrator. Contact them if you can&rsquo;t sign in.
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground/80 mt-4 sm:mt-6">
          © {new Date().getFullYear()} Micky&rsquo;s by CP Foods · All rights reserved
        </p>
      </div>
    </div>
  );
}
