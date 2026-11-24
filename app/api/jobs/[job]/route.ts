import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { refreshExpiringTokens } from "@/lib/meta/accounts";
import { refreshToken } from "@/lib/meta/client";
import { getMetaConfig } from "@/lib/meta/config";
import { metaPort } from "@/lib/meta/port";
import { publishDue } from "@/lib/publishing/publisher";
import { createAdminClient } from "@/lib/supabase/admin";

// Rotinas chamadas pelo agendador (pg_cron + pg_net, ou cron da hospedagem).
// Autenticação: Authorization: Bearer $CRON_SECRET.
export const maxDuration = 300;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const got = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 32) return false;
  const a = Buffer.from(`Bearer ${secret}`);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/jobs/[job]">) {
  if (!authorized(request)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const { job } = await ctx.params;
  const cfg = getMetaConfig();
  if (!cfg) return NextResponse.json({ error: "Meta não configurada" }, { status: 503 });
  const db = createAdminClient();

  switch (job) {
    case "publish-due": {
      const results = await publishDue({ db, meta: metaPort(cfg) });
      return NextResponse.json({ processed: results.length, results });
    }
    case "refresh-tokens": {
      const results = await refreshExpiringTokens(db, (t) => refreshToken(cfg, t));
      return NextResponse.json({ processed: results.length, failed: results.filter((r) => !r.ok).length });
    }
    default:
      return NextResponse.json({ error: "rotina desconhecida" }, { status: 404 });
  }
}
