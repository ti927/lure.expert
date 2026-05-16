"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyDisplay } from "@/components/financial/currency-display";
import { PercentageDelta } from "@/components/financial/percentage-delta";
import { KPICard } from "@/components/financial/kpi-card";
import { DataTable } from "@/components/financial/data-table";
import { EmptyState } from "@/components/states/empty-state";
import { LoadingState } from "@/components/states/loading-state";
import { ErrorState } from "@/components/states/error-state";
import { ColumnDef } from "@tanstack/react-table";
import { Building2, Landmark, RefreshCw } from "lucide-react";

/* ── DataTable mock ─────────────────────────────────────────────── */
type Transaction = { date: string; description: string; category: string; value: number };

const mockTransactions: Transaction[] = [
  { date: "2026-05-01", description: "Fornecedor ABC Ltda", category: "CMV", value: -12500 },
  { date: "2026-05-03", description: "Cliente XYZ SA — NF 1042", category: "Receita", value: 45000 },
  { date: "2026-05-05", description: "Aluguel Maio", category: "Despesa Administrativa", value: -8200 },
  { date: "2026-05-08", description: "Folha de Pagamento", category: "Pessoal", value: -32000 },
  { date: "2026-05-10", description: "Cliente Beta — NF 1043", category: "Receita", value: 18750 },
  { date: "2026-05-12", description: "Internet e Telefone", category: "Despesa Administrativa", value: -890 },
];

const columns: ColumnDef<Transaction>[] = [
  { accessorKey: "date", header: "Data", cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString("pt-BR") },
  { accessorKey: "description", header: "Descrição", enableSorting: false },
  { accessorKey: "category", header: "Categoria" },
  {
    accessorKey: "value",
    header: "Valor",
    cell: ({ getValue }) => <CurrencyDisplay value={getValue() as number} colorize />,
  },
];

