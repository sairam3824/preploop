import { NextRequest } from "next/server";
import { getAuthContext, routeErrorResponse } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    await getAuthContext(req);
    const supabase = getServiceClient();
    const { data, error } = await supabase.from("topics").select("id, name, description").order("name", { ascending: true });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ topics: data ?? [] });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
