import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/importstatus", label: "Importstatus" },
  { href: "/review", label: "Review" },
  { href: "/admin/kompetencer", label: "Admin kompetencer" },
  { href: "/admin/opgaveoversigt", label: "Admin opgaveoversigt" },
  { href: "/admin/fag", label: "Admin fag" },
  { href: "/admin/hold", label: "Admin hold" },
  { href: "/admin/fagudbud", label: "Admin fagudbud" },
  { href: "/admin/status", label: "Admin status" },
  { href: "/opgaveoversigt", label: "Opgaveoversigt" },
  { href: "/hold", label: "Hold" },
  { href: "/laerere", label: "Lærere" },
  { href: "/fagudbud", label: "Fagudbud" },
  { href: "/kalendere", label: "Kalendere" },
  { href: "/tilstedevaerelse", label: "Tilstedeværelse" },
  { href: "/staa-review", label: "STÅ review" },
  { href: "/debug/supabase", label: "Debug" }
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href="/" className="brand">
          HEG Scheduler
        </Link>
        <nav className="nav">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}

