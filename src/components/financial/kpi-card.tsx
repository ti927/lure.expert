import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { CurrencyDisplay } from "./currency-display";
import { PercentageDelta } from "./percentage-delta";

interface KPICardProps {
  label: string;
  value: number;
  valueType?: "currency" | "number" | "percentage";
  /** Comparativo: delta em % em relação ao período anterior */
  delta?: number;
  /** Rótulo do comparativo */
  deltaLabel?: string;
  className?: string;
  /** Coloriza o valor principal com base no sinal */
  colorizeValue?: boolean;
}

const numberFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function KPICard({
  label,
  value,
  valueType = "currency",
  delta,
  deltaLabel = "vs. mês anterior",
  className,
  colorizeValue = false,
}: KPICardProps) {
  return (
    <Card className={cn("shadow-sm", className)}>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground font-medium">{label}</p>
        <div className="mt-1">
          {valueType === "currency" && (
            <CurrencyDisplay
              value={value}
              size="2xl"
              colorize={colorizeValue}
              className="font-semibold"
            />
          )}
          {valueType === "number" && (
            <span className="text-2xl font-semibold tabular">
              {numberFormatter.format(value)}
            </span>
          )}
          {valueType === "percentage" && (
            <span className="text-2xl font-semibold tabular">
              {new Intl.NumberFormat("pt-BR", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }).format(value)}
              %
            </span>
          )}
        </div>
        {delta !== undefined && (
          <div className="mt-2 flex items-center gap-1.5">
            <PercentageDelta value={delta} size="sm" />
            <span className="text-xs text-muted-foreground">{deltaLabel}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
