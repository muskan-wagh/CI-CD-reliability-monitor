import Link from "next/link";
import UserCard, { TopbarUserButton } from "./UserCard";

const links = [
  { label: "Overview", href: "/", key: "overview", icon: "overview" },
  { label: "Repositories", href: "/repos", key: "repositories", icon: "repositories" },
  { label: "Tests", href: "/#fix-first", key: "tests", icon: "tests" },
  { label: "Investigations", href: "/#investigations", key: "investigations", icon: "investigations" },
  { label: "Activity", href: "/#activity", key: "activity", icon: "activity" },
  { label: "Settings", href: "#", key: "settings", icon: "settings" },
];

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "logo") return <svg {...common}><path d="M12 3 5 6v5c0 4.7 2.8 8.2 7 10 4.2-1.8 7-5.3 7-10V6l-7-3Z" /><path d="m9.4 12 1.7 1.7 3.7-4" /></svg>;
  if (name === "overview") return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>;
  if (name === "repositories") return <svg {...common}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h4l2 2h5A2.5 2.5 0 0 1 20 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Z" /><path d="M4 10h16" /></svg>;
  if (name === "tests") return <svg {...common}><circle cx="12" cy="5" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><path d="M12 7v5m0 0-6 4m6-4 6 4" /></svg>;
  if (name === "investigations") return <svg {...common}><path d="M7 3h8l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v4h4M8 11h8M8 15h5" /></svg>;
  if (name === "activity") return <svg {...common}><path d="M4 12h3l2-5 4 10 2-5h5" /></svg>;
  if (name === "settings") return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.1h-2.5V20a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1A1.7 1.7 0 0 0 8 15a1.7 1.7 0 0 0-1.6-1H6v-2.5h.4A1.7 1.7 0 0 0 8 10a1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.1h2.5V5a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1A1.7 1.7 0 0 0 19.4 10a1.7 1.7 0 0 0 1.6 1h.1v2.5H21a1.7 1.7 0 0 0-1.6 1.5Z" /></svg>;
  if (name === "search") return <svg {...common}><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4 4" /></svg>;
  if (name === "bell") return <svg {...common}><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></svg>;
  if (name === "arrow") return <svg {...common}><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
  return null;
}

export default function AppShell({
  children,
  active = "overview",
}: {
  children: React.ReactNode;
  active?: string;
}) {
  return (
    <div className="app-shell flex min-h-screen">
      <aside className="app-nav hidden w-56 shrink-0 border-r lg:flex lg:flex-col">
        <div className="px-6 pb-8 pt-6">
          <Link href="/" className="group block">
            <div className="flex items-center gap-2.5">
              <span className="text-[var(--foreground)]"><Icon name="logo" size={21} /></span>
              <span className="technical text-[15px] font-bold tracking-[0.04em] text-[var(--foreground)]">
                ECHO
              </span>
            </div>
            <p className="mt-2 max-w-[16ch] text-xs leading-5 text-[var(--muted-foreground)]">
              Every failure leaves a signal.
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
                className={`group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${
                  active === link.key
                    ? "nav-active bg-[var(--card-strong)] text-[var(--foreground)]"
                    : "text-[var(--muted)] hover:bg-[var(--card)] hover:text-[var(--foreground)]"
                }`}
              >
                <span className={`text-[var(--muted)] ${active === link.key ? "text-[var(--primary)]" : "group-hover:text-[var(--foreground)]"}`}><Icon name={link.icon} size={17} /></span>
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
        <div className="mt-auto px-3 pb-5">
          <UserCard />
          <button type="button" className="mt-3 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--card)] hover:text-[var(--foreground)]"><span className="text-lg leading-none">←</span>Collapse</button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="topbar app-nav flex items-center justify-between border-b px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2 lg:hidden"><span className="text-[var(--foreground)]"><Icon name="logo" size={18} /></span><span className="technical text-xs font-bold tracking-[0.08em]">ECHO</span></Link>
          <div className="topbar-spacer hidden lg:block" />
          <div className="flex items-center gap-3">
            <label className="search-box hidden items-center gap-2 rounded-md border px-3 py-2 sm:flex"><span className="text-[var(--muted-foreground)]"><Icon name="search" size={16} /></span><span className="sr-only">Search</span><input aria-label="Search anything" placeholder="Search anything..." /><kbd>⌘ K</kbd></label>
            <button type="button" aria-label="Notifications" className="toolbar-button hidden rounded-md border p-2 text-[var(--muted)] hover:text-[var(--foreground)] sm:block"><Icon name="bell" size={18} /></button>
            <TopbarUserButton />
          </div>
        </header>
        <div className="app-nav flex items-center gap-1 overflow-x-auto border-b px-4 py-2 lg:hidden">
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
        </div>
        {children}
      </div>
    </div>
  );
}
