import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { EXAM_TYPE_LABEL, EXAM_TYPES, examSchema, SESSION_LABEL, SESSIONS } from '@shared/schemas';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import type { ExamRow, Meta } from '@/lib/types';
import { todayLocalIso } from '@/lib/utils';

// Form-level schema: selects produce '' for "none", converted to null on submit.
const formSchema = examSchema.extend({
  departmentId: z.string(),
  section: z.string().regex(/^[A-Za-z]?$/, 'Single letter or blank'),
  autoEnroll: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

export function ExamFormDialog({
  open,
  onOpenChange,
  exam,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  exam?: ExamRow | null;
  onSaved?: (id: string) => void;
}) {
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/meta'), staleTime: 60_000 });
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema) });
  const editing = !!exam;

  useEffect(() => {
    if (!open) return;
    form.reset(
      exam
        ? {
            name: exam.name,
            examType: exam.examType,
            courseId: exam.courseId,
            departmentId: exam.departmentId ?? '',
            year: exam.year,
            section: exam.section ?? '',
            examDate: exam.examDate,
            session: exam.session,
            startTime: exam.startTime,
            durationMinutes: exam.durationMinutes,
            autoEnroll: false,
          }
        : {
            name: '',
            examType: 'MIDTERM',
            courseId: '',
            departmentId: '',
            year: 3,
            section: '',
            examDate: '',
            session: 'FN',
            startTime: '09:30',
            durationMinutes: 120,
            autoEnroll: true,
          },
    );
  }, [open, exam, form]);

  const courseId = form.watch('courseId');
  const examType = form.watch('examType');
  useEffect(() => {
    if (editing || !courseId) return;
    const c = meta.data?.courses.find((x) => x.id === courseId);
    if (!c) return;
    form.setValue('departmentId', c.departmentId);
    form.setValue('year', c.year);
    if (!form.getValues('name')) form.setValue('name', `${EXAM_TYPE_LABEL[examType]} Examination — ${c.name}`);
  }, [courseId, examType, editing, meta.data, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    const body = { ...v, departmentId: v.departmentId || null, section: v.section ? v.section.toUpperCase() : null };
    try {
      if (editing) {
        await api.put(`/exams/${exam!.id}`, body);
        toast.success('Examination updated');
        onOpenChange(false);
        onSaved?.(exam!.id);
      } else {
        const r = await api.post<{ id: string; enrolled: { added: number; skippedConflicts: number } }>('/exams', body);
        toast.success('Examination created', {
          description: v.autoEnroll
            ? `${r.enrolled.added} eligible student(s) enrolled${r.enrolled.skippedConflicts ? `, ${r.enrolled.skippedConflicts} skipped (slot conflict)` : ''}.`
            : undefined,
        });
        onOpenChange(false);
        onSaved?.(r.id);
      }
    } catch (e) {
      applyServerErrors(form, e);
    }
  });

  const err = form.formState.errors;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={editing ? 'Edit examination' : 'New examination'}
      description={editing ? 'Changes are audited. Published examinations must be unpublished first.' : 'Define the course, slot and eligible cohort.'}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSubmit} loading={form.formState.isSubmitting}>
            {editing ? 'Save changes' : 'Create examination'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Course" error={err.courseId?.message} className="sm:col-span-2">
          <Select {...form.register('courseId')} aria-invalid={!!err.courseId}>
            <option value="">Select a course…</option>
            {meta.data?.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Examination type" error={err.examType?.message}>
          <Select {...form.register('examType')}>
            {EXAM_TYPES.map((t) => (
              <option key={t} value={t}>
                {EXAM_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Examination name" error={err.name?.message}>
          <Input {...form.register('name')} aria-invalid={!!err.name} />
        </Field>
        <Field label="Date" error={err.examDate?.message}>
          <Input type="date" min={editing ? undefined : todayLocalIso()} {...form.register('examDate')} aria-invalid={!!err.examDate} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Session" error={err.session?.message}>
            <Select {...form.register('session')}>
              {SESSIONS.map((s) => (
                <option key={s} value={s}>
                  {SESSION_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start time" error={err.startTime?.message}>
            <Input type="time" {...form.register('startTime')} aria-invalid={!!err.startTime} />
          </Field>
        </div>
        <Field label="Duration (minutes)" error={err.durationMinutes?.message}>
          <Input type="number" min={30} max={300} step={15} {...form.register('durationMinutes', { valueAsNumber: true })} aria-invalid={!!err.durationMinutes} />
        </Field>
        <Field label="Department" hint="Leave as “All” for a multi-department paper" error={err.departmentId?.message}>
          <Select {...form.register('departmentId')}>
            <option value="">All departments</option>
            {meta.data?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Year" error={err.year?.message}>
          <Select {...form.register('year', { valueAsNumber: true })}>
            {[1, 2, 3, 4, 5].map((y) => (
              <option key={y} value={y}>
                Year {y}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Section" hint="Blank = all sections" error={err.section?.message}>
          <Input maxLength={1} placeholder="All" {...form.register('section')} aria-invalid={!!err.section} />
        </Field>
        {!editing && (
          <div className="sm:col-span-2">
            <Checkbox
              checked={form.watch('autoEnroll')}
              onChange={(v) => form.setValue('autoEnroll', v)}
              label={<span className="text-[13px] text-muted">Enrol matching active students automatically (department, year, section)</span>}
            />
          </div>
        )}
      </form>
    </Dialog>
  );
}
