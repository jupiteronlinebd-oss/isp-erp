export interface SmsConfig { apiUrl: string; apiKey: string; senderId: string; }
export async function getSmsConfig(db: D1Database): Promise<SmsConfig | null> {
  const { results } = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'sms_%'").all<{key:string;value:string}>();
  if (!results.length) return null;
  const cfg: Record<string,string> = {};
  for (const r of results) cfg[r.key] = r.value;
  return { apiUrl: cfg.sms_api_url||"", apiKey: cfg.sms_api_key||"", senderId: cfg.sms_sender_id||"ISP" };
}
export async function sendSms(db: D1Database, phone: string, message: string): Promise<{success:boolean;error?:string}> {
  const config = await getSmsConfig(db);
  if (!config || !config.apiUrl) {
    await db.prepare("INSERT INTO system_logs (level, category, message) VALUES ('warning','system',?)").bind("SMS not sent (no gateway): " + phone).run();
    return { success: false, error: "SMS gateway not configured" };
  }
  try {
    const response = await fetch(config.apiUrl, { method: "POST", headers: {"Content-Type":"application/json","Authorization":"Bearer "+config.apiKey}, body: JSON.stringify({to:phone,message,sender:config.senderId}) });
    if (!response.ok) { await db.prepare("INSERT INTO system_logs (level, category, message) VALUES ('error','system',?)").bind("SMS failed: "+phone).run(); return { success: false, error: "HTTP "+response.status }; }
    await db.prepare("INSERT INTO system_logs (level, category, message) VALUES ('info','system',?)").bind("SMS sent: "+phone).run();
    return { success: true };
  } catch (e: any) { return { success: false, error: e.message }; }
}
export async function notifySuspension(db: D1Database, name: string, phone: string) { return sendSms(db, phone, "Dear "+name+", your connection has been suspended due to unpaid bill. - ISP ERP"); }
export async function notifyPaymentConfirm(db: D1Database, name: string, phone: string, amount: number, inv: string) { return sendSms(db, phone, "Dear "+name+", payment of BDT "+amount+" received for "+inv+". Thank you! - ISP ERP"); }
