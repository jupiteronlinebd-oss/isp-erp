export interface Env { DB: D1Database; CACHE: KVNamespace; }
export async function getDashboardStats(db: D1Database) {
  const [c, ac, pi, ot, rev, dev, ls] = await Promise.all([
    db.prepare("SELECT COUNT(*) as c FROM customers").first<{c:number}>(),
    db.prepare("SELECT COUNT(*) as c FROM customers WHERE status='active'").first<{c:number}>(),
    db.prepare("SELECT COUNT(*) as c FROM invoices WHERE status IN ('unpaid','overdue')").first<{c:number}>(),
    db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status IN ('open','in_progress')").first<{c:number}>(),
    db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM payments").first<{t:number}>(),
    db.prepare("SELECT COUNT(*) as c FROM network_devices WHERE status='online'").first<{c:number}>(),
    db.prepare("SELECT COUNT(*) as c FROM inventory_items WHERE quantity<=min_quantity").first<{c:number}>(),
  ]);
  return { totalCustomers:c?.c??0, activeCustomers:ac?.c??0, pendingInvoices:pi?.c??0, openTickets:ot?.c??0, totalRevenue:rev?.t??0, onlineDevices:dev?.c??0, lowStockItems:ls?.c??0 };
}
export async function getCustomers(db: D1Database, search?: string) {
  if (search) { const {results} = await db.prepare("SELECT c.*, p.name as package_name, p.speed_mbps FROM customers c LEFT JOIN packages p ON c.package_id=p.id WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? ORDER BY c.created_at DESC").bind("%"+search+"%","%"+search+"%","%"+search+"%").all(); return results; }
  const {results} = await db.prepare("SELECT c.*, p.name as package_name, p.speed_mbps FROM customers c LEFT JOIN packages p ON c.package_id=p.id ORDER BY c.created_at DESC").all(); return results;
}
export async function getCustomer(db: D1Database, id: number) {
  const customer = await db.prepare("SELECT c.*, p.name as package_name, p.speed_mbps, p.price as package_price FROM customers c LEFT JOIN packages p ON c.package_id=p.id WHERE c.id=?").bind(id).first();
  const {results:invoices} = await db.prepare("SELECT * FROM invoices WHERE customer_id=? ORDER BY created_at DESC").bind(id).all();
  const {results:tickets} = await db.prepare("SELECT * FROM tickets WHERE customer_id=? ORDER BY created_at DESC").bind(id).all();
  const {results:payments} = await db.prepare("SELECT * FROM payments WHERE customer_id=? ORDER BY payment_date DESC").bind(id).all();
  const {results:bandwidth} = await db.prepare("SELECT * FROM bandwidth_usage WHERE customer_id=? ORDER BY date DESC LIMIT 30").bind(id).all();
  return { customer, invoices, tickets, payments, bandwidth };
}
export async function createCustomer(db: D1Database, d: Record<string,any>) {
  return db.prepare("INSERT INTO customers (name, phone, email, address, package_id, connection_date, status, monthly_bill, notes) VALUES (?,?,?,?,?,?,?,?,?)").bind(d.name, d.phone, d.email||null, d.address||null, d.package_id?+d.package_id:null, d.connection_date||new Date().toISOString().split("T")[0], d.status||"active", d.monthly_bill?+d.monthly_bill:0, d.notes||null).run();
}
export async function updateCustomer(db: D1Database, id: number, d: Record<string,any>) {
  return db.prepare("UPDATE customers SET name=?, phone=?, email=?, address=?, package_id=?, status=?, monthly_bill=?, balance=?, notes=?, updated_at=datetime('now') WHERE id=?").bind(d.name, d.phone, d.email||null, d.address||null, d.package_id?+d.package_id:null, d.status, d.monthly_bill?+d.monthly_bill:0, d.balance?+d.balance:0, d.notes||null, id).run();
}
export async function deleteCustomer(db: D1Database, id: number) { return db.prepare("DELETE FROM customers WHERE id=?").bind(id).run(); }
export async function getPackages(db: D1Database) { const {results} = await db.prepare("SELECT p.*, COUNT(c.id) as customer_count FROM packages p LEFT JOIN customers c ON c.package_id=p.id GROUP BY p.id ORDER BY p.price ASC").all(); return results; }
export async function createPackage(db: D1Database, d: Record<string,any>) { return db.prepare("INSERT INTO packages (name, speed_mbps, price, duration_days, description) VALUES (?,?,?,?,?)").bind(d.name, +d.speed_mbps, +d.price, d.duration_days?+d.duration_days:30, d.description||null).run(); }
export async function deletePackage(db: D1Database, id: number) { return db.prepare("DELETE FROM packages WHERE id=?").bind(id).run(); }
export async function getInvoices(db: D1Database) { const {results} = await db.prepare("SELECT i.*, c.name as customer_name, c.phone as customer_phone, p.name as package_name FROM invoices i LEFT JOIN customers c ON i.customer_id=c.id LEFT JOIN packages p ON i.package_id=p.id ORDER BY i.created_at DESC").all(); return results; }
export async function createInvoice(db: D1Database, d: Record<string,any>) {
  const count = await db.prepare("SELECT COUNT(*) as c FROM invoices").first<{c:number}>();
  const num = "INV-"+new Date().getFullYear()+"-"+String((count?.c??0)+1).padStart(3,"0");
  return db.prepare("INSERT INTO invoices (invoice_number, customer_id, package_id, amount, status, due_date, notes) VALUES (?,?,?,?,?,?,?)").bind(num, +d.customer_id, d.package_id?+d.package_id:null, +d.amount, d.status||"unpaid", d.due_date||null, d.notes||null).run();
}
export async function markInvoicePaid(db: D1Database, id: number, method: string) {
  await db.prepare("UPDATE invoices SET status='paid', paid_date=datetime('now'), payment_method=? WHERE id=?").bind(method, id).run();
  const inv = await db.prepare("SELECT customer_id, amount FROM invoices WHERE id=?").bind(id).first<{customer_id:number;amount:number}>();
  if (inv) { await db.prepare("INSERT INTO payments (invoice_id, customer_id, amount, payment_method) VALUES (?,?,?,?)").bind(id, inv.customer_id, inv.amount, method).run(); }
}
export async function getTickets(db: D1Database) { const {results} = await db.prepare("SELECT t.*, c.name as customer_name, c.phone as customer_phone, s.name as assigned_name FROM tickets t LEFT JOIN customers c ON t.customer_id=c.id LEFT JOIN staff s ON t.assigned_to=s.id ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END").all(); return results; }
export async function getTicket(db: D1Database, id: number) { return db.prepare("SELECT t.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, s.name as assigned_name FROM tickets t LEFT JOIN customers c ON t.customer_id=c.id LEFT JOIN staff s ON t.assigned_to=s.id WHERE t.id=?").bind(id).first(); }
export async function createTicket(db: D1Database, d: Record<string,any>) {
  const count = await db.prepare("SELECT COUNT(*) as c FROM tickets").first<{c:number}>();
  const num = "TKT-"+String((count?.c??0)+1).padStart(3,"0");
  return db.prepare("INSERT INTO tickets (ticket_number, customer_id, subject, description, priority, assigned_to) VALUES (?,?,?,?,?,?)").bind(num, +d.customer_id, d.subject, d.description||null, d.priority||"medium", d.assigned_to?+d.assigned_to:null).run();
}
export async function updateTicketStatus(db: D1Database, id: number, status: string) {
  const r = (status==="resolved"||status==="closed")?"datetime('now')":"NULL";
  return db.prepare("UPDATE tickets SET status=?, updated_at=datetime('now'), resolved_at="+r+" WHERE id=?").bind(status, id).run();
}
export async function getStaff(db: D1Database) { const {results} = await db.prepare("SELECT s.*, COUNT(t.id) as ticket_count FROM staff s LEFT JOIN tickets t ON t.assigned_to=s.id AND t.status IN ('open','in_progress') GROUP BY s.id ORDER BY s.created_at DESC").all(); return results; }
export async function createStaff(db: D1Database, d: Record<string,any>) { return db.prepare("INSERT INTO staff (name, email, phone, role, department, salary) VALUES (?,?,?,?,?,?)").bind(d.name, d.email, d.phone||null, d.role||"staff", d.department||"operations", d.salary?+d.salary:0).run(); }
export async function deleteStaff(db: D1Database, id: number) { return db.prepare("DELETE FROM staff WHERE id=?").bind(id).run(); }
export async function getAttendance(db: D1Database, date?: string) { const d = date||new Date().toISOString().split("T")[0]; const {results} = await db.prepare("SELECT a.*, s.name as staff_name, s.role FROM employee_attendance a LEFT JOIN staff s ON a.staff_id=s.id WHERE a.date=? ORDER BY s.name ASC").bind(d).all(); return { date:d, records:results }; }
export async function createAttendance(db: D1Database, d: Record<string,any>) { return db.prepare("INSERT OR REPLACE INTO employee_attendance (staff_id, date, check_in, check_out, status, work_hours, overtime_hours, notes) VALUES (?,?,?,?,?,?,?,?)").bind(+d.staff_id, d.date, d.check_in||null, d.check_out||null, d.status||"present", d.work_hours?+d.work_hours:0, d.overtime_hours?+d.overtime_hours:0, d.notes||null).run(); }
export async function getPayroll(db: D1Database, month?: string) { const m = month||new Date().toISOString().slice(0,7); const {results} = await db.prepare("SELECT p.*, s.name as staff_name, s.role, s.department FROM payroll p LEFT JOIN staff s ON p.staff_id=s.id WHERE p.month=? ORDER BY s.name ASC").bind(m).all(); return { month:m, records:results }; }
export async function getLeaves(db: D1Database) { const {results} = await db.prepare("SELECT l.*, s.name as staff_name, s.role, a.name as approver_name FROM leave_requests l LEFT JOIN staff s ON l.staff_id=s.id LEFT JOIN staff a ON l.approved_by=a.id ORDER BY l.created_at DESC").all(); return results; }
export async function getDevices(db: D1Database, type?: string) {
  if (type) { const {results} = await db.prepare("SELECT * FROM network_devices WHERE type=? ORDER BY name ASC").bind(type).all(); return results; }
  const {results} = await db.prepare("SELECT * FROM network_devices ORDER BY type, name ASC").all(); return results;
}
export async function getDevice(db: D1Database, id: number) {
  const device = await db.prepare("SELECT * FROM network_devices WHERE id=?").bind(id).first();
  const {results:ports} = await db.prepare("SELECT dp.*, c.name as customer_name FROM device_ports dp LEFT JOIN customers c ON dp.connected_customer_id=c.id WHERE dp.device_id=? ORDER BY dp.port_number ASC").bind(id).all();
  const {results:monitoring} = await db.prepare("SELECT * FROM network_monitoring WHERE device_id=? ORDER BY checked_at DESC LIMIT 50").bind(id).all();
  return { device, ports, monitoring };
}
export async function createDevice(db: D1Database, d: Record<string,any>) { return db.prepare("INSERT INTO network_devices (name, type, brand, model, serial_number, ip_address, mac_address, location, port_count, firmware_version, installed_date, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(d.name, d.type, d.brand||null, d.model||null, d.serial_number||null, d.ip_address||null, d.mac_address||null, d.location||null, d.port_count?+d.port_count:0, d.firmware_version||null, d.installed_date||null, d.notes||null).run(); }
export async function getMonitoringData(db: D1Database) { const {results} = await db.prepare("SELECT m.*, d.name as device_name, d.type as device_type, d.ip_address FROM network_monitoring m JOIN network_devices d ON m.device_id=d.id WHERE m.id IN (SELECT MAX(id) FROM network_monitoring GROUP BY device_id) ORDER BY d.name ASC").all(); return results; }
export async function getInventory(db: D1Database) { const {results} = await db.prepare("SELECT * FROM inventory_items ORDER BY name ASC").all(); return results; }
export async function createInventoryItem(db: D1Database, d: Record<string,any>) { return db.prepare("INSERT INTO inventory_items (name, category, sku, unit, quantity, min_quantity, unit_price, warehouse_location, supplier, notes) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(d.name, d.category, d.sku||null, d.unit||"pcs", +d.quantity, d.min_quantity?+d.min_quantity:5, d.unit_price?+d.unit_price:0, d.warehouse_location||null, d.supplier||null, d.notes||null).run(); }
export async function getBandwidthOverview(db: D1Database) { const {results} = await db.prepare("SELECT b.customer_id, c.name as customer_name, c.phone, p.name as package_name, p.speed_mbps, b.download_mbps, b.upload_mbps, b.total_bytes, b.online_hours, b.date FROM bandwidth_usage b JOIN customers c ON b.customer_id=c.id LEFT JOIN packages p ON c.package_id=p.id WHERE b.date=(SELECT MAX(date) FROM bandwidth_usage) ORDER BY b.total_bytes DESC").all(); return results; }
export async function getCustomerBandwidth(db: D1Database, customerId: number, days: number=30) {
  const {results:daily} = await db.prepare("SELECT * FROM bandwidth_usage WHERE customer_id=? AND date>=date('now',?) ORDER BY date ASC").bind(customerId, "-"+days+" days").all();
  const summary = await db.prepare("SELECT COALESCE(SUM(download_bytes),0) as total_download, COALESCE(SUM(total_bytes),0) as total_data, COALESCE(AVG(download_mbps),0) as avg_download, COALESCE(SUM(online_hours),0) as total_hours FROM bandwidth_usage WHERE customer_id=? AND date>=date('now',?)").bind(customerId, "-"+days+" days").first();
  return { daily, summary };
}
export async function getReportData(db: D1Database) {
  const [rev, cs, pd, ts] = await Promise.all([
    db.prepare("SELECT strftime('%Y-%m', payment_date) as month, SUM(amount) as total FROM payments GROUP BY month ORDER BY month DESC LIMIT 12").all(),
    db.prepare("SELECT status, COUNT(*) as count FROM customers GROUP BY status").all(),
    db.prepare("SELECT p.name, p.speed_mbps, COUNT(c.id) as count FROM packages p LEFT JOIN customers c ON c.package_id=p.id GROUP BY p.id ORDER BY count DESC").all(),
    db.prepare("SELECT status, COUNT(*) as count FROM tickets GROUP BY status").all(),
  ]);
  return { revenueByMonth: rev.results, customersByStatus: cs.results, packagesDistribution: pd.results, ticketStats: ts.results };
}
export async function getLogs(db: D1Database, level?: string, category?: string) {
  let q = "SELECT l.*, s.name as staff_name FROM system_logs l LEFT JOIN staff s ON l.staff_id=s.id";
  const c: string[] = []; const b: any[] = [];
  if (level) { c.push("l.level=?"); b.push(level); }
  if (category) { c.push("l.category=?"); b.push(category); }
  if (c.length) q += " WHERE " + c.join(" AND ");
  q += " ORDER BY l.created_at DESC LIMIT 200";
  const {results} = await db.prepare(q).bind(...b).all(); return results;
}
export async function addLog(db: D1Database, level: string, category: string, message: string, entity_type?: string, entity_id?: number) { return db.prepare("INSERT INTO system_logs (level, category, message, entity_type, entity_id) VALUES (?,?,?, ?, ?)").bind(level, category, message, entity_type||null, entity_id||null).run(); }
export async function getSettings(db: D1Database) { const {results} = await db.prepare("SELECT key, value FROM settings").all<{key:string;value:string}>(); const s: Record<string,string> = {}; for (const r of results) s[r.key] = r.value; return s; }
export async function updateSetting(db: D1Database, key: string, value: string) { return db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?,?,datetime('now'))").bind(key, value).run(); }
export async function getCustomerOrders(db: D1Database, customerId: number) { const {results} = await db.prepare("SELECT o.*, s.name as staff_name FROM customer_orders o LEFT JOIN staff s ON o.staff_id=s.id WHERE o.customer_id=? ORDER BY o.created_at DESC").bind(customerId).all(); return results; }
export async function createOrder(db: D1Database, d: Record<string,any>) {
  const count = await db.prepare("SELECT COUNT(*) as c FROM customer_orders").first<{c:number}>();
  const num = "ORD-"+new Date().getFullYear()+"-"+String((count?.c??0)+1).padStart(4,"0");
  const total = (+d.unit_price * (+d.quantity||1)); const disc = d.discount?+d.discount:0; const final = total-disc;
  const r = await db.prepare("INSERT INTO customer_orders (order_number, customer_id, order_type, reference_type, reference_id, description, quantity, unit_price, total_amount, discount, final_amount, payment_status, payment_method, staff_id, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(num, +d.customer_id, d.order_type, d.reference_type||null, d.reference_id||null, d.description||null, +d.quantity||1, +d.unit_price, total, disc, final, d.payment_status||"pending", d.payment_method||null, d.staff_id||null, d.notes||null).run();
  return { order_number:num, order_id:r.meta?.last_row_id, final_amount:final };
}
export async function getCustomerPurchaseHistory(db: D1Database, customerId: number) {
  const {results:orders} = await db.prepare("SELECT * FROM customer_orders WHERE customer_id=? ORDER BY created_at DESC").bind(customerId).all();
  const {results:invoices} = await db.prepare("SELECT * FROM invoices WHERE customer_id=? ORDER BY created_at DESC").bind(customerId).all();
  const {results:payments} = await db.prepare("SELECT * FROM payments WHERE customer_id=? ORDER BY payment_date DESC").bind(customerId).all();
  const summary = await db.prepare("SELECT COUNT(o.id) as total_orders, COALESCE(SUM(o.final_amount),0) as total_spent FROM customer_orders o WHERE o.customer_id=?").bind(customerId).first();
  return { orders, invoices, payments, summary };
}
