import { Links, Meta, Outlet, Scripts, ScrollRestoration, NavLink, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import type { MetaFunction } from "react-router";
import { getDashboardStats } from "./lib/db";

export const meta: MetaFunction = () => [
  { title: "ISP ERP — Cloudflare" },
  { name: "description", content: "ISP Management System" },
];

export async function loader({ context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as Env;
  const stats = await getDashboardStats(env.DB);
  return { stats };
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f0f2f5; color: #1a1a2e; }
          a { text-decoration: none; color: inherit; }
          :root {
            --primary: #2563eb;
            --sidebar-bg: #1e293b;
            --sidebar-active: #2563eb;
            --card-bg: #ffffff;
            --border: #e2e8f0;
            --green: #16a34a;
            --red: #dc2626;
            --orange: #ea580c;
            --gray: #64748b;
          }
        `}</style>
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

const navItems = [
  { to: "/", label: "ড্যাশবোর্ড", icon: "📊" },
  { to: "/customers", label: "কাস্টমার", icon: "👥" },
  { to: "/packages", label: "প্যাকেজ", icon: "📦" },
  { to: "/billing", label: "বিলিং", icon: "💳" },
  { to: "/tickets", label: "টিকেট", icon: "🎫" },
  { to: "/staff", label: "স্টাফ", icon: "🧑‍💼" },
  { to: "/reports", label: "রিপোর্ট", icon: "📈" },
];

export default function App() {
  const { stats } = useLoaderData<typeof loader>();
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={{ width: "240px", background: "var(--sidebar-bg)", color: "#cbd5e1", flexShrink: 0, position: "sticky", top: 0, height: "100vh", overflowY: "auto" }}>
        <div style={{ padding: "20px 24px", fontSize: "22px", fontWeight: 700, color: "#fff", borderBottom: "1px solid #334155" }}>🌐 ISP ERP</div>
        <nav style={{ padding: "12px 0" }}>
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"} style={({ isActive }) => ({ display: "flex", alignItems: "center", gap: "12px", padding: "12px 24px", color: isActive ? "#fff" : "#94a3b8", background: isActive ? "var(--sidebar-active)" : "transparent", fontWeight: isActive ? 600 : 400, borderLeft: isActive ? "3px solid #60a5fa" : "3px solid transparent" })}>
              <span style={{ fontSize: "18px" }}>{item.icon}</span>{item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main style={{ flex: 1, padding: "24px 32px", overflowY: "auto" }}>
        <Outlet context={{ stats }} />
      </main>
    </div>
  );
}
