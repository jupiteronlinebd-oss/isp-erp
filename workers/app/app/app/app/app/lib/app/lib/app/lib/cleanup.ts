export interface CleanupResult {
  deleted_sessions: number;
  deleted_daily_usage: number;
  deleted_monthly_before: number;
  retained_daily_days: number;
  retained_session_days: number;
  ran_at: string;
}

export async function getRetentionSettings(db: D1Database) {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const settings: Record<string, string> = {};
  for (const row of results) settings[row.key] = row.value;
  return {
    retention_daily_days: parseInt(settings.retention_daily_days || "1095"),
    retention_session_days: parseInt(settings.retention_session_days || "90"),
    retention_monthly_years: parseInt(settings.retention_monthly_years || "5"),
    cleanup_enabled: settings.cleanup_enabled !== "false",
  };
}

export async function runAutoCleanup(db: D1Database): Promise<CleanupResult> {
  const config = await getRetentionSettings(db);
  if (!config.cleanup_enabled) {
    return { deleted_sessions: 0, deleted_daily_usage: 0, deleted_monthly_before: 0, retained_daily_days: config.retention_daily_days, retained_session_days: config.retention_session_days, ran_at: new Date().toISOString() };
  }

  const sessionResult = await db.prepare(`DELETE FROM bandwidth_sessions WHERE created_at < datetime('now', ?)`).bind(`-${config.retention_session_days} days`).run();
  await archiveMonthlyUsage(db, config.retention_daily_days);
  const dailyResult = await db.prepare(`DELETE FROM bandwidth_usage WHERE date < date('now', ?)`).bind(`-${config.retention_daily_days} days`).run();
  const monthlyResult = await db.prepare(`DELETE FROM bandwidth_monthly WHERE month < date('now', ?)`).bind(`-${config.retention_monthly_years * 365} days`).run();

  await db.prepare(`INSERT INTO system_logs (level, category, message, entity_type) VALUES ('info', 'system', ?, 'cleanup')`).bind(`Auto-cleanup: deleted ${sessionResult.meta?.changes ?? 0} sessions, ${dailyResult.meta?.changes ?? 0} daily, ${monthlyResult.meta?.changes ?? 0} monthly`).run();

  return {
    deleted_sessions: sessionResult.meta?.changes ?? 0,
    deleted_daily_usage: dailyResult.meta?.changes ?? 0,
    deleted_monthly_before: monthlyResult.meta?.changes ?? 0,
    retained_daily_days: config.retention_daily_days,
    retained_session_days: config.retention_session_days,
    ran_at: new Date().toISOString(),
  };
}

async function archiveMonthlyUsage(db: D1Database, retentionDays: number) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS bandwidth_monthly (
    id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, month TEXT NOT NULL,
    total_download_bytes INTEGER DEFAULT 0, total_upload_bytes INTEGER DEFAULT 0, total_bytes INTEGER DEFAULT 0,
    avg_download_mbps REAL DEFAULT 0, peak_download_mbps REAL DEFAULT 0, days_online INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), UNIQUE(customer_id, month)
  )`).run();

  await db.prepare(`INSERT OR REPLACE INTO bandwidth_monthly (customer_id, month, total_download_bytes, total_upload_bytes, total_bytes, avg_download_mbps, peak_download_mbps, days_online)
    SELECT customer_id, strftime('%Y-%m', date) as month, SUM(download_bytes), SUM(upload_bytes), SUM(total_bytes), AVG(download_mbps), MAX(peak_download_mbps), COUNT(DISTINCT date)
    FROM bandwidth_usage WHERE date < date('now', ?) AND date >= date('now', ?) GROUP BY customer_id, strftime('%Y-%m', date)
  `).bind(`-${retentionDays} days`, `-${retentionDays + 365} days`).run();
}

export async function manualCleanup(db: D1Database): Promise<CleanupResult> {
  return runAutoCleanup(db);
}
