import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/importstatus", label: "Importstatus" },
  { href: "/review", label: "Review" },
  { href: "/admin/kompetencer", label: "Admin kompetencer" },
  { href: "/opgaveoversigt", label: "Opgaveoversigt" },
  { href: "/hold", label: "Hold" },
  { href: "/laerere", label: "LÃ¦rere" },
  { href: "/fagudbud", label: "Fagudbud" },
  { href: "/kalendere", label: "Kalendere" },
  { href: "/tilstedevaerelse", label: "TilstedevÃ¦relse" },
  { href: "/staa-review", label: "STÃ… review" },
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

