import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match system', icon: Monitor },
];

/**
 * Three-way theme control. "System" is a real choice, not a hidden default —
 * someone whose OS flips at sunset wants the app to follow, and that is
 * impossible to express with a two-state switch.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <div
      className={cn('inline-flex items-center gap-0.5 rounded-full border border-line bg-canvas/60 p-0.5', className)}
      role="radiogroup"
      aria-label="Colour theme"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setPreference(value)}
            className={cn(
              'grid h-7 w-7 place-items-center rounded-full transition-all duration-200',
              active ? 'bg-accent text-on-accent shadow-[0_2px_8px_-3px_rgb(var(--accent)/0.8)]' : 'text-faint hover:text-ink',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
