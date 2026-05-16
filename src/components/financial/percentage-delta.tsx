import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";

interface PercentageDeltaProps {
  value: number;
  className?: string;
  /** Sufixo após o número */
  suffix?: "%" | "pp" | "x";
  /** Exibe ícone de seta */
  showIcon?: boolean;
  size?: "sm" | "base" | "lg";
}

const sizeClasses = {
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
};

const iconSizes = {
  sm: 12,
  base: 14,
  lg: 16,
};

export function PercentageDelta({
  value,
  className,
  suffix = "%",
  showIcon = true,
  size = "base",
}: PercentageDeltaProps) {
  const isPositive = value > 0;
  const isNegative = value < 0;
  const isNeutral = value === 0;

  const formatted = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(value);

  const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular font-medium",
        sizeClasses[size],
        isPositive && "text-positive",
        isNegative && "text-negative",
        isNeutral && "text-muted-foreground",
        className
      )}
    >
      {showIcon && <Icon size={iconSizes[size]} strokeWidth={2.5} />}
      {formatted}
      {suffix}
    </span>
  );
}
