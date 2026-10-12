import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'brass';
type Size = 'sm' | 'md' | 'icon';

const base =
  'relative inline-flex items-center rounded-xl font-medium whitespace-nowrap select-none ' +
  'transition-[transform,background-color,border-color,box-shadow,color,filter] duration-200 ' +
  'active:translate-y-px active:scale-[0.985] disabled:active:translate-y-0 disabled:active:scale-100';

// Glass materials live in index.css (.btn-glass*): frosted body, specular top highlight, bright rim.
const variants: Record<Variant, string> = {
  primary: 'sheen btn-glass-primary text-on-accent font-semibold disabled:opacity-50',
  brass:
    'sheen text-[#2a1d05] border border-brass/40 bg-brass-sweep ' +
    'shadow-[0_1px_0_0_rgb(255_255_255/0.3)_inset,0_8px_24px_-12px_rgb(var(--brass)/0.7)] hover:brightness-110',
  secondary: 'sheen btn-glass text-ink',
  ghost: 'text-muted hover:text-ink hover:bg-white/[0.07] hover:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.14)] hover:backdrop-blur-md',
  danger: 'btn-glass-tint border border-bad/45 text-bad hover:border-bad/70 hover:bg-bad/15',
  subtle: 'sheen btn-glass-tint border border-accent/35 text-accent hover:border-accent/60 hover:bg-accent/15',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  icon: 'h-8 w-8 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'md', loading, disabled, children, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(base, 'disabled:cursor-not-allowed disabled:opacity-60', variants[variant], sizes[size], className)}
      {...props}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export function LinkButton({
  to,
  variant = 'secondary',
  size = 'md',
  className,
  children,
  target,
}: {
  to: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
  target?: string;
}) {
  return (
    <Link to={to} target={target} className={cn(base, variants[variant], sizes[size], className)}>
      {children}
    </Link>
  );
}
