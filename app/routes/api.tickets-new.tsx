import type { ActionFunctionArgs } from "react-router";
import { createTicket } from "../lib/db";
export async function action({ request, context }: ActionFunctionArgs) { const env = context.cloudflare.env as Env; const d = await request.json(); await createTicket(env.DB, d); return Response.json({ success: true, message: "Ticket created" }); }
