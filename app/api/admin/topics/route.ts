import { NextRequest } from "next/server";
import { forbiddenResponse, getAuthContext, routeErrorResponse } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth.isAdmin) {
      return forbiddenResponse();
    }

    const supabase = getServiceClient();
    const { data, error } = await supabase.from("topics").select("*").order("created_at", { ascending: false });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ topics: data ?? [] });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth.isAdmin) {
      return forbiddenResponse();
    }

    const body = await req.json();
    const name = String(body.name ?? "").trim();
    const description = String(body.description ?? "").trim();

    if (!name) {
      return Response.json({ error: "Topic name is required." }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { error } = await supabase.from("topics").insert({
      name,
      description: description || null
    });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
