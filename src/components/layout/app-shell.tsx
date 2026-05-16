"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Sidebar } from "./sidebar";
import { ExpertTrigger } from "@/components/expert/expert-trigger";
import { Menu } from "lucide-react";

const STORAGE_KEY = "sidebar-collapsed";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) setCollapsed(stored === "true");
  }, []);

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      {/* Conteúdo — desloca para acomodar sidebar no desktop */}
      <div
        className={cn(
          "flex min-h-screen flex-col transition-all duration-200",
          collapsed ? "md:pl-16" : "md:pl-60",
        )}
      >
        {/* Header mobile */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Abrir menu"
          >
            <Menu size={22} />
          </button>
          <span className="text-base font-bold tracking-tight text-primary">lure.expert</span>
        </header>

        <main className="flex-1">{children}</main>
      </div>

      <ExpertTrigger />
    </div>
  );
}
