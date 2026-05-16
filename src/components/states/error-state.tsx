"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Detalhes técnicos — colapsados por padrão */
  technical?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "Algo deu errado",
  description = "Não foi possível carregar as informações. Tente novamente.",
  technical,
  onRetry,
  className,
}: ErrorStateProps) {
  const [showTechnical, setShowTechnical] = useState(false);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 px-6 text-center",
        className
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertCircle className="h-6 w-6 text-destructive" strokeWidth={1.5} />
      </div>

      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-xs">{description}</p>

      {onRetry && (
        <Button onClick={onRetry} variant="outline" size="sm" className="mt-4">
          Tentar de novo
        </Button>
      )}

      {technical && (
        <div className="mt-4 w-full max-w-sm text-left">
          <button
            onClick={() => setShowTechnical((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showTechnical ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Detalhes técnicos
          </button>
          {showTechnical && (
            <pre className="mt-2 p-3 rounded-md bg-muted text-xs text-muted-foreground overflow-auto whitespace-pre-wrap break-all">
              {technical}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
