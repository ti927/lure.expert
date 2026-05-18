import { EmptyState } from "@/components/states/empty-state";
import { Landmark, Wrench } from "lucide-react";

export default function ContasPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Contas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bancos e cartões conectados via Open Finance
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <Wrench className="h-4 w-4 mt-0.5 shrink-0" strokeWidth={2} />
        <div className="space-y-1">
          <p className="font-medium">Conexão automática em construção</p>
          <p className="text-amber-900/80">
            A integração com Pluggy está em desenvolvimento. Em breve será possível
            conectar conta corrente e cartão para sincronização diária automática.
            Por enquanto, use a tela de Upload para importar extratos e faturas.
          </p>
        </div>
      </div>

      <EmptyState
        icon={<Landmark className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />}
        title="Nenhuma conta conectada"
        description="Conecte seu banco via Open Finance para sincronizar extratos automaticamente."
      />
    </div>
  );
}
