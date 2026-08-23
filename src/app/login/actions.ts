"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Para onde ir depois de entrar.
 *
 * Só caminho interno. `//evil.com` e `/\evil.com` são lidos pelo navegador como
 * endereço ABSOLUTO — sem esta checagem, `?next=` viraria um redirecionador
 * aberto hospedado no nosso domínio, que é exatamente o que a tela de
 * consentimento do OAuth existe para não ser.
 */
function destinoSeguro(next: unknown): string {
  const bruto = typeof next === "string" ? next : "";
  if (!bruto.startsWith("/")) return "/dashboard";
  if (bruto.startsWith("//") || bruto.startsWith("/\\")) return "/dashboard";
  return bruto;
}

export async function signIn(formData: FormData) {
  const supabase = createClient();
  const destino = destinoSeguro(formData.get("next"));

  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });

  if (error) {
    const params = new URLSearchParams({ error: error.message });
    // O destino sobrevive ao erro de senha: perdê-lo aqui devolveria o usuário
    // ao dashboard depois de acertar, com o pedido do aplicativo já perdido.
    if (destino !== "/dashboard") params.set("next", destino);
    redirect(`/login?${params.toString()}`);
  }

  revalidatePath("/", "layout");
  redirect(destino);
}
