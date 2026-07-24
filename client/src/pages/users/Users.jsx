import { Fragment, useCallback, useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import api, { apiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ROLE_LABELS, ROLE_OPTIONS } from '@/lib/constants';
import { formatDateTime, getInitials } from '@/lib/utils';
import PageHeader from '@/components/shared/PageHeader';
import Pagination from '@/components/shared/Pagination';
import EmptyState from '@/components/shared/EmptyState';
import TableSkeleton from '@/components/shared/TableSkeleton';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ChevronDown, ChevronRight, Plus, Search, Users as UsersIcon, Pencil, UserX } from 'lucide-react';

const schema = z.object({
  name: z.string().min(2, 'Required'),
  email: z.string().email('Invalid email'),
  role: z.enum(['admin', 'sales_exec', 'pr_manager']),
  employeeCode: z.string().optional(),
  phone: z.string().optional(),
  // Required on create, optional on edit — enforced in onSubmit since the
  // same form serves both modes.
  password: z.string().min(8, 'At least 8 characters').optional().or(z.literal('')),
});

const EMPTY = { name: '', email: '', role: 'sales_exec', employeeCode: '', phone: '', password: '' };
const ALL = '__all__';

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState(ALL);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deactivating, setDeactivating] = useState(null);
  const [saving, setSaving] = useState(false);
  const [expandedRows, setExpandedRows] = useState({});

  const {
    register, handleSubmit, reset, control,
    formState: { errors },
    setError,
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 10 };
      if (search) params.search = search;
      if (roleFilter !== ALL) params.role = roleFilter;
      const { data } = await api.get('/users', { params });
      setUsers(data.data);
      setMeta(data.meta);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter]);

  const toggleRow = (id) => {
    setExpandedRows((current) => ({ ...current, [id]: !current[id] }));
  };

  useEffect(() => {
    const t = setTimeout(fetchUsers, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [fetchUsers, search]);

  const openCreate = () => {
    setEditing(null);
    reset(EMPTY);
    setDialogOpen(true);
  };

  const openEdit = (u) => {
    setEditing(u);
    reset({
      name: u.name, email: u.email, role: u.role,
      employeeCode: u.employeeCode || '', phone: u.phone || '', password: '',
    });
    setDialogOpen(true);
  };

  const onSubmit = async (values) => {
    if (!editing && !values.password) {
      setError('password', { message: 'Password is required' });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const payload = { ...values };
        if (!payload.password) delete payload.password;
        await api.put(`/users/${editing._id}`, payload);
        toast.success('User updated');
      } else {
        await api.post('/users', values);
        toast.success('User created');
      }
      setDialogOpen(false);
      fetchUsers();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const onDeactivate = async () => {
    setSaving(true);
    try {
      await api.delete(`/users/${deactivating._id}`);
      toast.success('User deactivated');
      setDeactivating(null);
      fetchUsers();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const reactivate = async (u) => {
    try {
      await api.put(`/users/${u._id}`, { isActive: true });
      toast.success('User reactivated');
      fetchUsers();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  return (
    <div>
      <PageHeader title="Users" description="Manage admins, sales executives and PR managers">
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> New User</Button>
      </PageHeader>

      <Card className="p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="relative sm:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, email or code…"
              className="pl-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="Role" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All roles</SelectItem>
              {ROLE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : users.length === 0 ? (
          <EmptyState icon={UsersIcon} title="No users" />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 px-2 lg:hidden" />
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Code</TableHead>
                  <TableHead className="hidden lg:table-cell">Last Login</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isExpanded = !!expandedRows[u._id];
                  const ExpandIcon = isExpanded ? ChevronDown : ChevronRight;

                  return (
                    <Fragment key={u._id}>
                      <TableRow>
                        <TableCell className="px-2 lg:hidden">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={isExpanded ? 'Hide user details' : 'Show user details'}
                            aria-expanded={isExpanded}
                            onClick={() => toggleRow(u._id)}
                          >
                            <ExpandIcon className="h-4 w-4" />
                          </Button>
                        </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                            {getInitials(u.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{u.name} {u._id === me._id && <span className="text-xs text-muted-foreground">(you)</span>}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{ROLE_LABELS[u.role]}</Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell font-mono text-xs">{u.employeeCode || '—'}</TableCell>
                    <TableCell className="hidden lg:table-cell text-xs">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</TableCell>
                    <TableCell>
                      <Badge variant={u.isActive ? 'secondary' : 'outline'}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(u)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {u.isActive && u._id !== me._id ? (
                          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeactivating(u)}>
                            <UserX className="h-4 w-4" />
                          </Button>
                        ) : !u.isActive ? (
                          <Button variant="ghost" size="sm" onClick={() => reactivate(u)}>Activate</Button>
                        ) : null}
                      </div>
                    </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/25 hover:bg-muted/25 lg:hidden">
                          <TableCell colSpan={7} className="px-4 py-3">
                            <dl className="grid gap-3 text-sm sm:grid-cols-3">
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Code</dt>
                                <dd className="mt-1 font-mono text-xs">{u.employeeCode || '—'}</dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last Login</dt>
                                <dd className="mt-1 font-medium">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Phone</dt>
                                <dd className="mt-1 font-medium">{u.phone || '—'}</dd>
                              </div>
                            </dl>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination meta={meta} onPageChange={setPage} />
          </>
        )}
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'New User'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Full name *</Label>
                <Input {...register('name')} />
                {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Email *</Label>
                <Input type="email" {...register('email')} />
                {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Role *</Label>
                <Controller
                  control={control}
                  name="role"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>Employee code</Label>
                <Input placeholder="e.g. EMP003" {...register('employeeCode')} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input {...register('phone')} />
              </div>
              <div className="space-y-2">
                <Label>{editing ? 'New password (optional)' : 'Password *'}</Label>
                <Input type="password" {...register('password')} />
                {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Create user'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deactivating)}
        onOpenChange={(o) => !o && setDeactivating(null)}
        title={`Deactivate ${deactivating?.name}?`}
        description="They will be logged out of all devices and unable to sign in."
        confirmLabel="Deactivate"
        loading={saving}
        onConfirm={onDeactivate}
      />
    </div>
  );
}
