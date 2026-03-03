import { NextRequest } from "next/server";
import { getAuthContext, routeErrorResponse } from "@/lib/auth";
import { ensureProfile } from "@/lib/db";
import { getServiceClient } from "@/lib/supabase/server";
import { APP_TIMEZONE } from "@/lib/time";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const supabase = getServiceClient();

    await ensureProfile(auth.userId, auth.email);

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
    return routeErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    await req.json().catch(() => ({}));
    await ensureProfile(auth.userId, auth.email);

    const supabase = getServiceClient();
    const { error } = await supabase
      .from("profiles")
      .update({ timezone: APP_TIMEZONE, updated_at: new Date().toISOString() })
      .eq("id", auth.userId);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true, timezone: APP_TIMEZONE });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
