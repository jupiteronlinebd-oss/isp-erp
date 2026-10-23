import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { getCustomers, createCustomer } from "../lib/db";
export async function loader({ context, request }: LoaderFunctionArgs) { const env = context.cloudflare.env as Env; const url = new URL(request.url); const search = url.searchParams.get("q")||undefined; return Response.json({ success: true, data: await getCustomers(env.DB, search) }); }
export async function action({ request, context }: ActionFunctionArgs) { const env = context.cloudflare.env as Env; const d = await request.json(); await createCustomer(env.DB, d); return Response.json({ success: true, message: "Customer created" }); }
