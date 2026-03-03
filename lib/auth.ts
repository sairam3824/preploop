import { NextRequest } from "next/server";
import { getAnonServerClient, getServiceClient } from "@/lib/supabase/server";

export interface AuthContext {
  userId: string;
  email: string;
  isAdmin: boolean;
}

export async function getAuthContext(req: NextRequest): Promise<AuthContext> {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    throw new Error("Missing bearer token");
  }

  const anonClient = getAnonServerClient(token);
  const {
    data: { user },
    error: userError
  } = await anonClient.auth.getUser();

  if (userError || !user) {
    throw new Error("Invalid session token");
  }

  const serviceClient = getServiceClient();
  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError && profileError.code !== "PGRST116") {
    throw new Error(`Profile load failed: ${profileError.message}`);
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    isAdmin: profile?.is_admin ?? false
  };
}

export function unauthorizedResponse(message = "Unauthorized") {
  return Response.json({ error: message }, { status: 401 });
}

export function forbiddenResponse(message = "Forbidden") {
  return Response.json({ error: message }, { status: 403 });
}
