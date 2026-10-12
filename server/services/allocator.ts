/**
 * Deterministic, explainable seating planner (pure — no I/O).
 *
 * Strategies
 * ----------
 * BALANCED   Uses every usable room assigned to the examination and spreads
 *            candidates in proportion to room capacity (largest-remainder
 *            method), so no single room is packed while another is empty.
 *
 * MIN_ROOMS  Uses the fewest rooms that can seat everyone.
 *            1. Minimum room COUNT k: sort capacities descending and take the
 *               shortest prefix whose sum >= N. This is provably optimal — if
 *               any k rooms can seat N candidates, the k largest rooms can too.
 *            2. Tightest subset of exactly k rooms: an exact 0/1 DP over
 *               (rooms used, seats) picks the k-room subset with the smallest
 *               total capacity >= N (least empty seats). When the DP table would
 *               exceed MAX_DP_CELLS we fall back to the k largest rooms; that
 *               still uses the minimum number of rooms but may leave more empty
 *               seats, and the plan is flagged HEURISTIC.
 *
 * Seat numbering: within a room, candidates are spread evenly across seat
 * numbers 1..capacity (seat = floor(i * capacity / assigned) + 1), which keeps
 * gaps between candidates when the room is not full. Seat numbers are unique.
 *
 * Ordering: ROLL orders candidates by department, section, roll number.
 * INTERLEAVE round-robins between departments (or sections if there is only one
 * department) so neighbouring seats belong to different cohorts.
 *
 * Ties are always broken by room number / roll number, so the same input always
 * produces the same plan.
 */
import type { AllocationStrategy, RoomStatus, SeatOrder } from '../../shared/schemas';

export interface PlannerStudent {
  id: string;
  rollNo: string;
  departmentCode: string;
  section: string;
}

export interface PlannerRoom {
  id: string;
  roomNo: string;
  capacity: number;
  status: RoomStatus;
}

export interface RoomPlan {
  roomId: string;
  roomNo: string;
  capacity: number;
  selected: boolean;
  assigned: number;
  utilization: number;
  reason: string;
}

export interface SeatAssignment {
  studentId: string;
  roomId: string;
  seatNo: number;
}

export interface AllocationPlan {
  strategy: AllocationStrategy;
  order: SeatOrder;
  studentCount: number;
  usableCapacity: number;
  selectedCapacity: number;
  feasible: boolean;
  minRoomsRequired: number | null;
  optimality: 'OPTIMAL' | 'HEURISTIC' | 'NOT_APPLICABLE';
  rooms: RoomPlan[];
  assignments: SeatAssignment[];
  unallocatedStudentIds: string[];
  notes: string[];
}

export const MAX_DP_CELLS = 20_000_000;

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function orderStudents<T extends PlannerStudent>(students: T[], order: SeatOrder): T[] {
  const byCohort = [...students].sort(
    (a, b) =>
      collator.compare(a.departmentCode, b.departmentCode) ||
      collator.compare(a.section, b.section) ||
      collator.compare(a.rollNo, b.rollNo),
  );
  if (order === 'ROLL') return byCohort;

  const departments = new Set(byCohort.map((s) => s.departmentCode));
  const keyOf = departments.size > 1 ? (s: T) => s.departmentCode : (s: T) => s.section;
  const groups = new Map<string, T[]>();
  for (const s of byCohort) {
    const k = keyOf(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  const queues = [...groups.entries()].sort((a, b) => collator.compare(a[0], b[0])).map(([, v]) => v);
  const result: T[] = [];
  let remaining = byCohort.length;
  for (let i = 0; remaining > 0; i++) {
    for (const q of queues) {
      if (i < q.length) {
        result.push(q[i]);
        remaining--;
      }
    }
  }
  return result;
}

/** Largest-remainder apportionment of `n` seats over capacities (never exceeds a capacity). */
export function apportion(n: number, capacities: number[]): number[] {
  const total = capacities.reduce((a, b) => a + b, 0);
  if (total === 0 || n === 0) return capacities.map(() => 0);
  if (n >= total) return [...capacities];
  const exact = capacities.map((c) => (n * c) / total);
  const base = exact.map(Math.floor);
  let left = n - base.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left === 0) break;
    if (base[i] < capacities[i]) {
      base[i]++;
      left--;
    }
  }
  return base;
}

