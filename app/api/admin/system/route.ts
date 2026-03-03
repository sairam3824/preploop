import { NextRequest } from "next/server";
import { forbiddenResponse, getAuthContext, routeErrorResponse } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";

function isMissingColumnError(error: { code?: string | null; message?: string | null } | null, columnName: string) {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST204") {
    return true;
  }

  return (error.message ?? "").includes(columnName);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth.isAdmin) {
      return forbiddenResponse();
    }

    const supabase = getServiceClient();

    let previewColumnsEnabled = true;
    let summaryColumnsEnabled = true;
    let pendingPreviewBackfill = 0;

    const previewProbe = await supabase
      .from("chat_sessions")
      .select("id, last_message_preview, last_message_at")
      .limit(1);

    if (previewProbe.error) {
      if (isMissingColumnError(previewProbe.error, "last_message_preview") || isMissingColumnError(previewProbe.error, "last_message_at")) {
        previewColumnsEnabled = false;
      } else {
        throw new Error(previewProbe.error.message);
      }
    }

    const summaryProbe = await supabase
      .from("chat_sessions")
      .select("id, session_summary, summary_updated_at")
      .limit(1);

    if (summaryProbe.error) {
      if (isMissingColumnError(summaryProbe.error, "session_summary") || isMissingColumnError(summaryProbe.error, "summary_updated_at")) {
        summaryColumnsEnabled = false;
      } else {
        throw new Error(summaryProbe.error.message);
      }
    }

    if (previewColumnsEnabled) {
      const { count, error } = await supabase
        .from("chat_sessions")
        .select("id", { count: "exact", head: true })
        .is("last_message_at", null);

      if (error) {
        throw new Error(error.message);
      }
      pendingPreviewBackfill = count ?? 0;
    }

    return Response.json({
      previewColumnsEnabled,
      summaryColumnsEnabled,
      pendingPreviewBackfill,
      chatHistoryFastPath: previewColumnsEnabled
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
