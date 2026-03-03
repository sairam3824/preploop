import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

export function getServiceClient() {
  const env = getEnv();

  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export function getAnonServerClient(accessToken?: string) {
  const env = getEnv();

  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      : undefined,
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
