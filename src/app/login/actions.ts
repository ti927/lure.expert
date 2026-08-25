"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { destinoSeguro } from "@/lib/redirect-seguro";

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
