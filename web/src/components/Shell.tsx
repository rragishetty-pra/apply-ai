"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import AutoPair from "@/components/AutoPair";
import ExtensionUpdateBanner from "@/components/ExtensionUpdateBanner";

export function Logo({ className = "", light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={`inline-flex items-baseline text-[26px] font-bold tracking-tight leading-none ${light ? "text-white" : "text-ink"} ${className}`}>
      apply<span className={light ? "text-white/50" : "text-muted"}>.ai</span>
    </span>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${path.startsWith(href) ? "bg-ink text-white" : "text-muted hover:text-ink hover:bg-mist"}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="min-h-screen">
      <header className=" bg-paper/90 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between gap-3">
          <Link href="/dashboard" className="shrink-0"><Logo /></Link>
          <nav className="flex items-center gap-1 overflow-x-auto min-w-0 -mr-4 pr-4">
            {link("/dashboard", "Dashboard")}
            {link("/network", "Network")}
            {link("/coach", "Coach")}
            {link("/achievements", "Achievements")}
            {link("/settings", "Settings")}
            <button
              className="px-4 py-2 rounded-full text-sm font-semibold text-muted hover:text-ink hover:bg-mist"
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
      <AutoPair />
      <ExtensionUpdateBanner />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
