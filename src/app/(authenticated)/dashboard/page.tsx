import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/states/empty-state";
import { PartialDataBanner } from "@/components/states/partial-data-banner";
import { KPICard } from "@/components/financial/kpi-card";
import { Button } from "@/components/ui/button";
import { Landmark } from "lucide-react";
import { signOut } from "./actions";

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Visão Geral</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {user?.email} · Maio 2026
          </p>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
            Sair
          </Button>
        </form>
      </div>

      <PartialDataBanner
        variant="info"
        message="Nenhuma conta bancária conectada. Conecte seu banco para ver dados reais."
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KPICard label="Receita do Mês" value={0} />
        <KPICard label="Despesas" value={0} colorizeValue />
        <KPICard label="Lucro Líquido" value={0} colorizeValue />
        <KPICard label="Saldo em Caixa" value={0} />
      </div>

      <EmptyState
        icon={Landmark}
        title="Nenhuma conta conectada"
        description="Conecte seu banco para começar a ver suas movimentações automaticamente."
      />
    </div>
  );
}
