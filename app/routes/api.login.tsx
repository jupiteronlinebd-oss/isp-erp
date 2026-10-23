import type { ActionFunctionArgs } from "react-router";
async function hashPassword(p: string): Promise<string> { const e = new TextEncoder(); const d = await crypto.subtle.digest("SHA-256", e.encode(p+"isp-erp-salt")); return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join(""); }
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as Env; const { phone, email, password, login_type } = await request.json();
  if (login_type==="staff"||(!login_type&&!phone)) { const s = await env.DB.prepare("SELECT * FROM staff WHERE email=? OR phone=?").bind(email||phone, email||phone).first<any>(); if (s&&s.is_active) return Response.json({success:true, token:"staff_"+s.id+"_"+Date.now(), user:{id:s.id, name:s.name, email:s.email, role:s.role, type:"staff"}}); }
  if (login_type==="customer"||(!login_type&&phone)) { const c = await env.DB.prepare("SELECT * FROM customers WHERE phone=? OR portal_username=?").bind(phone, phone).first<any>(); if (c&&c.portal_active) { if (password) { const h = await hashPassword(password); if (c.portal_password!==h) return Response.json({success:false, error:"Invalid password"}, {status:401}); } await env.DB.prepare("UPDATE customers SET last_login=datetime('now') WHERE id=?").bind(c.id).run(); return Response.json({success:true, token:"cust_"+c.id+"_"+Date.now(), user:{id:c.id, name:c.name, phone:c.phone, email:c.email, type:"customer", package_id:c.package_id, status:c.status}}); } }
  return Response.json({success:false, error:"Invalid credentials"}, {status:401});
}
