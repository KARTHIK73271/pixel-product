# Smart Examination Section Management System

A full-stack system that digitizes the examination workflow end to end:
**exam setup → rooms → intelligent seating allocation → publication → attendance → absentee consolidation → analytics & audit.**

Everything is backed by PostgreSQL with server-enforced roles and Row-Level Security. No business data lives in the browser: every button calls a real API that writes real rows.

---

## Quick start

Requirements: **Node.js 20+** (tested with 22). No Docker, no external database needed.

```bash
npm install
npm run db:reset      # create schema + load the development demo data
npm run dev           # API on :3001, web app on http://localhost:5173
```

Open **http://localhost:5173** and pick a demo account on the login screen.

| Script | What it does |
| --- | --- |
| `npm run dev` | API (`tsx server/index.ts`) + Vite dev server with `/api` proxy |
| `npm run db:migrate` | apply pending SQL migrations |
| `npm run db:seed` | load demo data (refuses to run with `NODE_ENV=production`) |
| `npm run db:reset` | wipe the database and re-seed |
| `npm run build` / `npm start` | type-check + production build; serve API + SPA on `PORT` |
| `npm test` | unit, service, authorization and persistence tests (Vitest) |
| `npm run test:e2e` | browser end-to-end tests (Playwright, first run `npx playwright install chromium`) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |

### Demo accounts (development only)

Created by `npm run db:seed`. They share one password: **`Demo@2026`**. The login screen only offers them when demo mode is on (development); they are never enabled in production.

| Role | Email |
| --- | --- |
| Examination Admin | `admin@exam.local` |
| Examination In-Charge | `priya.raman@exam.local` (A-101, C-301) |
| Examination In-Charge | `arjun.mehta@exam.local` (B-202, A-102) |
| Examination In-Charge | `sanjay.verma@exam.local` (no duties yet) |
| Student | `23cse001@student.exam.local` or any `<rollno>@student.exam.local` (40 students) |

### What the seed contains

3 departments, 5 courses, 40 students (CSE-3A, CSE-3B, ECE-3A), 6 rooms (24–120 seats, one under maintenance), 4 in-charges and 5 examinations, all relative to today:

| Exam | State | Demonstrates |
| --- | --- | --- |
| CS303 Computer Networks (5 days ago) | published, both rooms **finalized** | history, final absentee report |
| CS301 DBMS (today FN) | published; A-101 finalized, **B-202 incomplete (4 unmarked)** | live control center, incomplete-submission rejection |
| EC301 DSP (today AN) | published via **minimum-rooms** plan (B-202 chosen over B-201), attendance not started | min-room optimisation, pending submissions |
| MA301 Probability & Statistics (in 3 days) | **allocation draft**, interleaved CSE/ECE seating | unpublished-allocation privacy |
| CS302 Operating Systems (in 10 days) | setup: 26 eligible, only 24 seats | **capacity-shortage** safeguard |

The seed drives the real service layer as the admin and in-charge users, so it passes every constraint, trigger and RLS policy. It then runs a self-check showing that the database rejects a maintenance room, a duplicate seat, an over-capacity seat, an incomplete submission and an edit to finalized attendance.

---

## Architecture

```
React 18 + TypeScript (Vite, Tailwind, Radix primitives, TanStack Query, react-hook-form + Zod, Recharts)
        │  fetch + httpOnly session cookie + X-Requested-With header      ▲ SSE change feed
        ▼                                                                │
Express API (TypeScript)  ── Zod validation ── role guards ── services ──┘
        │  every request = one transaction:  SET LOCAL ROLE exam_app; app.user_id = <session user>
        ▼
PostgreSQL (embedded PGlite by default, or any PostgreSQL via DATABASE_URL)
   constraints · triggers · Row-Level Security · append-only audit
```

* **Stack choice.** The brief suggested Supabase. Its local stack needs Docker, which this environment didn't have, so the same model is implemented directly on PostgreSQL: SQL migrations, a least-privileged `exam_app` role, RLS policies on every table, and session-derived identity (`app.uid()`, equivalent to Supabase's `auth.uid()`). By default the database is **PGlite**, real PostgreSQL 16 compiled to WASM and persisted on disk. Setting `DATABASE_URL` uses an external PostgreSQL server instead.
* **Defense in depth.** Route guards (`requireRole`) and explicit service checks return clear 401/403 responses. Underneath, every query runs as `exam_app` under RLS, so even a buggy endpoint cannot read another student's seat or another in-charge's room. Integrity rules (capacity, uniqueness, finalization locks, state transitions) live in constraints and triggers, so they hold for any client, including the seed and direct SQL.
* **Shared validation.** `shared/schemas.ts` (Zod) validates forms in the browser and requests on the server.
* **Realtime.** After each successful write the server pushes a topic-only Server-Sent Event (no record data). Clients refetch through the normal authorized API, so dashboards, the control center and attendance sheets update live across browsers. The UI also refetches after its own writes, so correctness never depends on the realtime feed.

