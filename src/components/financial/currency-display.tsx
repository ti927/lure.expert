import { cn } from "@/lib/utils";

interface CurrencyDisplayProps {
  value: number;
  className?: string;
  /** Aplica verde/vermelho com base no sinal do valor */
  colorize?: boolean;
  /** Exibe o sinal + explicitamente para valores positivos */
  showSign?: boolean;
  /** Tamanho da fonte (herda por padrão) */
  size?: "sm" | "base" | "lg" | "xl" | "2xl" | "3xl" | "4xl";
}

const sizeClasses = {
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
  "3xl": "text-3xl",
  "4xl": "text-4xl",
};

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function CurrencyDisplay({
  value,
  className,
  colorize = false,
  showSign = false,
  size,
}: CurrencyDisplayProps) {
  const formatted = BRL.format(Math.abs(value));
  const isNegative = value < 0;
  const prefix = isNegative ? "-" : showSign && value > 0 ? "+" : "";

  return (
    <span
      className={cn(
        "tabular",
        size && sizeClasses[size],
        colorize && isNegative && "text-negative",
        colorize && !isNegative && value !== 0 && "text-positive",
        colorize && value === 0 && "text-muted-foreground",
        className
      )}
    >
      {prefix}
      {formatted}
    </span>
  );
}
