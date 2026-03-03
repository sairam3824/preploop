"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/practice", label: "Practice" },
  { href: "/history", label: "History" }
];

export function AppShell({
  title,
  subtitle,
  right,
  children
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="app-bg">
      <main className="container">
        <header className="hero-card">
          <div>
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {right ? <div className="hero-right">{right}</div> : null}
        </header>

        <section className="content-grid">{children}</section>
      </main>

      <nav className="bottom-nav">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
          return (
            <Link key={item.href} href={item.href} className={isActive ? "active" : ""}>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