```
server/
  migrations/      001_schema.sql · 002_security.sql (role + RLS) · 003_helpers.sql · 004_…sql
  services/        allocator.ts (pure algorithm) · allocation.ts · exams.ts · attendance.ts
                   reports.ts · dashboard.ts (KPIs + safeguards) · catalog.ts · audit.ts
  routes/          auth.ts · api.ts          auth/  password (scrypt) · sessions
  db/              driver adapter · migrator · directory lock + snapshots
  seed/seed.ts     development demo data + validation self-check
shared/schemas.ts  enums + Zod schemas used by client and server
src/               React app: pages per role, UI components, print views
tests/ e2e/        Vitest suites · Playwright scenarios
```

---

## Database schema & integrity

| Table | Purpose / key rules |
| --- | --- |
| `users` | accounts and roles (`ADMIN`, `INCHARGE`, `STUDENT`), scrypt password hashes; unique email |
| `sessions` | SHA-256 of random session tokens, expiry; **no access** for the app role |
| `departments`, `courses` | catalogue; unique codes with format checks |
| `students` | register linked 1:1 to a student login; unique roll number |
| `rooms` | unique room number, `capacity` 1–500, status `AVAILABLE/MAINTENANCE/RETIRED` |
| `examinations` | course, type, cohort, date, session, time, `status DRAFT → ALLOCATED → PUBLISHED`, `is_active`; one active exam per course + type + section |
| `exam_students` | eligibility; **a student sits ≤ 1 active exam per date+session** |
| `exam_rooms` | room bookings; **a room hosts ≤ 1 active exam per date+session**; only `AVAILABLE` rooms |
| `incharge_assignments` | one in-charge per exam room; **an in-charge supervises ≤ 1 room per date+session** |
| `allocations` | `unique(exam, student)`, `unique(exam, room, seat)`, seat must be ≤ room capacity, student must be eligible, room must be booked |
| `attendance_records` | one row per **marked** student (`PRESENT`/`ABSENT`); **unmarked = no row, never absent** |
| `attendance_submissions` | per exam room: `IN_PROGRESS → FINALIZED` only when every seated student is marked; `FINALIZED → IN_PROGRESS` only by an admin with a recorded reason |
| `audit_events` | append-only (update/delete blocked by trigger; no insert grant). Written via `app.log_event()`, which takes the actor from the session |

The per-slot rules use composite foreign keys with `ON UPDATE CASCADE`, which keep `(exam_date, session, exam_active)` in sync on child tables, plus partial unique indexes. Rescheduling or deactivating an exam re-checks every room, student and in-charge conflict automatically. Totals are never stored; every count is computed from these rows.

**Policy decision:** a student cannot sit two different examinations in the same date and session, and a room cannot host two examinations in the same slot (so seat numbers are unique per room per slot). Both are enforced by the database.

### Row-Level Security summary

| Role | Can read | Can write |
| --- | --- | --- |
| Admin | everything | everything (still subject to triggers) |
| In-charge | exams/rooms explicitly assigned to them, and the students seated in those rooms | attendance in their own rooms while not finalized |
| Student | their own student record; **published** exams they are eligible for; their own seat; their own attendance once finalized | nothing |

---

## Seating allocation

`server/services/allocator.ts` is a pure, deterministic function with unit tests.

* **Balanced:** uses every available room booked for the exam and distributes candidates in proportion to capacity (largest-remainder method).
* **Minimum rooms:** (1) The minimum room count *k* is computed by sorting capacities in descending order and taking the shortest prefix that seats everyone. This is **provably optimal**: if any *k* rooms fit N candidates, the *k* largest do. (2) Among all *k*-room subsets, an **exact 0/1 dynamic program** picks the one with the least total capacity ≥ N, i.e. the fewest empty seats. If the DP table would exceed 20M cells, it falls back to the *k* largest rooms. That still uses the minimum count but may leave more empty seats, and the plan is labelled **Heuristic**. A test compares against brute force on 200 random instances.
* **Seat numbers** are spread evenly through each room (`floor(i·capacity/assigned)+1`), leaving gaps when a room isn't full. They are unique and ≤ capacity.
* **Ordering:** by department → section → roll number, or **interleaved** so neighbouring seats belong to different departments or sections.
* **Explainability:** the preview lists every room with its utilization and the reason it was selected or skipped, the minimum room count, optimality, notes and the unallocated candidates.
* **Safety:** the preview is not saved. On commit, the server recomputes the plan inside one transaction (exam row `FOR UPDATE` plus an advisory lock), rejects it if the data changed since the preview (`PLAN_CHANGED`), and replaces the draft atomically. Rooms with any recorded attendance are frozen and keep their seats, so reallocation never destroys attendance. Reallocating a published exam requires confirmation and unpublishes it.

