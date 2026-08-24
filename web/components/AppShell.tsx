import Link from "next/link";

const AUTH_ENABLED = Boolean(process.env.SESSION_SECRET);

const links = [
  { label: "Overview", href: "/", key: "overview" },
  { label: "Repositories", href: "/repos", key: "repositories" },
  { label: "Tests", href: "/#fix-first", key: "tests" },
  { label: "Investigations", href: "/#investigations", key: "investigations" },
  { label: "Activity", href: "/#activity", key: "activity" },
];

export default function AppShell({
  children,
  active = "overview",
}: {
  children: React.ReactNode;
  active?: string;
}) {
  return (
    <div className="app-shell flex min-h-screen">
      <aside className="app-nav hidden w-60 shrink-0 border-r lg:flex lg:flex-col">
        <div className="px-6 pb-8 pt-7">
          <Link href="/" className="group block">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 bg-[var(--primary)]" />
              <span className="technical text-sm font-bold tracking-[0.16em] text-[var(--foreground)]">
                FLAKYGUARD
              </span>
            </div>
            <p className="mt-2 max-w-[16ch] text-xs leading-5 text-[var(--muted-foreground)]">
              CI reliability, with evidence.
            </p>
          </Link>
        </div>
        <nav aria-label="Primary" className="px-3">
          <p className="eyebrow px-3 pb-3">Workspace</p>
          <div className="grid gap-1">
            {links.map((link) => (
              <Link
                key={link.key}
                href={link.href}
                className={`flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm transition-colors ${
                  active === link.key
                    ? "bg-[var(--card-strong)] text-[var(--foreground)]"
                    : "text-[var(--muted)] hover:bg-[var(--card)] hover:text-[var(--foreground)]"
                }`}
              >
                <span className="technical w-5 text-[10px] text-[var(--primary)]">
                  {String(links.indexOf(link) + 1).padStart(2, "0")}
                </span>
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
        <div className="mt-auto border-t border-[var(--border)] px-6 py-5">
          <p className="eyebrow">Signal, not noise</p>
          <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
            Deterministic scoring stays separate from AI inference.
          </p>
          {AUTH_ENABLED && (
            <Link
              href="/api/auth/logout"
              className="mt-5 inline-block text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Sign out
            </Link>
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="app-nav flex items-center justify-between border-b px-5 py-4 lg:hidden">
          <Link href="/" className="technical text-xs font-bold tracking-[0.16em]">
            FLAKYGUARD
          </Link>
          {AUTH_ENABLED && (
            <Link href="/api/auth/logout" className="text-xs text-[var(--muted-foreground)]">
              Sign out
            </Link>
          )}
        </div>
        <nav aria-label="Primary" className="app-nav flex gap-1 overflow-x-auto border-b px-4 py-2 lg:hidden">
          {links.map((link) => (
            <Link
              key={link.key}
              href={link.href}
              className={`whitespace-nowrap rounded-sm px-3 py-2 text-xs ${
                active === link.key
                  ? "bg-[var(--card-strong)] text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)]"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </div>
  );
}