/** Evenly spaced, strictly increasing seat numbers within 1..capacity. */
export function spreadSeats(count: number, capacity: number): number[] {
  if (count > capacity) throw new Error('count exceeds capacity');
  return Array.from({ length: count }, (_, i) => Math.floor((i * capacity) / count) + 1);
}

interface MinRoomSelection {
  indices: number[];
  minCount: number;
  optimality: 'OPTIMAL' | 'HEURISTIC';
}

/** Selects the minimum number of rooms (optimal), preferring the tightest total capacity. */
export function selectMinimumRooms(n: number, capacities: number[]): MinRoomSelection {
  const idx = capacities.map((c, i) => ({ c, i })).sort((a, b) => b.c - a.c || a.i - b.i);
  let k = 0;
  let sum = 0;
  while (k < idx.length && sum < n) sum += idx[k++].c;
  if (sum < n) return { indices: idx.map((x) => x.i), minCount: idx.length, optimality: 'OPTIMAL' };
  if (n === 0) return { indices: [], minCount: 0, optimality: 'OPTIMAL' };

  const total = capacities.reduce((a, b) => a + b, 0);
  const rooms = capacities.length;
  if (rooms * k * (total + 1) > MAX_DP_CELLS) {
    return { indices: idx.slice(0, k).map((x) => x.i), minCount: k, optimality: 'HEURISTIC' };
  }

  // reach[j][s]: some subset of j rooms sums to exactly s. choice marks the first room enabling it.
  const width = total + 1;
  const reach = Array.from({ length: k + 1 }, () => new Uint8Array(width));
  const choice = new Uint8Array(rooms * (k + 1) * width);
  reach[0][0] = 1;
  for (let i = 0; i < rooms; i++) {
    const cap = capacities[i];
    for (let j = Math.min(i + 1, k); j >= 1; j--) {
      const prev = reach[j - 1];
      const cur = reach[j];
      for (let s = total; s >= cap; s--) {
        if (prev[s - cap] && !cur[s]) {
          cur[s] = 1;
          choice[(i * (k + 1) + j) * width + s] = 1;
        }
      }
    }
  }
  let best = -1;
  for (let s = n; s <= total; s++) {
    if (reach[k][s]) {
      best = s;
      break;
    }
  }
  const picked: number[] = [];
  let j = k;
  let s = best;
  for (let i = rooms - 1; i >= 0 && j > 0; i--) {
    if (choice[(i * (k + 1) + j) * width + s]) {
      picked.push(i);
      s -= capacities[i];
      j--;
    }
  }
  return { indices: picked.sort((a, b) => a - b), minCount: k, optimality: 'OPTIMAL' };
}

