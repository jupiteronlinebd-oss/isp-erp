// ISP ERP — Complete Database Layer
// All D1 query functions for every module

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
}

// ============ DASHBOARD ============

export async function getDashboardStats(db: D1Database) {
  const [customers, activeCustomers, pendingInvoices, openTickets, revenue, devices, lowStock] = await Promise.all([
    db.prepare("SELECT COUNT(*) as c FROM customers").first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) as c FROM customers WHERE status='active'").first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) as c FROM invoices WHERE status IN ('unpaid','overdue')").first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status IN ('open','in_progress')").first<{ c: number }>(),
    db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM payments").first<{ t: number }>(),
    db.prepare("SELECT COUNT(*) as c FROM network_devices WHERE status='online'").first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) as c FROM inventory_items WHERE quantity <= min_quantity").first<{ c: number }>(),
  ]);
  return {
    totalCustomers: customers?.c ?? 0,
    activeCustomers: activeCustomers?.c ?? 0,
    pendingInvoices: pendingInvoices?.c ?? 0,
    openTickets: openTickets?.c ?? 0,
    totalRevenue: revenue?.t ?? 0,
    onlineDevices: devices?.c ?? 0,
    lowStockItems: lowStock?.c ?? 0,
  };
}

// ============ CUSTOMERS ============

export async function getCustomers(db: D1Database, search?: string) {
  if (search) {
    const { results } = await db.prepare(`
      SELECT c.*, p.name as package_name, p.speed_mbps
      FROM customers c LEFT JOIN packages p ON c.package_id = p.id
      WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?
      ORDER BY c.created_at DESC
    `).bind(`%${search}%`, `%${search}%`, `%${search}%`).all();
    return results;
  }
  const { results } = await db.prepare(`
    SELECT c.*, p.name as package_name, p.speed_mbps
    FROM customers c LEFT JOIN packages p ON c.package_id = p.id
    ORDER BY c.created_at DESC
  `).all();
  return results;
}

export async function getCustomer(db: D1Database, id: number) {
  const customer = await db.prepare(`
    SELECT c.*, p.name as package_name, p.speed_mbps, p.price as package_price
    FROM customers c LEFT JOIN packages p ON c.package_id = p.id
    WHERE c.id = ?
  `).bind(id).first();
  const { results: invoices } = await db.prepare("SELECT * FROM invoices WHERE customer_id=? ORDER BY created_at DESC").bind(id).all();
  const { results: tickets } = await db.prepare("SELECT * FROM tickets WHERE customer_id=? ORDER BY created_at DESC").bind(id).all();
  const { results: payments } = await db.prepare("SELECT * FROM payments WHERE customer_id=? ORDER BY payment_date DESC").bind(id).all();
  const { results: bandwidth } = await db.prepare("SELECT * FROM bandwidth_usage WHERE customer_id=? ORDER BY date DESC LIMIT 30").bind(id).all();
  return { customer, invoices, tickets, payments, bandwidth };
}

