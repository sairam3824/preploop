import { NextRequest } from "next/server";
import { getAuthContext, unauthorizedResponse } from "@/lib/auth";
import { ensureProfile } from "@/lib/db";
import { getServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const supabase = getServiceClient();

    await ensureProfile(auth.userId, auth.email, req.headers.get("x-user-timezone") ?? undefined);

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", auth.userId)
      .single();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ profile });
  } catch (error) {
    return unauthorizedResponse(error instanceof Error ? error.message : "Unauthorized");
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const body = await req.json().catch(() => ({}));
    const timezone = typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : "UTC";

    await ensureProfile(auth.userId, auth.email, timezone);

    const supabase = getServiceClient();
    const { error } = await supabase
      .from("profiles")
      .update({ timezone, updated_at: new Date().toISOString() })
      .eq("id", auth.userId);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (error) {
    return unauthorizedResponse(error instanceof Error ? error.message : "Unauthorized");
  }
}
