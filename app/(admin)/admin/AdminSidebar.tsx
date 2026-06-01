"use client";

/**
 * Admin sidebar · nav for the internal ops surface.
 *
 * Currently one entry (Discovery). New entries land here as we add
 * ops-admin tools (billing reconciliation, user management, etc.).
 * Kept as a client component so `aria-current="page"` reflects the
 * active route without a server round-trip.
 */

import { usePathname } from "next/navigation";
import Link from "next/link";

interface NavItem {
  href: string;
  label: string;
}

const ITEMS: readonly NavItem[] = [
  { href: "/admin/discovery", label: "Discovery" },
  { href: "/admin/cells", label: "Cells" },
  { href: "/admin/businesses", label: "Businesses" },
  { href: "/admin/cron-runs", label: "Cron runs" },
];

export function AdminSidebar() {
  const pathname = usePathname();
  return (
    <nav className="admin-nav" aria-label="Admin sections">
      {ITEMS.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