Spec example: 120 students in rooms of 40/50/60 are all seated (32/40/48 balanced). Minimum rooms is 3, because 60 + 50 = 110 < 120.

---

## KPI definitions (admin control center)

All figures are computed live, scoped to **active** examinations matching the filters (date range, exam, course, department, room). The page shows them under *"How metrics are calculated"*.

* **Allocated / unallocated:** seat rows in draft or published allocations; unallocated = eligible − allocated.
* **Utilization:** allocated ÷ capacity of rooms booked by in-scope exams.
* **Capacity issues:** exams whose eligible count exceeds usable booked seats, plus bookings of rooms that aren't available, plus seats beyond capacity (an integrity check that should always be 0).
* **Attendance completion:** marked ÷ allocated, **published** exams only.
* **Final present / absent:** marks in rooms whose submission is finalized.
* **Pending rooms:** occupied rooms of published exams not yet finalized. **Overdue** if the exam date has passed.
* **Pending reports:** published exams dated today or earlier whose absentee statement is still provisional.

---

## Security notes

* Passwords use scrypt (N=16384) with a per-hash salt. Unknown users still incur a hash computation, to avoid timing enumeration. Login is rate-limited per IP + email.
* Session tokens are 256-bit random values stored only as SHA-256 hashes, sent in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production), with a 12 h expiry. Disabling a user ends their access immediately.
* State-changing requests require an `X-Requested-With` header (CSRF defense on top of SameSite). Security headers are set on every response, with a strict CSP in production.
* Errors are mapped to safe messages; internals are logged server-side only.
* No secrets ship to the frontend. The app role cannot read `password_hash` or `sessions`.
* Demo credentials exist only through the development seed, which refuses to run in production unless `ALLOW_DEMO_SEED=true` is set explicitly for a disposable demo.

---

## Tests

```bash
npm test            # Vitest, 50 tests
npm run test:e2e    # Playwright, 5 scenarios against a production build + fresh seeded DB
```

| Suite | Covers |
| --- | --- |
| `tests/allocator.test.ts` (9) | 120/40-50-60 example, minimum-room optimality vs brute force, insufficient capacity, unavailable rooms, determinism, interleaving, unique in-capacity seats |
| `tests/workflows.test.ts` (16) | room over-allocation (API + trigger), capacity shrink guard, maintenance room rejection, insufficient-capacity flow + publish acknowledgement, stale-preview rejection, duplicate student allocation, unique seat, **concurrent allocation requests**, slot policies, duplicate exam, incomplete submission rejection, **dashboard updates after changes**, finalized-attendance lock + admin reopen + audit, reallocation preserving attendance, **absentee totals == records**, provisional reports |
| `tests/security.test.ts` (22) | 401 without session, generic login errors, cookie flags, CSRF header, server validation, disabled accounts, admin-only endpoints, **unassigned-room access**, IDOR on allocation ids, in-charge scoping, **RLS cross-student isolation**, **unpublished allocation privacy**, finalized-only attendance for students, secret/audit protection, un-spoofable audit actor, no identity bleed between concurrent transactions |
| `tests/persistence.test.ts` (3) | **records survive a full restart** (disk), single-owner directory lock, stale-lock takeover |
| `e2e/app.spec.ts` (5) | admin dashboard; resolve shortage → minimum-rooms preview → confirm → assign in-charge → publish; student sees the new seat but not drafts; in-charge refused while unmarked → bulk mark → finalize → **persists after reload**; in-charge blocked from admin pages and other rooms |

---

## Limitations

* **Embedded database.** PGlite is single-process: one server per data directory, enforced by a lock file. It also keeps a last-known-good snapshot (`<dir>.snapshot.tgz`, refreshed every 2 minutes after writes and on shutdown) and restores it automatically if the directory fails to open. Cloud-sync clients (OneDrive and others) can lock files mid-write, so the default location moves out of synced folders. For multi-instance or production deployments use `DATABASE_URL` with a managed PostgreSQL. That adapter shares all SQL and is type-checked, but the test suite runs on PGlite.
* **Realtime** uses an in-process SSE broadcaster, which is fine for a single API instance. Multiple instances would need a shared bus (e.g. PostgreSQL `LISTEN/NOTIFY`).
* **PDF export** uses the browser's print dialog ("Save as PDF") on dedicated A4 print views; no server-side PDF rendering.
* **Notifications** are derived live from operational state (alerts, duties, published seats); there is no per-user read/unread state.
* Attendance can be recorded for any published exam regardless of the clock. The UI warns when the exam is not dated today, since real schedules shift.
* The login rate limiter is in-memory, per process.
