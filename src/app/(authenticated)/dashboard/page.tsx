import type { Metadata } from 'next'
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: 'Visão Geral' }
import { PartialDataBanner } from "@/components/states/partial-data-banner";
import { Button } from "@/components/ui/button";
import { getDashboardKPIs, getCashFlowChart, getFinancialIndicators } from "@/server/dashboard";
import { DashboardClient } from "./dashboard-client";
import { signOut } from "./actions";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [kpis, cashFlow, indicators] = await Promise.all([
    getDashboardKPIs(),
    getCashFlowChart(),
    getFinancialIndicators(),
  ]);

  const mesAtual = format(new Date(), "MMMM yyyy", { locale: ptBR });
  const semDados = cashFlow.length === 0 && kpis.saldoCaixa === 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Visão Geral</h1>
          <p className="text-sm text-muted-foreground mt-1 capitalize">
            {user?.email} · {mesAtual}
          </p>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
            Sair
          </Button>
        </form>
      </div>

      {semDados && (
        <PartialDataBanner
          variant="info"
          message="Nenhuma transação confirmada. Conecte seu banco ou importe um arquivo para ver os indicadores."
        />
      )}

      <DashboardClient kpis={kpis} cashFlow={cashFlow} indicators={indicators} />
    </div>
  );
}
