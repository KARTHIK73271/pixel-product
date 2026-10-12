import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { UserCog, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ROLE_LABEL, userCreateSchema, type Role, type UserCreateInput } from '@shared/schemas';
import { GoogleIcon } from '@/components/GoogleIcon';
import { useBreadcrumbs } from '@/components/layout/breadcrumbs';
import { Badge } from '@/components/ui/badges';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors, withToast } from '@/lib/forms';
import { fmtDateTime } from '@/lib/utils';

interface Staff {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  upcomingDuties: number;
  googleLinked: boolean;
  passwordLogin: boolean;
}

function SignInMethods({ s }: { s: Staff }) {
  return (
    <div className="flex flex-wrap gap-1">
      {s.passwordLogin && <Badge>Password</Badge>}
      <Badge tone={s.googleLinked ? 'ok' : 'neutral'} icon={<GoogleIcon className="h-3 w-3" />}>
        {s.googleLinked ? 'Google linked' : 'Google (not yet used)'}
      </Badge>
    </div>
  );
}

export function StaffPage() {
  useBreadcrumbs([{ label: 'Staff accounts' }]);
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<Staff[]>('/users') });
  const [createOpen, setCreateOpen] = useState(false);
  const [toggle, setToggle] = useState<Staff | null>(null);
  const [unlink, setUnlink] = useState<Staff | null>(null);
  return (
    <div>
      <PageHeader
        title="Staff accounts"
        description="Examination admins and in-charges. In-charges only ever see the examinations and rooms explicitly assigned to them."
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <UserPlus className="h-4 w-4" /> New account
          </Button>
        }
      />
      <Card>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <TableSkeleton rows={4} />
        ) : q.data.length === 0 ? (
          <EmptyState icon={UserCog} title="No staff accounts" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Role</TH>
                <TH>Sign-in</TH>
                <TH className="text-right">Upcoming duties</TH>
                <TH>Last sign-in</TH>
                <TH>Status</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {q.data.map((s) => (
                <TR key={s.id}>
                  <TD className="font-medium">{s.fullName}</TD>
                  <TD className="text-muted">{s.email}</TD>
                  <TD>
                    <Badge tone={s.role === 'ADMIN' ? 'accent' : 'cyan'}>{ROLE_LABEL[s.role]}</Badge>
                  </TD>
                  <TD>
                    <SignInMethods s={s} />
                  </TD>
                  <TD className="tnum text-right">{s.upcomingDuties}</TD>
                  <TD className="text-muted">{fmtDateTime(s.lastLoginAt)}</TD>
                  <TD>{s.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Disabled</Badge>}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      {s.googleLinked && (
                        <Button size="sm" variant="ghost" onClick={() => setUnlink(s)} title="Remove the Google account binding">
                          Unlink Google
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" disabled={s.id === user?.id} onClick={() => setToggle(s)} title={s.id === user?.id ? 'You cannot disable yourself' : undefined}>
                        {s.isActive ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <CreateStaffDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <ConfirmDialog
        open={!!toggle}
        onOpenChange={(v) => !v && setToggle(null)}
        tone={toggle?.isActive ? 'danger' : 'primary'}
        title={toggle?.isActive ? `Disable ${toggle?.fullName}?` : `Enable ${toggle?.fullName}?`}
        description={toggle?.isActive ? 'Their sessions stop working immediately and they lose access to all assignments.' : 'They will be able to sign in again.'}
        confirmLabel={toggle?.isActive ? 'Disable' : 'Enable'}
        onConfirm={() => withToast(() => api.patch(`/users/${toggle!.id}`, { isActive: !toggle!.isActive }), 'Account updated')}
      />
      <ConfirmDialog
        open={!!unlink}
        onOpenChange={(v) => !v && setUnlink(null)}
        tone="danger"
        title={`Unlink Google from ${unlink?.fullName ?? ''}?`}
        description="Use this when the person changed Google accounts. The next Google account that signs in with this email address becomes the linked one."
        confirmLabel="Unlink"
        onConfirm={() => withToast(() => api.post(`/users/${unlink!.id}/unlink-google`), 'Google account unlinked')}
      />
    </div>
  );
}

function CreateStaffDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const form = useForm<UserCreateInput>({ resolver: zodResolver(userCreateSchema), defaultValues: { email: '', fullName: '', role: 'INCHARGE', password: '' } });
  const err = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post('/users', v);
      toast.success('Account created');
      form.reset();
      onClose();
    } catch (e) {
      applyServerErrors(form, e);
    }
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="New staff account"
      description="The person signs in with Google using this exact email address. A password is optional — leave it blank for a Google-only account."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={form.formState.isSubmitting}>
            Create account
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Full name" error={err.fullName?.message}>
          <Input {...form.register('fullName')} />
        </Field>
        <Field label="Email (Google account)" hint="Must match the Google account they will use" error={err.email?.message}>
          <Input type="email" {...form.register('email')} />
        </Field>
        <Field label="Role" error={err.role?.message}>
          <Select {...form.register('role')}>
            <option value="INCHARGE">Examination In-Charge</option>
            <option value="ADMIN">Examination Admin</option>
          </Select>
        </Field>
        <Field
          label="Initial password (optional)"
          hint="Blank = Google sign-in only. Otherwise at least 10 characters with a letter and a number; share it securely."
          error={err.password?.message}
        >
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
      </form>
    </Dialog>
  );
}
