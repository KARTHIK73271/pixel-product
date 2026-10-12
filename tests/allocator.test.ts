import { describe, expect, it } from 'vitest';
import {
  apportion,
  nextFreeSeat,
  orderStudents,
  planAllocation,
  selectMinimumRooms,
  spreadSeats,
  type PlannerRoom,
  type PlannerStudent,
} from '../server/services/allocator';

const students = (n: number, dept = 'CSE', section = 'A'): PlannerStudent[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${dept}${section}${i}`, rollNo: `23${dept}${String(i + 1).padStart(3, '0')}`, departmentCode: dept, section }));
const room = (roomNo: string, capacity: number, status: PlannerRoom['status'] = 'AVAILABLE'): PlannerRoom => ({ id: roomNo, roomNo, capacity, status });

function assertValidPlan(plan: ReturnType<typeof planAllocation>, rooms: PlannerRoom[]) {
  const cap = new Map(rooms.map((r) => [r.id, r.capacity]));
  const seen = new Set<string>();
  const seats = new Set<string>();
  for (const a of plan.assignments) {
    expect(seen.has(a.studentId), `student ${a.studentId} seated twice`).toBe(false);
    seen.add(a.studentId);
    const key = `${a.roomId}:${a.seatNo}`;
    expect(seats.has(key), `seat ${key} assigned twice`).toBe(false);
    seats.add(key);
    expect(a.seatNo).toBeGreaterThanOrEqual(1);
    expect(a.seatNo).toBeLessThanOrEqual(cap.get(a.roomId)!);
  }
  for (const id of plan.unallocatedStudentIds) expect(seen.has(id)).toBe(false);
}

describe('allocation planner', () => {
  it('seats 120 students in rooms of 40, 50 and 60 within capacity (spec example)', () => {
    const rooms = [room('R40', 40), room('R50', 50), room('R60', 60)];
    for (const strategy of ['BALANCED', 'MIN_ROOMS'] as const) {
      const plan = planAllocation({ students: students(120), rooms, strategy, order: 'ROLL' });
      assertValidPlan(plan, rooms);
      expect(plan.assignments).toHaveLength(120);
      expect(plan.unallocatedStudentIds).toHaveLength(0);
      expect(plan.feasible).toBe(true);
      for (const r of plan.rooms) expect(r.assigned).toBeLessThanOrEqual(r.capacity);
    }
    const min = planAllocation({ students: students(120), rooms, strategy: 'MIN_ROOMS', order: 'ROLL' });
    expect(min.minRoomsRequired).toBe(3); // 60 + 50 = 110 < 120, so all three are needed
    expect(min.optimality).toBe('OPTIMAL');
  });

  it('uses the minimum number of rooms and the tightest combination', () => {
    const rooms = [room('A', 30), room('B', 24), room('C', 60), room('D', 50), room('E', 40)];
    const plan = planAllocation({ students: students(26), rooms, strategy: 'MIN_ROOMS', order: 'ROLL' });
    expect(plan.minRoomsRequired).toBe(1);
    expect(plan.rooms.filter((r) => r.selected).map((r) => r.roomNo)).toEqual(['A']); // 30 is the smallest room ≥ 26
    const plan2 = planAllocation({ students: students(85), rooms, strategy: 'MIN_ROOMS', order: 'ROLL' });
    expect(plan2.minRoomsRequired).toBe(2);
    // smallest pair ≥ 85: 60+30=90 (60+24=84 is too small; 50+40=90 ties — deterministic choice)
    expect(plan2.selectedCapacity).toBe(90);
    assertValidPlan(plan2, rooms);
  });

  it('matches brute force on random instances (minimum count + least empty seats)', () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let t = 0; t < 200; t++) {
      const caps = Array.from({ length: 2 + Math.floor(rand() * 7) }, () => 10 + Math.floor(rand() * 60));
      const n = Math.floor(rand() * caps.reduce((a, b) => a + b, 0)) + 1;
      const sel = selectMinimumRooms(n, caps);
      let bestK = Infinity;
      let bestSum = Infinity;
      for (let mask = 1; mask < 1 << caps.length; mask++) {
        let k = 0;
        let s = 0;
        caps.forEach((c, i) => {
          if (mask & (1 << i)) {
            k++;
            s += c;
          }
        });
        if (s >= n && (k < bestK || (k === bestK && s < bestSum))) {
          bestK = k;
          bestSum = s;
        }
      }
      expect(sel.indices.length).toBe(bestK);
      expect(sel.indices.reduce((a, i) => a + caps[i], 0)).toBe(bestSum);
    }
  });

  it('reports insufficient capacity and leaves the overflow unallocated', () => {
    const rooms = [room('A', 10), room('B', 12)];
    const plan = planAllocation({ students: students(30), rooms, strategy: 'BALANCED', order: 'ROLL' });
    assertValidPlan(plan, rooms);
    expect(plan.feasible).toBe(false);
    expect(plan.assignments).toHaveLength(22);
    expect(plan.unallocatedStudentIds).toHaveLength(8);
    expect(plan.notes[0]).toMatch(/Insufficient capacity/);
  });

  it('skips rooms that are not available', () => {
    const rooms = [room('A', 40), room('LH', 200, 'MAINTENANCE')];
    const plan = planAllocation({ students: students(30), rooms, strategy: 'BALANCED', order: 'ROLL' });
    expect(plan.assignments.every((a) => a.roomId === 'A')).toBe(true);
    expect(plan.rooms.find((r) => r.roomId === 'LH')!.reason).toMatch(/maintenance/);
  });

  it('is deterministic for the same input', () => {
    const rooms = [room('A', 30), room('B', 25)];
    const input = { students: students(40), rooms, strategy: 'BALANCED' as const, order: 'INTERLEAVE' as const };
    expect(planAllocation(input)).toEqual(planAllocation(input));
  });

  it('interleaves departments so neighbours differ', () => {
    const mixed = [...students(5, 'CSE'), ...students(5, 'ECE')];
    const ordered = orderStudents(mixed, 'INTERLEAVE');
    for (let i = 1; i < ordered.length; i++) expect(ordered[i].departmentCode).not.toBe(ordered[i - 1].departmentCode);
  });

  it('apportions proportionally without exceeding capacity', () => {
    expect(apportion(120, [40, 50, 60])).toEqual([32, 40, 48]);
    const a = apportion(37, [10, 11, 30]);
    expect(a.reduce((x, y) => x + y, 0)).toBe(37);
    a.forEach((v, i) => expect(v).toBeLessThanOrEqual([10, 11, 30][i]));
  });

  it('spreads seats uniquely within capacity', () => {
    for (const [count, cap] of [
      [1, 1],
      [10, 40],
      [24, 24],
      [13, 30],
    ]) {
      const s = spreadSeats(count, cap);
      expect(new Set(s).size).toBe(count);
      expect(Math.min(...s)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...s)).toBeLessThanOrEqual(cap);
    }
    expect(() => spreadSeats(5, 4)).toThrow();
    expect(nextFreeSeat(3, [1, 2, 3])).toBeNull();
    expect(nextFreeSeat(5, [1, 3])).toBe(2);
  });
});
