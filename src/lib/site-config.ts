import type { Route } from "next";

import { clientEnv } from "@/lib/env/client";

/**
 * Static, non-sensitive site metadata and navigation.
 *
 * Kept in one place so the header, footer, sitemap and page metadata cannot
 * drift apart. Routes are typed against the app router, so deleting a page
 * breaks the build rather than shipping a dead link.
 */
export const siteConfig = {
  name: clientEnv.NEXT_PUBLIC_APP_NAME,
  url: clientEnv.NEXT_PUBLIC_APP_URL,
  tagline: "Coordinated help for getting to the doctor.",
  description:
    "CareBridge helps families arrange transportation and an optional companion for a family member's existing medical appointment. Every request is reviewed by a real coordinator.",
} as const;

export interface NavLink {
  href: Route;
  label: string;
}

export const primaryNav: readonly NavLink[] = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/safety", label: "Safety" },
];

export const legalNav: readonly NavLink[] = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];
