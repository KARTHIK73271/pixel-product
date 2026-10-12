import type { Queryable } from '../db/index';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  examId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}

/** Writes an append-only audit event; the actor is resolved inside the database from the session. */
export async function audit(q: Queryable, e: AuditInput) {
  await q.query('select app.log_event($1, $2, $3, $4, $5, $6::jsonb)', [
    e.action,
    e.entityType,
    e.entityId ?? null,
    e.examId ?? null,
    e.summary,
    JSON.stringify(e.metadata ?? {}),
  ]);
}

export interface AuditRow {
  id: number;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  examId: string | null;
  examName: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export async function listAudit(
  q: Queryable,
  opts: { examId?: string; action?: string; search?: string; page: number; pageSize: number },
) {
  const p: unknown[] = [];
  const where: string[] = [];
  if (opts.examId) {
    p.push(opts.examId);
    where.push(`a.exam_id = $${p.length}`);
  }
  if (opts.action) {
    p.push(opts.action);
    where.push(`a.action = $${p.length}`);
  }
  if (opts.search) {
    p.push(`%${opts.search}%`);
    where.push(`(a.summary ilike $${p.length} or a.actor_name ilike $${p.length})`);
  }
  p.push(opts.pageSize, (opts.page - 1) * opts.pageSize);
  const r = await q.query<AuditRow & { total: number }>(
    `select a.id, a.actor_name as "actorName", a.actor_role as "actorRole", a.action,
            a.entity_type as "entityType", a.entity_id as "entityId", a.exam_id as "examId",
            e.name as "examName", a.summary, a.metadata, a.created_at as "createdAt",
            count(*) over ()::int as total
       from audit_events a left join examinations e on e.id = a.exam_id
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by a.created_at desc, a.id desc
      limit $${p.length - 1} offset $${p.length}`,
    p,
  );
  return {
    items: r.rows.map(({ total: _t, ...row }) => row),
    total: r.rows[0]?.total ?? 0,
    page: opts.page,
    pageSize: opts.pageSize,
  };
}
