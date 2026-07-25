"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { primaryNav, siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

/**
 * Client Component because it owns the mobile disclosure state. It receives no
 * data and reads nothing from the server - navigation is static config.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
        <Link
          href="/"
          className="rounded-md text-lg font-semibold tracking-tight"
          aria-label={`${siteConfig.name} home`}
        >
          <span className="text-primary">Care</span>Bridge
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {primaryNav.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2.5 text-base transition-colors hover:bg-muted",
                pathname === link.href ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/sign-up">Get started</Link>
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? <X aria-hidden /> : <Menu aria-hidden />}
          <span className="sr-only">{mobileOpen ? "Close menu" : "Open menu"}</span>
        </Button>
      </div>

      {mobileOpen ? (
        <nav
          id="mobile-nav"
          aria-label="Main"
          className="border-t border-border bg-background md:hidden"
        >
          <ul className="mx-auto flex max-w-6xl flex-col gap-1 px-5 py-3">
            {primaryNav.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={pathname === link.href ? "page" : undefined}
                  className="block rounded-md px-3 py-3 text-base hover:bg-muted"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li className="mt-2 flex flex-col gap-2">
              <Button asChild variant="outline">
                <Link href="/sign-in" onClick={() => setMobileOpen(false)}>
                  Sign in
                </Link>
              </Button>
              <Button asChild>
                <Link href="/sign-up" onClick={() => setMobileOpen(false)}>
                  Get started
                </Link>
              </Button>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
