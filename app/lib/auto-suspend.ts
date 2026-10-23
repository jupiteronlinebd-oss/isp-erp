import { notifySuspension } from "./sms";
export interface SuspendResult { checked: number; suspended: number; notified: number; errors: number; ran_at: string; }
export async function runAutoSuspend(db: D1Database): Promise<SuspendResult> {
  const result: SuspendResult = { checked: 0, suspended: 0, notified: 0, errors: 0, ran_at: new Date().toISOString() };
  const { results: overdue } = await db.prepare("SELECT DISTINCT c.id, c.name, c.phone, COUNT(i.id) as oc, COALESCE(SUM(i.amount),0) as td FROM customers c JOIN invoices i ON i.customer_id=c.id WHERE c.status='active' AND i.status IN ('unpaid','overdue') AND i.due_date < date('now') GROUP BY c.id").all<any>();
  result.checked = overdue.length;
  for (const c of overdue) {
    try {
      await db.prepare("UPDATE invoices SET status='overdue' WHERE customer_id=? AND status='unpaid' AND due_date < date('now')").bind(c.id).run();
      const grace = await db.prepare("SELECT value FROM settings WHERE key='suspend_grace_days'").first<{value:string}>();
      const g = parseInt(grace?.value||"7");
      const { results: past } = await db.prepare("SELECT id FROM invoices WHERE customer_id=? AND status='overdue' AND due_date < date('now',?) LIMIT 1").bind(c.id, "-"+g+" days").all();
      if (past.length > 0) {
        await db.prepare("UPDATE customers SET status='suspended', updated_at=datetime('now') WHERE id=?").bind(c.id).run();
        result.suspended++;
        if (c.phone) { const r = await notifySuspension(db, c.name, c.phone); if (r.success) result.notified++; }
        await db.prepare("INSERT INTO system_logs (level, category, message, entity_type, entity_id) VALUES ('warning','billing',?, 'customer', ?)").bind("Auto-suspended: "+c.name, c.id).run();
      }
    } catch (e) { result.errors++; }
  }
  return result;
}
export async function restoreCustomer(db: D1Database, id: number) {
  await db.prepare("UPDATE customers SET status='active', updated_at=datetime('now') WHERE id=?").bind(id).run();
  await db.prepare("INSERT INTO system_logs (level, category, message, entity_type, entity_id) VALUES ('info','billing',?, 'customer', ?)").bind("Customer restored: "+id, id).run();
}
