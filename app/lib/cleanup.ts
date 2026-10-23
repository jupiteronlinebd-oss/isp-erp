export interface CleanupResult { deleted_sessions: number; deleted_daily_usage: number; deleted_monthly_before: number; retained_daily_days: number; retained_session_days: number; ran_at: string; }
export async function getRetentionSettings(db: D1Database) {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{key:string;value:string}>();
  const s: Record<string,string> = {};
  for (const r of results) s[r.key] = r.value;
  return { retention_daily_days: parseInt(s.retention_daily_days||"1095"), retention_session_days: parseInt(s.retention_session_days||"90"), cleanup_enabled: s.cleanup_enabled !== "false" };
}
export async function runAutoCleanup(db: D1Database): Promise<CleanupResult> {
  const config = await getRetentionSettings(db);
  if (!config.cleanup_enabled) return { deleted_sessions: 0, deleted_daily_usage: 0, deleted_monthly_before: 0, retained_daily_days: config.retention_daily_days, retained_session_days: config.retention_session_days, ran_at: new Date().toISOString() };
  const sr = await db.prepare("DELETE FROM bandwidth_sessions WHERE created_at < datetime('now', ?)").bind("-"+config.retention_session_days+" days").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS bandwidth_monthly (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, month TEXT NOT NULL, total_bytes INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), UNIQUE(customer_id, month))").run();
  await db.prepare("INSERT OR REPLACE INTO bandwidth_monthly (customer_id, month, total_bytes) SELECT customer_id, strftime('%Y-%m', date), SUM(total_bytes) FROM bandwidth_usage WHERE date < date('now', ?) GROUP BY customer_id, strftime('%Y-%m', date)").bind("-"+config.retention_daily_days+" days").run();
  const dr = await db.prepare("DELETE FROM bandwidth_usage WHERE date < date('now', ?)").bind("-"+config.retention_daily_days+" days").run();
  await db.prepare("INSERT INTO system_logs (level, category, message, entity_type) VALUES ('info', 'system', ?, 'cleanup')").bind("Auto-cleanup done").run();
  return { deleted_sessions: sr.meta?.changes??0, deleted_daily_usage: dr.meta?.changes??0, deleted_monthly_before: 0, retained_daily_days: config.retention_daily_days, retained_session_days: config.retention_session_days, ran_at: new Date().toISOString() };
}
