export default function StyleGuidePage() {
  return (
    <div className="min-h-screen bg-background p-8 space-y-16">
      <header className="border-b border-border pb-6">
        <h1 className="text-3xl font-semibold text-foreground">
          lure.expert — Style Guide
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tokens visuais de referência · Fase 0.5.1
        </p>
      </header>

      {/* TIPOGRAFIA */}
      <section className="space-y-4">
        <SectionTitle>Tipografia — Inter</SectionTitle>
        <div className="space-y-3">
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">text-4xl · 36px · semibold</span>
            <p className="text-4xl font-semibold">Receita Bruta do Mês</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">text-3xl · 30px · semibold</span>
            <p className="text-3xl font-semibold">Dashboard Financeiro</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">text-2xl · 24px · semibold</span>
            <p className="text-2xl font-semibold">DRE Gerencial</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">text-xl · 20px · medium</span>
            <p className="text-xl font-medium">Contas a Receber</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">text-base · 16px · regular</span>
            <p className="text-base">Sua margem operacional caiu 4 pontos em maio, de 22% para 18%.</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">text-sm · 14px · regular</span>
            <p className="text-sm text-muted-foreground">Dados sincronizados até hoje 14h32.</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">text-xs · 12px · regular</span>
            <p className="text-xs text-muted-foreground">Última atualização: 16 mai 2026</p>
          </div>
        </div>

        <div className="mt-6 p-4 bg-muted rounded-md space-y-2">
          <p className="text-sm font-medium">tabular-nums — alinhamento de colunas numéricas</p>
          <div className="font-mono text-sm tabular space-y-1">
            <p>R$ 1.234.567,89</p>
            <p>R$    45.678,90</p>
            <p>R$       123,45</p>
          </div>
          <p className="text-xs text-muted-foreground">Use a classe <code className="bg-background px-1 rounded">.tabular</code> em qualquer coluna de números.</p>
        </div>
      </section>

      {/* PALETA DE CORES */}
      <section className="space-y-6">
        <SectionTitle>Paleta de Cores</SectionTitle>

        <div className="space-y-4">
          <ColorGroupLabel>Primária — brand (emerald)</ColorGroupLabel>
          <div className="grid grid-cols-5 md:grid-cols-11 gap-2">
            {[
              { shade: "50", bg: "#ecfdf5", text: "#064e3b" },
              { shade: "100", bg: "#d1fae5", text: "#064e3b" },
              { shade: "200", bg: "#a7f3d0", text: "#064e3b" },
              { shade: "300", bg: "#6ee7b7", text: "#064e3b" },
              { shade: "400", bg: "#34d399", text: "#064e3b" },
              { shade: "500", bg: "#10b981", text: "#fff" },
              { shade: "600", bg: "#059669", text: "#fff" },
              { shade: "700", bg: "#047857", text: "#fff", primary: true },
              { shade: "800", bg: "#065f46", text: "#fff" },
              { shade: "900", bg: "#064e3b", text: "#fff" },
              { shade: "950", bg: "#022c22", text: "#fff" },
            ].map(({ shade, bg, text, primary }) => (
              <div key={shade} className="space-y-1">
                <div
                  className="h-12 rounded-md flex items-end p-1"
                  style={{ backgroundColor: bg }}
                >
                  {primary && (
                    <span className="text-[10px] font-medium" style={{ color: text }}>
                      primary
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground text-center">{shade}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <ColorGroupLabel>Neutra — slate</ColorGroupLabel>
          <div className="grid grid-cols-5 md:grid-cols-11 gap-2">
            {[
              { shade: "50", bg: "#f8fafc" },
              { shade: "100", bg: "#f1f5f9" },
              { shade: "200", bg: "#e2e8f0" },
              { shade: "300", bg: "#cbd5e1" },
              { shade: "400", bg: "#94a3b8" },
              { shade: "500", bg: "#64748b" },
              { shade: "600", bg: "#475569" },
              { shade: "700", bg: "#334155" },
              { shade: "800", bg: "#1e293b" },
              { shade: "900", bg: "#0f172a" },
              { shade: "950", bg: "#020617" },
            ].map(({ shade, bg }) => (
              <div key={shade} className="space-y-1">
                <div
                  className="h-12 rounded-md border border-border"
                  style={{ backgroundColor: bg }}
                />
                <p className="text-xs text-muted-foreground text-center">{shade}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <ColorGroupLabel>Semânticas</ColorGroupLabel>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SemanticColor
              label="Positivo"
              description="emerald-600"
              className="bg-[#059669]"
              token="--color-positive"
              example="+4,2% vs. mês anterior"
            />
            <SemanticColor
              label="Negativo"
              description="rose-600"
              className="bg-[#e11d48]"
              token="--color-negative"
              example="-1,8% vs. mês anterior"
            />
            <SemanticColor
              label="Alerta"
              description="amber-500"
              className="bg-[#f59e0b]"
              token="--color-alert"
              example="Caixa crítico em 12 dias"
            />
            <SemanticColor
              label="Info"
              description="sky-600"
              className="bg-[#0284c7]"
              token="--color-info"
              example="Sincronização em andamento"
            />
          </div>
        </div>

        <div className="space-y-4">
          <ColorGroupLabel>Tokens de interface (CSS variables)</ColorGroupLabel>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <TokenSwatch label="background" className="bg-background border border-border" />
            <TokenSwatch label="foreground" className="bg-foreground" textLight />
            <TokenSwatch label="primary" className="bg-primary" textLight />
            <TokenSwatch label="primary-foreground" className="bg-primary-foreground border border-border" />
            <TokenSwatch label="secondary" className="bg-secondary border border-border" />
            <TokenSwatch label="muted" className="bg-muted border border-border" />
            <TokenSwatch label="muted-foreground" className="bg-muted-foreground" textLight />
            <TokenSwatch label="border" className="bg-border" />
            <TokenSwatch label="destructive" className="bg-destructive" textLight />
            <TokenSwatch label="sidebar" className="bg-sidebar border border-border" />
          </div>
        </div>
      </section>

      {/* BORDER RADIUS */}
      <section className="space-y-4">
        <SectionTitle>Border Radius</SectionTitle>
        <div className="flex flex-wrap gap-6 items-end">
          <RadiusExample label="rounded-sm" description="4px · botões, inputs" className="rounded-sm" />
          <RadiusExample label="rounded-md" description="8px · cards (padrão)" className="rounded-md" />
          <RadiusExample label="rounded-lg" description="12px · modais" className="rounded-lg" />
          <RadiusExample label="rounded-xl" description="16px · uso esporádico" className="rounded-xl" />
          <RadiusExample label="rounded-full" description="pill / badge" className="rounded-full" />
        </div>
      </section>

      {/* SOMBRAS */}
      <section className="space-y-4">
        <SectionTitle>Sombras</SectionTitle>
        <div className="flex flex-wrap gap-8">
          <ShadowExample label="shadow-sm" description="cards, itens de lista" className="shadow-sm" />
          <ShadowExample label="shadow-md" description="popovers, dropdowns" className="shadow-md" />
          <ShadowExample label="shadow-lg" description="modais, painéis" className="shadow-lg" />
        </div>
      </section>

      {/* ESPAÇAMENTO */}
      <section className="space-y-4">
        <SectionTitle>Escala de Espaçamento</SectionTitle>
        <div className="space-y-2">
          {[
            { token: "space-1", px: "4px", size: 1 },
            { token: "space-2", px: "8px", size: 2 },
            { token: "space-3", px: "12px", size: 3 },
            { token: "space-4", px: "16px", size: 4 },
            { token: "space-6", px: "24px", size: 6 },
            { token: "space-8", px: "32px", size: 8 },
            { token: "space-12", px: "48px", size: 12 },
            { token: "space-16", px: "64px", size: 16 },
          ].map(({ token, px, size }) => (
            <div key={token} className="flex items-center gap-4">
              <span className="text-xs text-muted-foreground w-20 tabular">{token}</span>
              <span className="text-xs text-muted-foreground w-12 tabular">{px}</span>
              <div
                className="h-4 bg-primary rounded-sm"
                style={{ width: `${size * 4}px` }}
              />
            </div>
          ))}
        </div>
      </section>

      {/* PESOS DE FONTE */}
      <section className="space-y-4">
        <SectionTitle>Pesos de Fonte</SectionTitle>
        <div className="space-y-3">
          <div className="flex items-baseline gap-4">
            <span className="text-xs text-muted-foreground w-24">400 regular</span>
            <p className="text-xl font-normal">Dados financeiros em tempo real</p>
          </div>
          <div className="flex items-baseline gap-4">
            <span className="text-xs text-muted-foreground w-24">500 medium</span>
            <p className="text-xl font-medium">Dados financeiros em tempo real</p>
          </div>
          <div className="flex items-baseline gap-4">
            <span className="text-xs text-muted-foreground w-24">600 semibold</span>
            <p className="text-xl font-semibold">Dados financeiros em tempo real</p>
          </div>
          <div className="flex items-baseline gap-4">
            <span className="text-xs text-muted-foreground w-24">700 bold</span>
            <p className="text-xl font-bold">Dados financeiros em tempo real</p>
          </div>
        </div>
      </section>

      <footer className="border-t border-border pt-6 text-xs text-muted-foreground">
        Fase 0.5.1 · Design Tokens · Ver <code>docs/DESIGN_TOKENS.md</code> para documentação completa.
      </footer>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-semibold text-foreground border-b border-border pb-2">
      {children}
    </h2>
  );
}

function ColorGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm font-medium text-muted-foreground">{children}</p>
  );
}

function SemanticColor({
  label,
  description,
  className,
  token,
  example,
}: {
  label: string;
  description: string;
  className: string;
  token: string;
  example: string;
}) {
  return (
    <div className="space-y-2">
      <div className={`h-16 rounded-md ${className}`} />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
        <p className="text-xs text-muted-foreground font-mono">{token}</p>
        <p className="text-xs text-muted-foreground mt-1 italic">{example}</p>
      </div>
    </div>
  );
}

function TokenSwatch({
  label,
  className,
  textLight,
}: {
  label: string;
  className: string;
  textLight?: boolean;
}) {
  return (
    <div className={`h-12 rounded-md flex items-center justify-center ${className}`}>
      <span className={`text-xs font-mono ${textLight ? "text-white" : "text-foreground"}`}>
        {label}
      </span>
    </div>
  );
}

function RadiusExample({
  label,
  description,
  className,
}: {
  label: string;
  description: string;
  className: string;
}) {
  return (
    <div className="space-y-2 text-center">
      <div className={`w-20 h-20 bg-primary ${className}`} />
      <p className="text-xs font-mono text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function ShadowExample({
  label,
  description,
  className,
}: {
  label: string;
  description: string;
  className: string;
}) {
  return (
    <div className="space-y-3 text-center">
      <div className={`w-32 h-20 bg-card rounded-md ${className} flex items-center justify-center border border-border`}>
        <span className="text-xs text-muted-foreground font-mono">{label}</span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
