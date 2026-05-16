"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { MessageCircle, X } from "lucide-react";
import { LoadingState } from "@/components/states/loading-state";

export function ExpertTrigger() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-200 hover:bg-primary/90 hover:shadow-xl",
          open && "pointer-events-none opacity-0",
        )}
        aria-label="Abrir expert"
      >
        <MessageCircle size={20} />
      </button>

      {/* Overlay mobile */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Painel do expert */}
      <div
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col border-l border-border bg-background shadow-xl transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full",
        )}
        aria-label="Expert"
      >
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <span className="text-sm font-medium text-foreground">expert</span>
          <button
            onClick={() => setOpen(false)}
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Conteúdo placeholder */}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <LoadingState variant="thinking" />
          <p className="text-xs text-muted-foreground">
            Chat com o expert disponível na Fase 2.
          </p>
        </div>
      </div>
    </>
  );
}
