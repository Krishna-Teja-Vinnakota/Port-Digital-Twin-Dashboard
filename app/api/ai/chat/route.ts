/**
 * POST /api/ai/chat
 * Port AI Assistant powered by Google Gemini 2.5 Pro.
 * Accepts conversation history and port state, returns structured operational advice.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sendChatMessage } from '@/lib/ai';
import { withApiLogging } from '@/lib/apiLogger';

async function postHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages = [], context, userRole = 'Port Authority' } = body;

    if (!messages.length) {
      return NextResponse.json({ error: 'messages array is required' }, { status: 400 });
    }

    const response = await sendChatMessage(messages, context, userRole);
    return NextResponse.json(response);
  } catch (err) {
    console.error('AI chat error:', err);
    return NextResponse.json(
      {
        summary: 'AI service temporarily unavailable. Please retry.',
        impact: { tat_delta: 'N/A', congestion_change: 'N/A', carbon_delta: 'N/A', affected_vessels: 0 },
        recommendations: ['Monitor current port state manually', 'Review VTMS for vessel positions'],
        severity: 'LOW',
        confidence: 0,
      },
      { status: 200 }
    );
  }
}

export const POST = withApiLogging('POST', '/api/ai/chat', postHandler);
