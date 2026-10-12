import { Search } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const control =
  'w-full rounded-lg border border-line bg-canvas/70 px-3 text-sm text-ink placeholder:text-faint ' +
  'shadow-[inset_0_1px_2px_rgb(1_14_10/0.5)] transition-all duration-200 ' +
  'hover:border-line-strong ' +
  'focus:border-accent/70 focus:outline-none focus:ring-[3px] focus:ring-accent/18 focus:bg-canvas/90 ' +
  'disabled:opacity-60 disabled:cursor-not-allowed ' +
  'aria-[invalid=true]:border-bad/70 aria-[invalid=true]:ring-bad/15';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(control, 'h-9', className)} {...p} />
));
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select
    ref={ref}
    className={cn(control, 'h-9 appearance-none bg-no-repeat pr-8', className)}
    style={{
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a96ad' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      backgroundPosition: 'right 10px center',
    }}
    {...p}
  >
    {children}
  </select>
));
Select.displayName = 'Select';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(control, 'min-h-[84px] py-2', className)} {...p} />
));
Textarea.displayName = 'Textarea';

export function Field({
  label,
  error,
  hint,
  children,
  className,
  htmlFor,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-xs text-bad" role="alert">
          <span aria-hidden className="h-1 w-1 rounded-full bg-bad" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn('group relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint transition-colors group-focus-within:text-accent" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" aria-label={placeholder} />
    </div>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex items-center gap-2 text-sm', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-line bg-canvas accent-[rgb(var(--accent))] transition-transform active:scale-90"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
