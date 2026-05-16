'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { organizations, memberships } from '@/db/schema'
import { eq } from 'drizzle-orm'

const schema = z.object({
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres').max(200),
  cnpj: z.string().optional(),
  sector: z.string().optional(),
})

export type CreateOrgState = { error?: string | null }

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

async function uniqueSlug(base: string): Promise<string> {
  const [existing] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, base))
    .limit(1)

  if (!existing) return base

  const suffix = Math.random().toString(36).slice(2, 6)
  return `${base}-${suffix}`
}

export async function createOrganization(
  _prevState: CreateOrgState,
  formData: FormData,
): Promise<CreateOrgState> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const parsed = schema.safeParse({
    name: formData.get('name'),
    cnpj: formData.get('cnpj') || undefined,
    sector: formData.get('sector') || undefined,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { name, cnpj, sector } = parsed.data
  const slug = await uniqueSlug(slugify(name))

  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

  try {
    await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          name,
          cnpj: cnpj || null,
          slug,
          settings: { sector: sector || null },
          subscriptionStatus: 'trial',
          trialEndsAt,
        })
        .returning()

      await tx.insert(memberships).values({
        userId: user.id,
        organizationId: org.id,
        role: 'owner',
        acceptedAt: new Date(),
      })
    })
  } catch (err) {
    const pg = err as { code?: string; constraint?: string }
    if (pg.code === '23505') {
      if (pg.constraint?.includes('cnpj')) {
        return { error: 'Este CNPJ já está cadastrado.' }
      }
      return { error: 'Nome de empresa já utilizado. Tente outro.' }
    }
    return { error: 'Erro ao criar empresa. Tente novamente.' }
  }

  redirect('/dashboard')
}
