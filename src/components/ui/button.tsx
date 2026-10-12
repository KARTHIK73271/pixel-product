import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'brass';
type Size = 'sm' | 'md' | 'icon';

const base =
  'relative inline-flex items-center rounded-lg font-medium whitespace-nowrap select-none ' +
  'transition-[transform,background-color,border-color,box-shadow,color] duration-200 ' +
  'active:translate-y-px active:scale-[0.985] disabled:active:translate-y-0 disabled:active:scale-100';

const variants: Record<Variant, string> = {
  primary:
    'sheen text-white border border-white/10 bg-accent-sweep bg-[length:160%_100%] bg-left ' +
    'shadow-[0_1px_0_0_rgb(255_255_255/0.18)_inset,0_8px_24px_-10px_rgb(var(--accent)/0.7)] ' +
    'hover:bg-right hover:shadow-[0_1px_0_0_rgb(255_255_255/0.22)_inset,0_12px_32px_-10px_rgb(var(--accent)/0.85)] ' +
    'transition-[background-position,box-shadow,transform] duration-500 disabled:opacity-50',
  brass:
    'sheen text-[#2a1d05] border border-brass/40 bg-brass-sweep ' +
    'shadow-[0_1px_0_0_rgb(255_255_255/0.3)_inset,0_8px_24px_-12px_rgb(var(--brass)/0.7)] hover:brightness-110',
  secondary:
    'border border-line bg-raised/70 text-ink backdrop-blur-sm ' +
    'shadow-[0_1px_0_0_rgb(255_255_255/0.05)_inset] hover:border-line-strong hover:bg-raised',
  ghost: 'text-muted hover:bg-raised/70 hover:text-ink',
  danger: 'border border-bad/35 bg-bad/10 text-bad hover:border-bad/55 hover:bg-bad/20',
  subtle: 'border border-accent/25 bg-accent/10 text-accent hover:border-accent/45 hover:bg-accent/16',
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
