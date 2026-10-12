import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap, Pencil, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { z } from 'zod';
import { studentSchema } from '@shared/schemas';
import { useBreadcrumbs } from '@/components/layout/breadcrumbs';
import { Badge } from '@/components/ui/badges';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { Checkbox, Field, Input, SearchInput, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { Pagination, Table, TableSkeleton, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, qs } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import type { Meta, Paged, Student } from '@/lib/types';

type StudentForm = z.input<typeof studentSchema>;

export function StudentsPage() {
  useBreadcrumbs([{ label: 'Students' }]);
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(search);
  const [departmentId, setDepartmentId] = useState('');
  const [year, setYear] = useState('');
  const [section, setSection] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Student | null | 'new'>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [debounced, departmentId, year, section]);
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/meta'), staleTime: 60_000 });
  const q = useQuery({
    queryKey: ['students', { debounced, departmentId, year, section, page }],
    queryFn: () => api.get<Paged<Student>>(`/students${qs({ q: debounced, departmentId, year, section, page, pageSize: 20 })}`),
    placeholderData: (p) => p,
  });

  return (
    <div>
      <PageHeader
        title="Students"
        description="Student register used for eligibility. Students sign in with their linked account to view published seats."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <UserPlus className="h-4 w-4" /> Add student
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search roll number or name…" className="w-full sm:w-64" />
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="h-9 w-auto" aria-label="Department">
            <option value="">All departments</option>
            {meta.data?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code}
              </option>
            ))}
          </Select>
          <Select value={year} onChange={(e) => setYear(e.target.value)} className="h-9 w-auto" aria-label="Year">
            <option value="">All years</option>
            {[1, 2, 3, 4, 5].map((y) => (
              <option key={y} value={y}>
                Year {y}
              </option>
            ))}
          </Select>
          <Select value={section} onChange={(e) => setSection(e.target.value)} className="h-9 w-auto" aria-label="Section">
            <option value="">All sections</option>
            {['A', 'B', 'C', 'D'].map((s) => (
              <option key={s} value={s}>
                Section {s}
              </option>
            ))}
          </Select>
        </div>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <TableSkeleton />
        ) : q.data.items.length === 0 ? (
          <EmptyState icon={GraduationCap} title="No students match" />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Roll no.</TH>
                  <TH>Name</TH>
                  <TH>Department</TH>
                  <TH>Year · Section</TH>
                  <TH>Email</TH>
                  <TH className="text-right">Active exams</TH>
                  <TH>Status</TH>
                  <TH className="w-10" />
                </tr>
              </THead>
              <TBody>
                {q.data.items.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-mono text-xs">{s.rollNo}</TD>
                    <TD className="font-medium">{s.fullName}</TD>
                    <TD>{s.departmentCode}</TD>
                    <TD>
                      Y{s.year} · {s.section}
                    </TD>
                    <TD className="text-muted">{s.email ?? '—'}</TD>
                    <TD className="tnum text-right">{s.examCount}</TD>
                    <TD>
                      <div className="flex gap-1">
                        {s.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}
                        {s.hasLogin && <Badge tone="accent">Login</Badge>}
                      </div>
                    </TD>
                    <TD>
                      <Button variant="ghost" size="icon" onClick={() => setEditing(s)} aria-label={`Edit ${s.rollNo}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <StudentDialog student={editing} onClose={() => setEditing(null)} meta={meta.data} />
    </div>
  );
}

function StudentDialog({ student, onClose, meta }: { student: Student | null | 'new'; onClose: () => void; meta?: Meta }) {
  const form = useForm<StudentForm>({ resolver: zodResolver(studentSchema) });
  const editing = student && student !== 'new' ? student : null;
  useEffect(() => {
    if (!student) return;
    form.reset(
      editing
        ? {
            rollNo: editing.rollNo,
            fullName: editing.fullName,
            email: editing.email ?? '',
            departmentId: editing.departmentId,
            year: editing.year,
            section: editing.section,
            isActive: editing.isActive,
          }
        : { rollNo: '', fullName: '', email: '', departmentId: '', year: 1, section: 'A', isActive: true },
    );
  }, [student, editing, form]);
  const err = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      if (editing) await api.put(`/students/${editing.id}`, v);
      else await api.post('/students', v);
      toast.success(editing ? 'Student updated' : 'Student added');
      onClose();
    } catch (e) {
      applyServerErrors(form, e);
    }
  });
  return (
    <Dialog
      open={!!student}
      onOpenChange={(v) => !v && onClose()}
      title={editing ? `Edit ${editing.rollNo}` : 'Add student'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={form.formState.isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Roll number" error={err.rollNo?.message}>
          <Input {...form.register('rollNo')} placeholder="23CSE027" aria-invalid={!!err.rollNo} />
        </Field>
        <Field label="Full name" error={err.fullName?.message}>
          <Input {...form.register('fullName')} aria-invalid={!!err.fullName} />
        </Field>
        <Field label="Email" error={err.email?.message} className="sm:col-span-2">
          <Input type="email" {...form.register('email')} placeholder="Optional" />
        </Field>
        <Field label="Department" error={err.departmentId?.message}>
          <Select {...form.register('departmentId')} aria-invalid={!!err.departmentId}>
            <option value="">Select…</option>
            {meta?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Year" error={err.year?.message}>
            <Select {...form.register('year', { valueAsNumber: true })}>
              {[1, 2, 3, 4, 5].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Section" error={err.section?.message}>
            <Input maxLength={1} {...form.register('section')} aria-invalid={!!err.section} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Checkbox checked={!!form.watch('isActive')} onChange={(v) => form.setValue('isActive', v)} label={<span className="text-[13px] text-muted">Active (eligible for enrolment)</span>} />
        </div>
      </form>
    </Dialog>
  );
}
