"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export function Logo({ className = "", light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`display text-[28px] leading-none ${light ? "text-white" : "text-ink"}`}>apply</span>
      <span className="display text-base leading-none bg-accent text-ink border-2 border-ink rounded-full px-2 py-1 -rotate-6 shadow-[2px_2px_0_var(--color-ink)]">
        .ai
      </span>
    </span>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={`px-4 py-1.5 rounded-full text-sm font-bold border-2 ${path.startsWith(href) ? "bg-ink text-white border-ink" : "border-transparent text-muted hover:text-ink hover:border-ink"}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="min-h-screen">
      <header className="border-b-2 border-ink bg-paper/90 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
          <Link href="/dashboard"><Logo /></Link>
          <nav className="flex items-center gap-1">
            {link("/dashboard", "Dashboard")}
            {link("/settings", "Settings")}
            <button
              className="px-4 py-1.5 rounded-full text-sm font-bold text-muted hover:text-ink"
              onClick={async () => {
                await supabaseBrowser().auth.signOut();
                router.replace("/");
              }}
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