/* ── Page ────────────────────────────────────────────────────────── */
export default function ComponentsStyleGuidePage() {
  const [retryCount, setRetryCount] = useState(0);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background p-8 space-y-16">
        <header className="border-b border-border pb-6">
          <div className="flex items-center gap-3">
            <a href="/style-guide" className="text-sm text-muted-foreground hover:text-foreground">
              ← Style Guide
            </a>
          </div>
          <h1 className="text-3xl font-semibold text-foreground mt-3">
            Biblioteca de Componentes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Fase 0.5.2 · 18 componentes em todas as variantes
          </p>
        </header>

        {/* BOTÕES */}
        <Section title="Button">
          <div className="space-y-4">
            <Row label="Variantes">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
            </Row>
            <Row label="Tamanhos">
              <Button size="sm">Pequeno</Button>
              <Button size="default">Médio</Button>
              <Button size="lg">Grande</Button>
            </Row>
            <Row label="Estados">
              <Button disabled>Desabilitado</Button>
              <Button className="w-40">Largura fixa</Button>
            </Row>
          </div>
        </Section>

        {/* INPUT + LABEL */}
        <Section title="Input + Label">
          <div className="max-w-sm space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="demo-email">E-mail</Label>
              <Input id="demo-email" type="email" placeholder="voce@empresa.com.br" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-valor">Valor</Label>
              <Input id="demo-valor" type="number" placeholder="0,00" className="tabular" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-disabled">Desabilitado</Label>
              <Input id="demo-disabled" disabled value="Valor bloqueado" />
            </div>
          </div>
        </Section>

        {/* SELECT */}
        <Section title="Select">
          <Row label="Padrão">
            <Select>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Selecione a categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="receita">Receita Bruta</SelectItem>
                <SelectItem value="cmv">CMV</SelectItem>
                <SelectItem value="despesa-adm">Despesa Administrativa</SelectItem>
                <SelectItem value="pessoal">Pessoal</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </Section>

        {/* BADGE */}
        <Section title="Badge / Pill">
          <Row label="Variantes">
            <Badge>Padrão</Badge>
            <Badge variant="secondary">Secundário</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Erro</Badge>
          </Row>
          <Row label="Uso financeiro">
            <Badge className="bg-positive/10 text-positive border-positive/20">Receita</Badge>
            <Badge className="bg-negative/10 text-negative border-negative/20">Despesa</Badge>
            <Badge className="bg-alert/10 text-alert border-alert/20">Pendente</Badge>
            <Badge className="bg-info/10 text-info border-info/20">Sincronizando</Badge>
          </Row>
        </Section>

        {/* AVATAR */}
        <Section title="Avatar">
          <Row label="Fallback de iniciais">
            <Avatar>
              <AvatarFallback>JM</AvatarFallback>
            </Avatar>
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-primary text-primary-foreground text-sm">LU</AvatarFallback>
            </Avatar>
            <Avatar className="h-14 w-14">
              <AvatarFallback className="text-base">AB</AvatarFallback>
            </Avatar>
          </Row>
        </Section>

        {/* TABS */}
        <Section title="Tabs">
          <Tabs defaultValue="dre" className="max-w-lg">
            <TabsList>
              <TabsTrigger value="dre">DRE</TabsTrigger>
              <TabsTrigger value="balanco">Balanço</TabsTrigger>
              <TabsTrigger value="fluxo">Fluxo de Caixa</TabsTrigger>
            </TabsList>
            <TabsContent value="dre" className="mt-4">
              <p className="text-sm text-muted-foreground">Conteúdo da DRE</p>
            </TabsContent>
            <TabsContent value="balanco" className="mt-4">
              <p className="text-sm text-muted-foreground">Conteúdo do Balanço</p>
            </TabsContent>
            <TabsContent value="fluxo" className="mt-4">
              <p className="text-sm text-muted-foreground">Conteúdo do Fluxo de Caixa</p>
            </TabsContent>
          </Tabs>
        </Section>

        {/* TOOLTIP */}
        <Section title="Tooltip">
          <Row label="Com botão">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm">Passe o mouse</Button>
              </TooltipTrigger>
              <TooltipContent>Margem EBITDA = EBITDA / Receita Líquida</TooltipContent>
            </Tooltip>
          </Row>
        </Section>

        {/* DIALOG */}
        <Section title="Dialog / Modal">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Abrir modal</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirmar categorização</DialogTitle>
                <DialogDescription>
                  O expert categorizou essa transação como <strong>Despesa Administrativa</strong> com 78% de confiança. Confirma ou ajusta?
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline">Ajustar</Button>
                <Button>Confirmar</Button>
              </div>
            </DialogContent>
          </Dialog>
        </Section>

        {/* CARD */}
        <Section title="Card">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Card padrão</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Conteúdo genérico de card.</p>
              </CardContent>
            </Card>
            <Card className="shadow-sm border-positive/30">
              <CardHeader>
                <CardTitle className="text-base text-positive">Card com status</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Card com borda semântica.</p>
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* CURRENCY DISPLAY */}
        <Section title="CurrencyDisplay">
          <div className="space-y-3">
            <Row label="Padrão">
              <CurrencyDisplay value={125430.5} />
            </Row>
            <Row label="Colorize (positivo)">
              <CurrencyDisplay value={45000} colorize showSign />
            </Row>
            <Row label="Colorize (negativo)">
              <CurrencyDisplay value={-12500} colorize />
            </Row>
            <Row label="Tamanhos">
              <CurrencyDisplay value={98750} size="sm" />
              <CurrencyDisplay value={98750} size="base" />
              <CurrencyDisplay value={98750} size="xl" />
              <CurrencyDisplay value={98750} size="3xl" />
            </Row>
            <Row label="Zero">
              <CurrencyDisplay value={0} colorize />
            </Row>
          </div>
        </Section>

        {/* PERCENTAGE DELTA */}
        <Section title="PercentageDelta">
          <div className="space-y-3">
            <Row label="Positivo">
              <PercentageDelta value={4.2} />
            </Row>
            <Row label="Negativo">
              <PercentageDelta value={-1.8} />
            </Row>
            <Row label="Neutro">
              <PercentageDelta value={0} />
            </Row>
            <Row label="Sem ícone">
              <PercentageDelta value={12.5} showIcon={false} />
              <PercentageDelta value={-3.1} showIcon={false} />
            </Row>
            <Row label="Sufixos">
              <PercentageDelta value={2.3} suffix="pp" />
              <PercentageDelta value={1.5} suffix="x" />
            </Row>
            <Row label="Tamanhos">
              <PercentageDelta value={5.7} size="sm" />
              <PercentageDelta value={5.7} size="base" />
              <PercentageDelta value={5.7} size="lg" />
            </Row>
          </div>
        </Section>

        {/* KPI CARD */}
        <Section title="KPICard">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard
              label="Receita do Mês"
              value={187500}
              delta={8.4}
            />
            <KPICard
              label="Lucro Líquido"
              value={32180}
              delta={-4.1}
              colorizeValue
            />
            <KPICard
              label="Saldo em Caixa"
              value={94200}
            />
            <KPICard
              label="Margem EBITDA"
              value={18.7}
              valueType="percentage"
              delta={2.1}
              deltaLabel="vs. trimestre anterior"
            />
          </div>
        </Section>

        {/* DATA TABLE */}
        <Section title="DataTable">
          <DataTable
            columns={columns}
            data={mockTransactions}
            searchColumn="description"
            searchPlaceholder="Buscar por descrição..."
            pageSize={5}
          />
        </Section>

        {/* EMPTY STATE */}
        <Section title="EmptyState">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="shadow-sm">
              <EmptyState
                icon={Landmark}
                title="Nenhuma conta conectada"
                description="Conecte seu banco para começar a ver suas movimentações automaticamente."
                action={{ label: "Conectar Banco", onClick: () => {} }}
              />
            </Card>
            <Card className="shadow-sm">
              <EmptyState
                icon={Building2}
                title="Sem transações no período"
                description="Nenhuma movimentação encontrada para o filtro selecionado."
              />
            </Card>
            <Card className="shadow-sm">
              <EmptyState
                title="Sem resultados"
                description="Tente ajustar os filtros da busca."
              />
            </Card>
          </div>
        </Section>

        {/* LOADING STATE */}
        <Section title="LoadingState">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="shadow-sm p-6">
              <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">skeleton</p>
              <LoadingState variant="skeleton" rows={5} />
            </Card>
            <Card className="shadow-sm p-6 flex flex-col items-center justify-center min-h-32">
              <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">spinner</p>
              <LoadingState variant="spinner" />
            </Card>
            <Card className="shadow-sm p-6">
              <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider">thinking</p>
              <LoadingState variant="thinking" />
            </Card>
          </div>
        </Section>

        {/* ERROR STATE */}
        <Section title="ErrorState">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="shadow-sm">
              <ErrorState
                title="Não conseguimos atualizar o saldo do Itaú"
                description="Tente novamente ou verifique a conexão com Open Finance."
                onRetry={() => setRetryCount((c) => c + 1)}
                technical={`Error: Request failed with status 503\nGET /api/accounts/sync\n${retryCount > 0 ? `Tentativas: ${retryCount}` : ""}`}
              />
            </Card>
            <Card className="shadow-sm">
              <ErrorState
                title="Arquivo não reconhecido"
                description="O formato do arquivo enviado não é suportado. Use Excel (.xlsx), CSV ou PDF."
              />
            </Card>
          </div>
        </Section>

        <footer className="border-t border-border pt-6 text-xs text-muted-foreground">
          Fase 0.5.2 · Biblioteca de Componentes · 18 componentes
        </footer>
      </div>
    </TooltipProvider>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground border-b border-border pb-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs text-muted-foreground w-32 shrink-0">{label}</span>
      {children}
    </div>
  );
}
