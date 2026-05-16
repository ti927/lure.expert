import { cn } from "@/lib/utils";

type LoadingVariant = "skeleton" | "spinner" | "thinking";

interface LoadingStateProps {
  variant?: LoadingVariant;
  /** Para variant="skeleton": quantas linhas renderizar */
  rows?: number;
  /** Para variant="thinking": nome do agente */
  agentLabel?: string;
  className?: string;
}

export function LoadingState({
  variant = "skeleton",
  rows = 4,
  agentLabel = "expert",
  className,
}: LoadingStateProps) {
  if (variant === "spinner") {
    return (
      <div className={cn("flex items-center justify-center py-8", className)}>
        <Spinner />
      </div>
    );
  }

  if (variant === "thinking") {
    return (
      <div className={cn("flex items-center gap-2 py-3 px-1", className)}>
        <Spinner size="sm" />
        <span className="text-sm text-muted-foreground">
          {agentLabel} está analisando...
        </span>
      </div>
    );
  }

  /* skeleton */
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <div
            className="h-4 animate-pulse rounded bg-muted"
            style={{ width: `${55 + (i % 3) * 15}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function Spinner({ size = "md" }: { size?: "sm" | "md" }) {
  const cls =
    size === "sm"
      ? "h-3.5 w-3.5 border-[1.5px]"
      : "h-5 w-5 border-2";
  return (
    <span
      className={cn(
        "inline-block rounded-full border-primary border-t-transparent animate-spin",
        cls
      )}
      aria-hidden
    />
  );
}
