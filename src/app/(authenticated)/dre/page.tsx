import { EmptyState } from "@/components/states/empty-state";
import { BarChart3 } from "lucide-react";

export default function DrePage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">DRE</h1>
        <p className="text-sm text-muted-foreground mt-1">Demonstrativo de Resultado do Exercício</p>
      </div>
      <EmptyState
        icon={<BarChart3 className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
        title="DRE indisponível"
        description="Categorize suas transações para que o expert monte o demonstrativo automaticamente."
      />
    </div>
  );
}
