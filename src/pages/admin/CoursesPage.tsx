import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Building2, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { courseSchema, departmentSchema, type CourseInput, type DepartmentInput } from '@shared/schemas';
import { useBreadcrumbs } from '@/components/layout/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';

interface Course {
  id: string;
  code: string;
  name: string;
  year: number;
  credits: number;
  departmentId: string;
  departmentCode: string;
  examCount: number;
}
interface Department {
  id: string;
  code: string;
  name: string;
  studentCount: number;
  courseCount: number;
}

export function CoursesPage() {
  useBreadcrumbs([{ label: 'Courses & departments' }]);
  const courses = useQuery({ queryKey: ['courses'], queryFn: () => api.get<Course[]>('/courses') });
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/departments') });
  const [course, setCourse] = useState<Course | null | 'new'>(null);
  const [deptOpen, setDeptOpen] = useState(false);
  return (
    <div>
      <PageHeader title="Courses & departments" description="Academic catalogue used to define examinations and eligible cohorts." />
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Courses"
            action={
              <Button size="sm" variant="primary" onClick={() => setCourse('new')}>
                <Plus className="h-3.5 w-3.5" /> Add course
              </Button>
            }
          />
          {courses.isError ? (
            <ErrorState error={courses.error} onRetry={() => courses.refetch()} />
          ) : !courses.data ? (
            <TableSkeleton rows={4} />
          ) : courses.data.length === 0 ? (
            <EmptyState icon={BookOpen} title="No courses yet" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Code</TH>
                  <TH>Name</TH>
                  <TH>Dept</TH>
                  <TH>Year</TH>
                  <TH className="text-right">Credits</TH>
                  <TH className="text-right">Active exams</TH>
                  <TH className="w-10" />
                </tr>
              </THead>
              <TBody>
                {courses.data.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-mono text-xs font-medium">{c.code}</TD>
                    <TD>{c.name}</TD>
                    <TD>{c.departmentCode}</TD>
                    <TD>{c.year}</TD>
                    <TD className="tnum text-right">{c.credits}</TD>
                    <TD className="tnum text-right">{c.examCount}</TD>
                    <TD>
                      <Button variant="ghost" size="icon" onClick={() => setCourse(c)} aria-label={`Edit ${c.code}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Departments"
            action={
              <Button size="sm" onClick={() => setDeptOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            }
          />
          {!depts.data ? (
            <TableSkeleton rows={3} cols={3} />
          ) : (
            <ul className="divide-y divide-line/70">
              {depts.data.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <Building2 className="h-4 w-4 text-faint" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{d.code}</p>
                    <p className="truncate text-xs text-muted">{d.name}</p>
                  </div>
                  <span className="tnum text-right text-xs text-muted">
                    {d.studentCount} students
                    <br />
                    {d.courseCount} courses
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <CourseDialog course={course} onClose={() => setCourse(null)} departments={depts.data ?? []} />
      <DepartmentDialog open={deptOpen} onClose={() => setDeptOpen(false)} />
    </div>
  );
}

function CourseDialog({ course, onClose, departments }: { course: Course | null | 'new'; onClose: () => void; departments: Department[] }) {
  const form = useForm<CourseInput>({ resolver: zodResolver(courseSchema) });
  const editing = course && course !== 'new' ? course : null;
  useEffect(() => {
    if (!course) return;
    form.reset(
      editing
        ? { code: editing.code, name: editing.name, departmentId: editing.departmentId, year: editing.year, credits: editing.credits }
        : { code: '', name: '', departmentId: '', year: 1, credits: 3 },
    );
  }, [course, editing, form]);
  const err = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      if (editing) await api.put(`/courses/${editing.id}`, v);
      else await api.post('/courses', v);
      toast.success(editing ? 'Course updated' : 'Course added');
      onClose();
    } catch (e) {
      applyServerErrors(form, e);
    }
  });
  return (
    <Dialog
      open={!!course}
      onOpenChange={(v) => !v && onClose()}
      title={editing ? `Edit ${editing.code}` : 'Add course'}
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
        <Field label="Course code" error={err.code?.message}>
          <Input {...form.register('code')} placeholder="CS304" aria-invalid={!!err.code} />
        </Field>
        <Field label="Department" error={err.departmentId?.message}>
          <Select {...form.register('departmentId')}>
            <option value="">Select…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Course name" error={err.name?.message} className="sm:col-span-2">
          <Input {...form.register('name')} aria-invalid={!!err.name} />
        </Field>
        <Field label="Year" error={err.year?.message}>
          <Select {...form.register('year', { valueAsNumber: true })}>
            {[1, 2, 3, 4, 5].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Credits" error={err.credits?.message}>
          <Input type="number" min={0} max={10} {...form.register('credits', { valueAsNumber: true })} />
        </Field>
      </form>
    </Dialog>
  );
}

function DepartmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const form = useForm<DepartmentInput>({ resolver: zodResolver(departmentSchema), defaultValues: { code: '', name: '' } });
  const err = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      await api.post('/departments', v);
      toast.success('Department added');
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
      size="sm"
      title="Add department"
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
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Code" error={err.code?.message}>
          <Input {...form.register('code')} placeholder="MECH" />
        </Field>
        <Field label="Name" error={err.name?.message}>
          <Input {...form.register('name')} placeholder="Mechanical Engineering" />
        </Field>
      </form>
    </Dialog>
  );
}
