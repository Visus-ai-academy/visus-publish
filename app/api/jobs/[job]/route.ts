import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { refreshExpiringTokens } from "@/lib/meta/accounts";
import { MetaApiError, refreshToken } from "@/lib/meta/client";
import { getMetaConfig } from "@/lib/meta/config";
import { metaPort, type MetaPort } from "@/lib/meta/port";
import { metricoolConfigFromEnv, metricoolPort } from "@/lib/metricool/port";
import { publishDue } from "@/lib/publishing/publisher";
import { createAdminClient } from "@/lib/supabase/admin";

// Rotinas chamadas pelo agendador (pg_cron + pg_net, ou cron da hospedagem).
// Autenticação: Authorization: Bearer $CRON_SECRET.
export const maxDuration = 300;

const notConfigured = async (): Promise<never> => {
  throw new MetaApiError("o app da Meta ainda não está configurado no servidor", 0, undefined, undefined, false);
};
const unconfiguredMeta: MetaPort = {
  publishingLimit: notConfigured,
  createContainer: notConfigured,
  containerStatus: notConfigured,
  publishContainer: notConfigured,
  getPermalink: notConfigured,
};

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
  const db = createAdminClient();

  switch (job) {
    case "publish-due": {
      // Sem app da Meta configurado, contas da Meta falham com mensagem clara e as do Metricool seguem.
      const meta = cfg ? metaPort(cfg) : unconfiguredMeta;
      const results = await publishDue({ db, meta, metricool: metricoolPort(metricoolConfigFromEnv()) });
      return NextResponse.json({ processed: results.length, results });
    }
    case "refresh-tokens": {
      if (!cfg) return NextResponse.json({ processed: 0, skipped: "Meta não configurada" });
      const results = await refreshExpiringTokens(db, (t) => refreshToken(cfg, t));
      return NextResponse.json({ processed: results.length, failed: results.filter((r) => !r.ok).length });
    }
    default:
      return NextResponse.json({ error: "rotina desconhecida" }, { status: 404 });
  }
}
