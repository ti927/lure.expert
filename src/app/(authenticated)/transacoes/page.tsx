import { EmptyState } from "@/components/states/empty-state";
import { ArrowLeftRight } from "lucide-react";

export default function TransacoesPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Transações</h1>
        <p className="text-sm text-muted-foreground mt-1">Maio 2026</p>
      </div>
      <EmptyState
        icon={<ArrowLeftRight className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
        title="Sem transações no período"
        description="Conecte uma conta bancária ou importe um extrato para ver as movimentações."
      />
    </div>
  );
}
