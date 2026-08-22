import { pgTable, uuid, text, integer, numeric, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'
import { costCenters } from './cost-centers'
import { businessUnits } from './business-units'
import { legalEntities } from './legal-entities'
import { contacts } from './contacts'

const tz = { withTimezone: true }

/**
 * Modelo de rateio: uma divisão nomeada, guardada para reaplicar.
 *
 * O conteúdo é o mesmo que o diálogo de rateio em lote monta — N partes, cada
 * uma com peso relativo e as quatro dimensões (migration 0027).
 */
export const allocationTemplates = pgTable(
  'allocation_templates',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    // Arquivar em vez de apagar preserva o carimbo de origem nos rateios feitos.
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    orgNameIdx: uniqueIndex('idx_alloc_tpl_org_name').on(t.organizationId, sql`lower(trim(${t.name}))`),
    orgIdx: index('idx_alloc_tpl_org').on(t.organizationId, t.isActive),
  })
)

/**
 * Uma parte do modelo.
 *
 * `weight` é PESO RELATIVO, não valor e não percentual fechado: 60:40, 6:4 e
 * 7200:4800 descrevem a mesma divisão. Só a razão importa — é o que deixa
 * "Salvar como modelo" partir de um rateio já feito em reais sem arredondar.
 * A conversão em valores acontece na aplicação, por `applyProportion`.
 */
export const allocationTemplateLines = pgTable(
  'allocation_template_lines',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => allocationTemplates.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull().default(1),
    weight: numeric('weight', { precision: 18, scale: 6 }).notNull(),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id, { onDelete: 'set null' }),
    businessUnitId: uuid('business_unit_id').references(() => businessUnits.id, { onDelete: 'set null' }),
    legalEntityId: uuid('legal_entity_id').references(() => legalEntities.id, { onDelete: 'set null' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
  },
  (t) => ({
    templateIdx: index('idx_alloc_tpl_line_template').on(t.templateId, t.sequence),
    orgIdx: index('idx_alloc_tpl_line_org').on(t.organizationId),
  })
)

export type AllocationTemplate = typeof allocationTemplates.$inferSelect
export type NewAllocationTemplate = typeof allocationTemplates.$inferInsert
export type AllocationTemplateLine = typeof allocationTemplateLines.$inferSelect
export type NewAllocationTemplateLine = typeof allocationTemplateLines.$inferInsert
