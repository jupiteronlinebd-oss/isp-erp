import type { LoaderFunctionArgs } from "react-router";
import { getCustomerBandwidth } from "../lib/db";
export async function loader({ context, request }: LoaderFunctionArgs) { const env = context.cloudflare.env as Env; const url = new URL(request.url); const cid = url.searchParams.get("customer_id"); const days = parseInt(url.searchParams.get("days")||"30"); if (!cid) return Response.json({ success: false, error: "customer_id required" }, { status: 400 }); return Response.json({ success: true, data: await getCustomerBandwidth(env.DB, +cid, days) }); }
