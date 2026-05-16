"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Info, X } from "lucide-react";
import { useState } from "react";

interface PartialDataBannerProps {
  variant?: "warning" | "info";
  message: string;
  action?: { label: string; onClick: () => void };
  dismissible?: boolean;
  className?: string;
}

export function PartialDataBanner({
  variant = "info",
  message,
  action,
  dismissible = false,
  className,
}: PartialDataBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const isWarning = variant === "warning";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3 text-sm",
        isWarning
          ? "border-alert/30 bg-alert/5 text-foreground"
          : "border-info/30 bg-info/5 text-foreground",
        className
      )}
    >
      {isWarning ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-alert" />
      ) : (
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
      )}

      <span className="flex-1 leading-snug">{message}</span>

      <div className="flex shrink-0 items-center gap-2">
        {action && (
          <Button
            variant="ghost"
            size="sm"
            onClick={action.onClick}
            className={cn(
              "h-auto px-2 py-0.5 text-xs font-medium",
              isWarning
                ? "text-alert hover:text-alert hover:bg-alert/10"
                : "text-info hover:text-info hover:bg-info/10"
            )}
          >
            {action.label}
          </Button>
        )}
        {dismissible && (
          <button
            onClick={() => setDismissed(true)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Fechar"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
