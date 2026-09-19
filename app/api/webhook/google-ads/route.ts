import { NextResponse } from 'next/server';
import { ingestCampaignDay } from '@/lib/googleAds/ingest';

/**
 * Recebe o dia de uma campanha enviado pelo script do Google Ads.
 *
 * A gravação mora em lib/googleAds/ingest.ts, compartilhada com a coleta
 * direta pela API — as duas rotas precisam gravar do mesmo jeito enquanto
 * convivem.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await ingestCampaignDay(body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
