import type { LoaderFunctionArgs } from "react-router";
import { getDashboardStats } from "../lib/db";
export async function loader({ context }: LoaderFunctionArgs) { const env = context.cloudflare.env as Env; return Response.json({ success: true, data: await getDashboardStats(env.DB) }); }
