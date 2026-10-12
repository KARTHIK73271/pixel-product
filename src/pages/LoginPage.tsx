import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ClipboardCheck, KeyRound, LayoutGrid, Loader2, Lock, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { loginSchema, type LoginInput, type Role } from '@shared/schemas';
import { GoogleIcon } from '@/components/GoogleIcon';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';

interface DemoInfo {
  enabled: boolean;
  password?: string;
  accounts?: { role: Role; email: string; label: string }[];
}

const CAPABILITIES = [
  {
    icon: LayoutGrid,
    title: 'Explainable seating',
    body: 'Minimum-room and balanced plans, each with a review step before anything is published.',
  },
  {
    icon: Users,
    title: 'Room-wise attendance',
    body: 'Finalization locks every sheet; only an admin can reopen one, and the reason is recorded.',
  },
  {
    icon: ShieldCheck,
    title: 'Enforced at the database',
    body: 'Role permissions re-checked by the API and by PostgreSQL row-level security on every query.',
  },
];

/** Messages for `?oauth_error=` codes returned by the server's Google callback. */
const OAUTH_MESSAGES: Record<string, { tone: 'critical' | 'warning' | 'info'; title: string; body: (email?: string) => string }> = {
  cancelled: { tone: 'info', title: 'Google sign-in cancelled', body: () => 'No changes were made. You can try again whenever you’re ready.' },
  not_registered: {
    tone: 'critical',
    title: 'Account not registered',
    body: (email) =>
      `${email ? `${email} is` : 'This Google account is'} not registered with the Examination Section. Access is limited to accounts created by the examination office — ask them to add you.`,
  },
  disabled: { tone: 'critical', title: 'Account disabled', body: () => 'This account has been disabled. Contact the examination office.' },
  identity_mismatch: {
    tone: 'critical',
    title: 'Different Google account',
    body: () => 'This email is linked to another Google account. Sign in with the original account, or ask an admin to unlink it.',
  },
  unverified_email: { tone: 'critical', title: 'Email not verified', body: () => 'Google hasn’t verified this email address, so it can’t be used to sign in.' },
  domain: { tone: 'critical', title: 'Use your university account', body: () => 'Only university Google accounts can sign in here.' },
  state: { tone: 'warning', title: 'Sign-in expired', body: () => 'Your sign-in attempt timed out or couldn’t be verified. Please try again.' },
  rate_limited: { tone: 'warning', title: 'Too many attempts', body: () => 'Too many sign-in attempts from this network. Please wait a few minutes.' },
  not_configured: {
    tone: 'warning',
    title: 'Google sign-in unavailable',
    body: () => 'Google sign-in isn’t configured on this server. Use your email and password, or contact the administrator.',
  },
  failed: { tone: 'critical', title: 'Google sign-in failed', body: () => 'We couldn’t complete sign-in with Google. Please try again.' },
};

const PROOF = [
  { k: 'Seat plans', v: 'Audited' },
  { k: 'Attendance', v: 'Locked' },
  { k: 'Reports', v: 'A4-ready' },
];

