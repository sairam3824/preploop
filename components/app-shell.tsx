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

  function isActive(href: string) {
    return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
  }

  return (
    <div className="app-bg">
      {/* Top bar — brand always visible, nav links visible on ≥640px */}
      <header className="top-nav">
        <div className="nav-inner">
          <span className="brand-text">PrepLoop</span>
          <nav className="nav-links">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className={isActive(item.href) ? "nav-link active" : "nav-link"}>
                {item.label}
              </Link>
            ))}
          </nav>
          {right ? <div className="nav-right">{right}</div> : null}
        </div>
      </header>

      <main className="main-container">
        <div className="page-header">
          <h1 className="page-title">{title}</h1>
          {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
        </div>
        <section className="content-grid">{children}</section>
      </main>

      {/* Bottom tab bar — visible on mobile only (<640px) */}
      <nav className="bottom-nav">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} className={isActive(item.href) ? "active" : ""}>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
