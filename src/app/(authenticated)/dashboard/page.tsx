import type { Metadata } from 'next'
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: 'Visão Geral' }
import { PartialDataBanner } from "@/components/states/partial-data-banner";
import { Button } from "@/components/ui/button";
import { getDashboardKPIs, getCashFlowChart, getFinancialIndicators, getTopExpenseCategories } from "@/server/dashboard";
import { getCostCenters, getBusinessUnits, getLegalEntities, getLeafCategories, getContactOptions } from "@/server/dimensions";
import { DashboardClient } from "./dashboard-client";
import { signOut } from "./actions";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";

function isValidMonth(s?: string): s is string {
  return !!s && /^\d{4}-\d{2}$/.test(s);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const monthParam = isValidMonth(searchParams.month) ? searchParams.month : undefined;

  const [kpis, cashFlow, indicators, topExpenses, costCenters, businessUnits, legalEntities, leafCategories, contactOptions] = await Promise.all([
    getDashboardKPIs(monthParam),
    getCashFlowChart(monthParam),
    getFinancialIndicators(monthParam),
    getTopExpenseCategories(monthParam),
    getCostCenters(),
    getBusinessUnits(),
    getLegalEntities(),
    getLeafCategories(),
    getContactOptions(),
  ]);

  // Base do mês de referência — selecionado pelo usuário ou mês atual.
  const baseDate = monthParam
    ? new Date(Number(monthParam.slice(0, 4)), Number(monthParam.slice(5, 7)) - 1, 1)
    : new Date();
  const selectedMonth = monthParam ?? format(baseDate, "yyyy-MM");
  const mesAtual      = format(baseDate, "MMMM yyyy", { locale: ptBR });
  const monthFrom     = format(startOfMonth(baseDate), "yyyy-MM-dd");
  const monthTo       = format(endOfMonth(baseDate),   "yyyy-MM-dd");
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

      <DashboardClient
        kpis={kpis}
        cashFlow={cashFlow}
        indicators={indicators}
        topExpenses={topExpenses}
        monthRange={{ from: monthFrom, to: monthTo, label: mesAtual }}
        selectedMonth={selectedMonth}
        leafCategories={leafCategories}
        costCenters={costCenters.filter(c => c.isActive)}
        businessUnits={businessUnits.filter(b => b.isActive)}
        legalEntities={legalEntities.filter(l => l.isActive)}
        contactOptions={contactOptions}
      />
    </div>
  );
}
