import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

// Admins may switch to a short numeric PIN for quick sign-in; every other
// role always uses a text password. Mirrors the server-side rule.
const MODES = [
  { value: 'text', label: 'Text password' },
  { value: 'pin4', label: '4-digit PIN' },
  { value: 'pin6', label: '6-digit PIN' },
];

const NEW_PASSWORD_RULES = {
  text: z.string().min(8, 'At least 8 characters'),
  pin4: z.string().regex(/^\d{4}$/, 'Enter exactly 4 digits'),
  pin6: z.string().regex(/^\d{6}$/, 'Enter exactly 6 digits'),
};

const makeSchema = (mode) =>
  z
    .object({
      currentPassword: z.string().min(1, 'Current password is required'),
      newPassword: NEW_PASSWORD_RULES[mode],
      confirmPassword: z.string(),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    });

export default function ChangePassword() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [mode, setMode] = useState('text');
  const [submitting, setSubmitting] = useState(false);

  const activeMode = isAdmin ? mode : 'text';
  const schema = useMemo(() => makeSchema(activeMode), [activeMode]);
  const isPin = activeMode !== 'text';
  const pinLength = activeMode === 'pin4' ? 4 : 6;

  const {
    register,
    handleSubmit,
    reset,
    resetField,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema) });

  const switchMode = (value) => {
    setMode(value);
    resetField('newPassword');
    resetField('confirmPassword');
  };

  const onSubmit = async (values) => {
    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast.success(data.message || 'Password updated');
      reset();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg">
      <PageHeader title="Change Password" description="Update your account password" />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>Current password</Label>
              <Input type="password" autoComplete="current-password" {...register('currentPassword')} />
              {errors.currentPassword && <p className="text-sm text-destructive">{errors.currentPassword.message}</p>}
            </div>

            {isAdmin && (
              <div className="space-y-2">
                <Label>New password type</Label>
                <div className="grid grid-cols-3 gap-2">
                  {MODES.map((m) => (
                    <Button
                      key={m.value}
                      type="button"
                      size="sm"
                      variant={mode === m.value ? 'default' : 'outline'}
                      onClick={() => switchMode(m.value)}
                    >
                      {m.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  PIN sign-in is available for admin accounts only.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>{isPin ? `New ${pinLength}-digit PIN` : 'New password'}</Label>
              <Input
                type="password"
                autoComplete="new-password"
                inputMode={isPin ? 'numeric' : undefined}
                maxLength={isPin ? pinLength : undefined}
                {...register('newPassword')}
              />
              {errors.newPassword && <p className="text-sm text-destructive">{errors.newPassword.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>{isPin ? 'Confirm new PIN' : 'Confirm new password'}</Label>
              <Input
                type="password"
                autoComplete="new-password"
                inputMode={isPin ? 'numeric' : undefined}
                maxLength={isPin ? pinLength : undefined}
                {...register('confirmPassword')}
              />
              {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>}
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Updating…' : isPin ? 'Update PIN' : 'Update password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
