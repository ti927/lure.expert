import { pgTable, uuid, text, boolean, numeric, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations } from './organizations'

const tz = { withTimezone: true }

export const legalEntities = pgTable('legal_entities', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  cnpj: text('cnpj'),
  code: text('code'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', tz).notNull().default(sql`now()`),

  // Parâmetros de encargo da folha (migration 0036). Alíquotas em FRAÇÃO (0.20 = 20%).
  /** 'lucro_real' | 'lucro_presumido' | 'simples' */
  regimeTributario: text('regime_tributario'),
  simplesAnexoIv: boolean('simples_anexo_iv').notNull().default(false),
  aliquotaInssPatronal: numeric('aliquota_inss_patronal', { precision: 8, scale: 6 }).notNull().default('0.20'),
  aliquotaRatFap: numeric('aliquota_rat_fap', { precision: 8, scale: 6 }).notNull().default('0.02'),
  aliquotaTerceiros: numeric('aliquota_terceiros', { precision: 8, scale: 6 }).notNull().default('0.058'),
  aliquotaFgts: numeric('aliquota_fgts', { precision: 8, scale: 6 }).notNull().default('0.08'),
  updatedAt: timestamp('updated_at', tz).notNull().default(sql`now()`),
})

export type LegalEntity = typeof legalEntities.$inferSelect
export type NewLegalEntity = typeof legalEntities.$inferInsert
