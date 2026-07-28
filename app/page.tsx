import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import CuadraApp from "@/components/CuadraApp";
import type { Business, Profile } from "@/lib/types";

export default async function Home() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, business_id, name, role")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // usuario autenticado pero sin perfil (no debería pasar con los flujos de la app)
    redirect("/login?error=sin_perfil");
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, daily_float, low_cash_threshold, low_cash_alerted")
    .eq("id", profile.business_id)
    .single();

  if (!business) redirect("/login?error=sin_negocio");

  return <CuadraApp profile={profile as Profile} business={business as Business} />;
}
