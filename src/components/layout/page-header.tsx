interface PageHeaderProps {
  title: string;
  lead?: string;
  eyebrow?: string;
}

/** Consistent top-of-page heading block for content pages. */
export function PageHeader({ title, lead, eyebrow }: PageHeaderProps) {
  return (
    <div className="border-b border-border">
      <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
        {eyebrow ? (
          <p className="text-sm font-semibold tracking-wide text-primary uppercase">{eyebrow}</p>
        ) : null}
        <h1 className="mt-3 text-4xl">{title}</h1>
        {lead ? <p className="mt-5 text-lg text-muted-foreground">{lead}</p> : null}
      </div>
    </div>
  );
}

/** Readable measure column for long-form text. */
export function ContentBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-5 py-12 [&_h2]:text-2xl [&_h3]:text-xl [&_li]:leading-relaxed [&_p]:leading-relaxed">
      {children}
    </div>
  );
}
