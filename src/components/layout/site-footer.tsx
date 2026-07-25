import Link from "next/link";

import { legalNav, primaryNav, siteConfig } from "@/lib/site-config";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-muted/40">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div className="max-w-sm">
            <p className="text-base font-semibold">
              <span className="text-primary">Care</span>Bridge
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{siteConfig.tagline}</p>
          </div>

          <nav aria-label="Footer" className="flex gap-12">
            <div>
              <h2 className="text-sm font-semibold">Product</h2>
              <ul className="mt-3 space-y-2">
                {primaryNav.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="rounded text-sm text-muted-foreground hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="text-sm font-semibold">Legal</h2>
              <ul className="mt-3 space-y-2">
                {legalNav.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="rounded text-sm text-muted-foreground hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </div>

        {/*
          Scope disclaimer. CareBridge coordinates logistics only. Stating that
          plainly is both a safety measure and a legal one.
        */}
        <p className="mt-8 border-t border-border pt-6 text-sm text-muted-foreground">
          CareBridge coordinates transportation and non-medical companionship for appointments you
          have already scheduled. It does not provide medical care, medical advice, or emergency
          services. In an emergency, call 911.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Pre-release MVP. Not a covered entity or business associate; no claim of HIPAA compliance
          is made.
        </p>
      </div>
    </footer>
  );
}
