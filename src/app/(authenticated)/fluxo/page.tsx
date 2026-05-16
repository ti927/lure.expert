import { EmptyState } from "@/components/states/empty-state";
import { TrendingUp } from "lucide-react";

export default function FluxoPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Fluxo de Caixa</h1>
        <p className="text-sm text-muted-foreground mt-1">Projeção e histórico de entradas e saídas</p>
      </div>
      <EmptyState
        icon={<TrendingUp className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
        title="Fluxo de caixa indisponível"
        description="Conecte seu banco para que o expert projete o fluxo de caixa dos próximos 90 dias."
      />
    </div>
  );
}