export async function createCustomer(db: D1Database, d: Record<string, any>) {
  return db.prepare(`INSERT INTO customers (name, phone, email, address, package_id, connection_date, status, monthly_bill, notes) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(d.name, d.phone, d.email||null, d.address||null, d.package_id?+d.package_id:null, d.connection_date||new Date().toISOString().split("T")[0], d.status||"active", d.monthly_bill?+d.monthly_bill:0, d.notes||null).run();
}

export async function updateCustomer(db: D1Database, id: number, d: Record<string, any>) {
  return db.prepare(`UPDATE customers SET name=?, phone=?, email=?, address=?, package_id=?, status=?, monthly_bill=?, balance=?, notes=?, updated_at=datetime('now') WHERE id=?`)
    .bind(d.name, d.phone, d.email||null, d.address||null, d.package_id?+d.package_id:null, d.status, d.monthly_bill?+d.monthly_bill:0, d.balance?+d.balance:0, d.notes||null, id).run();
}

export async function deleteCustomer(db: D1Database, id: number) {
  return db.prepare("DELETE FROM customers WHERE id=?").bind(id).run();
}

// ============ PACKAGES ============

export async function getPackages(db: D1Database) {
  const { results } = await db.prepare(`SELECT p.*, COUNT(c.id) as customer_count FROM packages p LEFT JOIN customers c ON c.package_id=p.id GROUP BY p.id ORDER BY p.price ASC`).all();
  return results;
}

export async function createPackage(db: D1Database, d: Record<string, any>) {
  return db.prepare(`INSERT INTO packages (name, speed_mbps, price, duration_days, description) VALUES (?,?,?,?,?)`).bind(d.name, +d.speed_mbps, +d.price, d.duration_days?+d.duration_days:30, d.description||null).run();
}

export async function deletePackage(db: D1Database, id: number) {
  return db.prepare("DELETE FROM packages WHERE id=?").bind(id).run();
}

// ============ INVOICES ============

export async function getInvoices(db: D1Database) {
  const { results } = await db.prepare(`SELECT i.*, c.name as customer_name, c.phone as customer_phone, p.name as package_name FROM invoices i LEFT JOIN customers c ON i.customer_id=c.id LEFT JOIN packages p ON i.package_id=p.id ORDER BY i.created_at DESC`).all();
  return results;
}

export async function createInvoice(db: D1Database, d: Record<string, any>) {
  const count = await db.prepare("SELECT COUNT(*) as c FROM invoices").first<{ c: number }>();
  const num = `INV-${new Date().getFullYear()}-${String((count?.c??0)+1).padStart(3,"0")}`;
  return db.prepare(`INSERT INTO invoices (invoice_number, customer_id, package_id, amount, status, due_date, notes) VALUES (?,?,?,?,?,?,?)`).bind(num, +d.customer_id, d.package_id?+d.package_id:null, +d.amount, d.status||"unpaid", d.due_date||null, d.notes||null).run();
}

export async function markInvoicePaid(db: D1Database, id: number, method: string) {
  await db.prepare(`UPDATE invoices SET status='paid', paid_date=datetime('now'), payment_method=? WHERE id=?`).bind(method, id).run();
  const inv = await db.prepare("SELECT customer_id, amount FROM invoices WHERE id=?").bind(id).first<{ customer_id: number; amount: number }>();
  if (inv) {
    await db.prepare(`INSERT INTO payments (invoice_id, customer_id, amount, payment_method) VALUES (?,?,?,?)`).bind(id, inv.customer_id, inv.amount, method).run();
    await db.prepare(`INSERT INTO system_logs (level, category, message, entity_type, entity_id) VALUES ('info','billing',?, 'invoice', ?)`).bind(`Invoice ${id} paid via ${method}`, id).run();
  }
}

// ============ TICKETS ============

export async function getTickets(db: D1Database) {
  const { results } = await db.prepare(`SELECT t.*, c.name as customer_name, c.phone as customer_phone, s.name as assigned_name FROM tickets t LEFT JOIN customers c ON t.customer_id=c.id LEFT JOIN staff s ON t.assigned_to=s.id ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`).all();
  return results;
}

export async function getTicket(db: D1Database, id: number) {
  return db.prepare(`SELECT t.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, s.name as assigned_name FROM tickets t LEFT JOIN customers c ON t.customer_id=c.id LEFT JOIN staff s ON t.assigned_to=s.id WHERE t.id=?`).bind(id).first();
}

export async function createTicket(db: D1Database, d: Record<string, any>) {
  const count = await db.prepare("SELECT COUNT(*) as c FROM tickets").first<{ c: number }>();
  const num = `TKT-${String((count?.c??0)+1).padStart(3,"0")}`;
  return db.prepare(`INSERT INTO tickets (ticket_number, customer_id, subject, description, priority, assigned_to) VALUES (?,?,?,?,?,?)`).bind(num, +d.customer_id, d.subject, d.description||null, d.priority||"medium", d.assigned_to?+d.assigned_to:null).run();
}

export async function updateTicketStatus(db: D1Database, id: number, status: string) {
  const resolved = (status === "resolved" || status === "closed") ? "datetime('now')" : "NULL";
  return db.prepare(`UPDATE tickets SET status=?, updated_at=datetime('now'), resolved_at=${resolved} WHERE id=?`).bind(status, id).run();
}

// ============ STAFF ============

export async function getStaff(db: D1Database) {
  const { results } = await db.prepare(`SELECT s.*, COUNT(t.id) as ticket_count FROM staff s LEFT JOIN tickets t ON t.assigned_to=s.id AND t.status IN ('open','in_progress') GROUP BY s.id ORDER BY s.created_at DESC`).all();
  return results;
}

export async function createStaff(db: D1Database, d: Record<string, any>) {
  return db.prepare(`INSERT INTO staff (name, email, phone, role, department, salary) VALUES (?,?,?,?,?,?)`).bind(d.name, d.email, d.phone||null, d.role||"staff", d.department||"operations", d.salary?+d.salary:0).run();
}

export async function deleteStaff(db: D1Database, id: number) {
  return db.prepare("DELETE FROM staff WHERE id=?").bind(id).run();
}

// ============ ATTENDANCE ============

export async function getAttendance(db: D1Database, date?: string) {
  const targetDate = date || new Date().toISOString().split("T")[0];
  const { results } = await db.prepare(`SELECT a.*, s.name as staff_name, s.role FROM employee_attendance a LEFT JOIN staff s ON a.staff_id=s.id WHERE a.date=? ORDER BY s.name ASC`).bind(targetDate).all();
  return { date: targetDate, records: results };
}

export async function createAttendance(db: D1Database, d: Record<string, any>) {
  return db.prepare(`INSERT OR REPLACE INTO employee_attendance (staff_id, date, check_in, check_out, status, work_hours, overtime_hours, notes) VALUES (?,?,?,?,?,?,?,?)`).bind(+d.staff_id, d.date, d.check_in||null, d.check_out||null, d.status||"present", d.work_hours?+d.work_hours:0, d.overtime_hours?+d.overtime_hours:0, d.notes||null).run();
}

// ============ PAYROLL ============

export async function getPayroll(db: D1Database, month?: string) {
  const targetMonth = month || new Date().toISOString().slice(0, 7);
  const { results } = await db.prepare(`SELECT p.*, s.name as staff_name, s.role, s.department FROM payroll p LEFT JOIN staff s ON p.staff_id=s.id WHERE p.month=? ORDER BY s.name ASC`).bind(targetMonth).all(