export function planAllocation(input: {
  students: PlannerStudent[];
  rooms: PlannerRoom[];
  strategy: AllocationStrategy;
  order: SeatOrder;
}): AllocationPlan {
  const { strategy, order } = input;
  const students = orderStudents(input.students, order);
  const rooms = [...input.rooms].sort((a, b) => collator.compare(a.roomNo, b.roomNo));
  const usable = rooms.filter((r) => r.status === 'AVAILABLE' && r.capacity > 0);
  const n = students.length;
  const usableCapacity = usable.reduce((a, r) => a + r.capacity, 0);
  const notes: string[] = [];

  let selected: PlannerRoom[];
  let minRoomsRequired: number | null = null;
  let optimality: AllocationPlan['optimality'] = 'NOT_APPLICABLE';
  const reasons = new Map<string, string>();

  if (strategy === 'MIN_ROOMS') {
    const sel = selectMinimumRooms(n, usable.map((r) => r.capacity));
    selected = sel.indices.map((i) => usable[i]);
    optimality = usableCapacity >= n ? sel.optimality : 'NOT_APPLICABLE';
    if (usableCapacity >= n) {
      minRoomsRequired = sel.minCount;
      const desc = usable.map((r) => r.capacity).sort((a, b) => b - a);
      const prev = desc.slice(0, Math.max(0, sel.minCount - 1)).reduce((a, b) => a + b, 0);
      const selCap = selected.reduce((a, r) => a + r.capacity, 0);
      const why =
        sel.minCount <= 1
          ? `Smallest single room that seats all ${n} candidates.`
          : `Part of the tightest ${sel.minCount}-room set (${selCap} seats) for ${n} candidates; the ${sel.minCount - 1} largest rooms together hold only ${prev}.`;
      for (const r of selected) reasons.set(r.id, why);
      for (const r of usable)
        if (!reasons.has(r.id)) reasons.set(r.id, `Not needed — ${sel.minCount} room(s) already seat everyone with fewer empty seats.`);
      notes.push(
        sel.optimality === 'OPTIMAL'
          ? `Minimum room count ${sel.minCount} is optimal; the chosen rooms minimise empty seats among all ${sel.minCount}-room combinations.`
          : `Minimum room count ${sel.minCount} is optimal, but the room choice uses a greedy fallback (largest rooms first) because the exact search was too large; empty seats may not be minimal.`,
      );
    } else {
      for (const r of selected) reasons.set(r.id, 'Every usable room is needed — capacity is short.');
    }
  } else {
    selected = usable;
    for (const r of selected) reasons.set(r.id, 'Balanced strategy uses every assigned room; load is proportional to capacity.');
  }

  for (const r of rooms) {
    if (r.status !== 'AVAILABLE') reasons.set(r.id, `Skipped — room is ${r.status.toLowerCase()}.`);
  }

  const selectedCapacity = selected.reduce((a, r) => a + r.capacity, 0);
  const placeable = Math.min(n, selectedCapacity);
  const quotas = apportion(placeable, selected.map((r) => r.capacity));

  const assignments: SeatAssignment[] = [];
  const assignedByRoom = new Map<string, number>();
  let cursor = 0;
  selected.forEach((room, i) => {
    const seats = spreadSeats(quotas[i], room.capacity);
    for (const seatNo of seats) {
      assignments.push({ studentId: students[cursor].id, roomId: room.id, seatNo });
      cursor++;
    }
    assignedByRoom.set(room.id, quotas[i]);
  });
  const unallocatedStudentIds = students.slice(cursor).map((s) => s.id);

  if (usableCapacity < n) {
    notes.unshift(
      `Insufficient capacity: ${n} candidates but only ${usableCapacity} usable seats. ${n - usableCapacity} candidate(s) remain unallocated — assign more rooms.`,
    );
  }
  if (order === 'INTERLEAVE') notes.push('Candidates are interleaved by cohort so adjacent seats belong to different groups.');
  if (rooms.length > usable.length) notes.push(`${rooms.length - usable.length} assigned room(s) are not available and were skipped.`);

  const selectedIds = new Set(selected.map((r) => r.id));
  return {
    strategy,
    order,
    studentCount: n,
    usableCapacity,
    selectedCapacity,
    feasible: usableCapacity >= n,
    minRoomsRequired,
    optimality,
    rooms: rooms.map((r) => {
      const assigned = assignedByRoom.get(r.id) ?? 0;
      return {
        roomId: r.id,
        roomNo: r.roomNo,
        capacity: r.capacity,
        selected: selectedIds.has(r.id),
        assigned,
        utilization: r.capacity ? assigned / r.capacity : 0,
        reason: reasons.get(r.id) ?? '',
      };
    }),
    assignments,
    unallocatedStudentIds,
    notes,
  };
}

/** Lowest free seat number in a room, or null when full. */
export function nextFreeSeat(capacity: number, taken: Iterable<number>): number | null {
  const used = new Set(taken);
  for (let s = 1; s <= capacity; s++) if (!used.has(s)) return s;
  return null;
}