export function LoginPage() {
  const { user, login, loginWithGoogle, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [oauth, setOauth] = useState<{ code: string; email?: string } | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const demo = useQuery({ queryKey: ['auth', 'demo'], queryFn: () => api.get<DemoInfo>('/auth/demo'), staleTime: Infinity });
  const providers = useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: () => api.get<{ password: boolean; google: boolean }>('/auth/providers'),
    staleTime: Infinity,
  });
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  // Pick up the result of a Google round-trip, then tidy the URL so a refresh doesn't repeat it.
  useEffect(() => {
    const code = params.get('oauth_error');
    if (!code) return;
    setOauth({ code, email: params.get('email') ?? undefined });
    params.delete('oauth_error');
    params.delete('email');
    setParams(params, { replace: true });
  }, [params, setParams]);

  // Coming back via the browser's back button (bfcache) must not leave the button spinning.
  useEffect(() => {
    const reset = () => setRedirecting(false);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const from = (location.state as { from?: string } | null)?.from;
  const googleReady = providers.data?.google === true;
  const oauthMsg = oauth ? (OAUTH_MESSAGES[oauth.code] ?? OAUTH_MESSAGES.failed) : null;
  const continueWithGoogle = () => {
    setOauth(null);
    setError(null);
    setRedirecting(true);
    loginWithGoogle(from && from !== '/login' ? from : undefined);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setOauth(null);
    try {
      const u = await login(values);
      navigate(from && from !== '/login' ? from : homeFor(u.role), { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <div className="grid min-h-full lg:grid-cols-[1.15fr_1fr]">
      {/* ───────────────────────────────── hero */}
      <section className="relative hidden overflow-hidden border-r border-line/70 lg:flex lg:flex-col lg:justify-between lg:p-14">
        {/* blueprint grid, faded out toward the edges */}
        <div
          className="blueprint pointer-events-none absolute inset-0 opacity-50"
          style={{
            maskImage: 'radial-gradient(ellipse at 28% 42%, black 12%, transparent 68%)',
            WebkitMaskImage: 'radial-gradient(ellipse at 28% 42%, black 12%, transparent 68%)',
          }}
        />
        {/* a slow floating orb for depth */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 top-1/3 h-72 w-72 animate-float rounded-full bg-accent/20 blur-3xl"
        />

        <div className="rise relative flex items-center gap-3">
          <div className="relative">
            <span aria-hidden className="absolute inset-0 rounded-xl bg-accent/50 blur-md" />
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-accent-sweep shadow-inset">
              <ClipboardCheck className="h-5 w-5 text-on-accent" />
            </div>
          </div>
          <div className="leading-tight">
            <p className="display text-[15px]">Smart Examination Section</p>
            <p className="text-2xs tracking-wide text-faint">University Examination Cell</p>
          </div>
        </div>

        <div className="relative max-w-xl">
          <span className="eyebrow inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-accent">
            <Sparkles className="h-3 w-3" /> One audited system
          </span>
          <h1 className="display mt-5 text-[44px] leading-[1.08] text-ink">
            Every room, seat and
            <br />
            attendance mark —{' '}
            <span className="text-gradient">under control.</span>
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-muted">
            Plan examinations, allocate seats with explainable logic, publish schedules, record attendance and generate
            absentee statements — from a single surface, with every change on the record.
          </p>

          <ul className="stagger mt-10 space-y-3">
            {CAPABILITIES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="glass card-hover flex items-start gap-3.5 rounded-xl p-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/20 bg-accent/10">
                  <Icon className="h-4 w-4 text-accent" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-ink">{title}</span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-7">
          {PROOF.map((p) => (
            <div key={p.k}>
              <p className="display text-base text-brass">{p.v}</p>
              <p className="eyebrow mt-0.5">{p.k}</p>
            </div>
          ))}
          <p className="ml-auto text-2xs text-faint">Internal system · Not publicly accessible</p>
        </div>
      </section>

      {/* ───────────────────────────────── sign in */}
      <section className="relative flex items-center justify-center px-4 py-12">
        <div className="rise w-full max-w-sm">
          {/* compact wordmark for small screens, where the hero is hidden */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-sweep">
              <ClipboardCheck className="h-[18px] w-[18px] text-on-accent" />
            </div>
            <span className="display text-[15px]">Smart Examination Section</span>
          </div>

          <div className="glass halo rounded-2xl p-6">
            <h2 className="display text-[22px] text-ink">Sign in</h2>
            <p className="mt-1.5 text-[13px] text-muted">Use your examination section account.</p>

            <div className="mt-5 space-y-3" aria-live="polite">
              {sessionExpired && !oauthMsg && (
                <Callout tone="warning" title="Session expired">
                  For your security you’ve been signed out. Please sign in again.
                </Callout>
              )}
              {oauthMsg && (
                <Callout tone={oauthMsg.tone} title={oauthMsg.title}>
                  {oauthMsg.body(oauth?.email)}
                </Callout>
              )}
            </div>

            {/* Google's branding guidelines: dark theme fill #131314, stroke #8E918F, text #E3E3E3, unaltered logo */}
            <button
              type="button"
              onClick={continueWithGoogle}
              disabled={!googleReady || redirecting}
              aria-describedby={!googleReady && providers.isFetched ? 'google-unavailable' : undefined}
              className="mt-4 flex h-10 w-full items-center justify-center gap-3 rounded-full border border-[#8E918F] bg-[#131314] px-4 text-sm font-medium text-[#E3E3E3] transition-[background-color,box-shadow,transform] duration-200 hover:bg-[#1f1f21] hover:shadow-[0_6px_20px_-10px_rgb(0_0_0/0.9)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-[#131314]"
            >
              {redirecting ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <GoogleIcon className="h-[18px] w-[18px]" />}
              {redirecting ? 'Redirecting to Google…' : 'Continue with Google'}
            </button>
            {!googleReady && providers.isFetched && (
              <p id="google-unavailable" className="mt-2 text-center text-2xs text-faint">
                Google sign-in isn’t configured on this server yet.
              </p>
            )}

            <div className="my-5 flex items-center gap-3 text-2xs uppercase tracking-[0.12em] text-faint" role="separator">
              <span className="h-px flex-1 bg-gradient-to-r from-transparent to-line-strong" />
              or use email
              <span className="h-px flex-1 bg-gradient-to-l from-transparent to-line-strong" />
            </div>

            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              {error && <Callout tone="critical">{error}</Callout>}
              <Field label="Email" error={form.formState.errors.email?.message} htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="name@university.edu"
                  {...form.register('email')}
                  aria-invalid={!!form.formState.errors.email}
                />
              </Field>
              <Field label="Password" error={form.formState.errors.password?.message} htmlFor="password">
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  {...form.register('password')}
                  aria-invalid={!!form.formState.errors.password}
                />
              </Field>
              <Button type="submit" variant="primary" className="h-10 w-full justify-center" loading={form.formState.isSubmitting}>
                Sign in <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            <p className="mt-5 flex items-center justify-center gap-1.5 text-2xs text-faint">
              <Lock className="h-3 w-3" /> Only pre-registered accounts · roles are assigned by the examination office
            </p>
          </div>

          {demo.data?.enabled && (
            <div className="mt-6 rounded-2xl border border-dashed border-warn/35 bg-warn/[0.04] p-4">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-warn">
                <KeyRound className="h-4 w-4" /> Development demo accounts
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                Seeded for local evaluation only and disabled in production. Password for all:{' '}
                <code className="rounded bg-canvas/70 px-1 py-0.5 font-mono text-ink">{demo.data.password}</code>
              </p>
              <div className="mt-3 space-y-1.5">
                {demo.data.accounts?.map((a) => (
                  <button
                    key={a.email}
                    type="button"
                    onClick={() => {
                      form.setValue('email', a.email, { shouldValidate: true });
                      form.setValue('password', demo.data!.password!, { shouldValidate: true });
                    }}
                    className="sheen group relative flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface/70 px-3 py-2.5 text-left text-xs transition-all duration-300 hover:border-accent/40 hover:bg-raised/70"
                  >
                    <span className="font-medium text-ink">{a.label}</span>
                    <span className="flex items-center gap-1.5 font-mono text-faint transition-colors group-hover:text-muted">
                      {a.email}
                      <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
