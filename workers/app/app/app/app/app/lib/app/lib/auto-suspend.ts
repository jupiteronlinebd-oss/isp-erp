import { notifySuspension } from "./sms";

export interface SuspendResult {
  checked: number;
  suspended: number;
  notified: number;
  errors: number;
  ran_at: string;
}

export async function runAutoSuspend(db: D1Database): Promise<SuspendResult> {
  const result: SuspendResult = { checked: 0, suspended: 0, notified: 0, errors: 0, ran_at: new Date().toISOString() };

  const { results: overdueCustomers } = await db.prepare(`
    SELECT DISTINCT c.id, c.name, c.phone, COUNT(i.id) as overdue_count, COALESCE(SUM(i.amount), 0) as total_due
    FROM customers c JOIN invoices i ON i.customer_id = c.id
    WHERE c.status = 'active' AND i.status IN ('unpaid', 'overdue') AND i.due_date IS NOT NULL AND i.due_date < date('now')
    GROUP BY c.id
  `).all<{ id: number; name: string; phone: string; overdue_count: number; total_due: number }>();

  result.checked = overdueCustomers.length;

  for (const customer of overdueCustomers) {
    try {
      await db.prepare(`UPDATE invoices SET status = 'overdue' WHERE customer_id = ? AND status = 'unpaid' AND due_date < date('now')`).bind(customer.id).run();
      const graceDays = await db.prepare("SELECT value FROM settings WHERE key='suspend_grace_days'").first<{ value: string }>();
      const grace = parseInt(graceDays?.value || "7");
      const { results: pastGrace } = await db.prepare(`SELECT id FROM invoices WHERE customer_id = ? AND status = 'overdue' AND due_date < date('now', ?) LIMIT 1`).bind(customer.id, `-${grace} days`).all();

      if (pastGrace.length > 0) {
        await db.prepare("UPDATE customers SET status='suspended', updated_at=datetime('now') WHERE id=?").bind(customer.id).run();
        result.suspended++;
        if (customer.phone) {
          const smsResult = await notifySuspension(db, customer.name, customer.phone);
          if (smsResult.success) result.notified++;
        }
        await db.prepare(`INSERT INTO system_logs (level, category, message, entity_type, entity_id) VALUES ('warning', 'billing', ?, 'customer', ?)`).bind(`Auto-suspended: ${customer.name} (due: BDT ${customer.total_due})`, customer.id).run();
      }
    } catch (e) {
      result.errors++;
    }
  }
  return result;
}

export async function restoreCustomer(db: D1Database, customerId: number) {
  await db.prepare("UPDATE customers SET status='active', updated_at=datetime('now') WHERE id=?").bind(customerId).run();
  await db.prepare(`INSERT INTO system_logs (level, category, message, entity_type, entity_id) VALUES ('info','billing',?, 'customer', ?)`).bind(`Customer restored: ID ${customerId}`, customerId).run();
}
