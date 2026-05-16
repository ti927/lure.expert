import { EmptyState } from "@/components/states/empty-state";
import { Landmark } from "lucide-react";

export default function ContasPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Contas</h1>
        <p className="text-sm text-muted-foreground mt-1">Bancos e cartões conectados</p>
      </div>
      <EmptyState
        icon={Landmark}
        title="Nenhuma conta conectada"
        description="Conecte seu banco via Open Finance para sincronizar extratos automaticamente."
      />
    </div>
  );
}
