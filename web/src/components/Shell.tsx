"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-0.5 ${className}`}>
      <span className="serif text-2xl leading-none">Apply</span>
      <span className="text-accent text-2xl leading-none font-semibold">.ai</span>
    </span>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-lg text-sm ${path.startsWith(href) ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-paper/80 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
          <Link href="/dashboard"><Logo /></Link>
          <nav className="flex items-center gap-1">
            {link("/dashboard", "Dashboard")}
            {link("/settings", "Settings")}
            <button
              className="px-3 py-1.5 rounded-lg text-sm text-muted hover:text-ink"
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
