import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'

const tz = { withTimezone: true }

/**
 * Painel configurável (migration 0028).
 *
 * O painel é de um USUÁRIO; o compartilhamento é `dashboard_shares`. Poderia
 * ser uma coluna de visibilidade — mas "decidido na criação" é restrição de
 * tela, e a linha separada permite compartilhar com pessoas específicas sem
 * migration nova.
 */
export const dashboards = pgTable(
  'dashboards',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // Sem FK: `auth.users` vive noutro schema, como em `memberships`.
    ownerUserId: uuid('owner_user_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    isDefault: boolean('is_default').notNull().default(false),
    // Disposição da grade — propriedade do conjunto, não do bloco.
    layout: jsonb('layout').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    ownerSlugIdx: uniqueIndex('idx_dashboards_owner_slug').on(t.organizationId, t.ownerUserId, t.slug),
    orgIdx: index('idx_dashboards_org').on(t.organizationId, t.ownerUserId),
  })
)

/**
 * Um bloco do painel.
 *
 * `spec` guarda apresentação + consulta, no mesmo schema Zod que o motor e a
 * ferramenta MCP usam (`lib/dashboard/block-spec.ts`). O banco aceita qualquer
 * objeto; a garantia é do Zod, aplicada na escrita E na leitura.
 */
export const dashboardBlocks = pgTable(
  'dashboard_blocks',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    dashboardId: uuid('dashboard_id')
      .notNull()
      .references(() => dashboards.id, { onDelete: 'cascade' }),
    // Desnormalizada: o motor filtra por organização em toda leitura, e sem ela
    // cada bloco exigiria um join de volta no painel.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    title: text('title'),
    spec: jsonb('spec').notNull(),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    painelIdx: index('idx_dashboard_blocks_painel').on(t.dashboardId, t.position),
    orgIdx: index('idx_dashboard_blocks_org').on(t.organizationId),
  })
)

/**
 * Com quem o painel é compartilhado.
 *
 * `scope = 'organizacao'` não nomeia ninguém (`user_id` nulo); `'usuarios'`
 * exige a pessoa. O `CHECK` de coerência da migration recusa o meio-termo —
 * sem ele, uma linha com escopo de organização e usuário preenchido teria dois
 * significados possíveis.
 */
export const dashboardShares = pgTable(
  'dashboard_shares',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    dashboardId: uuid('dashboard_id')
      .notNull()
      .references(() => dashboards.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    userId: uuid('user_id'),
    permission: text('permission').notNull().default('ler'),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    painelIdx: index('idx_dashboard_shares_painel').on(t.dashboardId),
  })
)

export type Dashboard = typeof dashboards.$inferSelect
export type NewDashboard = typeof dashboards.$inferInsert
export type DashboardBlock = typeof dashboardBlocks.$inferSelect
export type NewDashboardBlock = typeof dashboardBlocks.$inferInsert
export type DashboardShare = typeof dashboardShares.$inferSelect
export type NewDashboardShare = typeof dashboardShares.$inferInsert
