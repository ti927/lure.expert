import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ConfiguracoesPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Configurações</h1>
        <p className="text-sm text-muted-foreground mt-1">Preferências da empresa e da conta</p>
      </div>
      <Card className="max-w-lg shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Em desenvolvimento</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Configurações de empresa, usuários e integrações disponíveis nas próximas fases.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
