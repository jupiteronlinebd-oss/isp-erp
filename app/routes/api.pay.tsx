import type { ActionFunctionArgs } from "react-router";
import { markInvoicePaid } from "../lib/db";
import { notifyPaymentConfirm } from "../lib/sms";
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as Env; const { invoice_id, gateway, amount, customer_id, trx_id, payer_msisdn } = await request.json();
  const gw = await env.DB.prepare("SELECT * FROM payment_gateways WHERE name=? AND is_active=1").bind(gateway).first();
  if (!gw) return Response.json({ success: false, error: "Gateway not active" }, { status: 400 });
  await env.DB.prepare("INSERT INTO gateway_transactions (transaction_id, gateway, customer_id, invoice_id, amount, status, gateway_trx_id, payer_msisdn, completed_at) VALUES (?,?,?,?,?,'success',?,?,datetime('now'))").bind("TXN-"+Date.now(), gateway, customer_id, invoice_id, amount, trx_id, payer_msisdn).run();
  await markInvoicePaid(env.DB, +invoice_id, gateway);
  const inv = await env.DB.prepare("SELECT i.amount, i.invoice_number, c.name, c.phone FROM invoices i JOIN customers c ON i.customer_id=c.id WHERE i.id=?").bind(+invoice_id).first<any>();
  if (inv?.phone) await notifyPaymentConfirm(env.DB, inv.name, inv.phone, inv.amount, inv.invoice_number);
  return Response.json({ success: true, message: "Payment successful", transaction_id: "TXN-"+Date.now(), gateway, amount });
}
