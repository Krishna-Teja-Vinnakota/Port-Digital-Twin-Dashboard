import { NextResponse } from 'next/server';
import { generateRailData } from '@/lib/mockDataGen';
import { withApiLogging } from '@/lib/apiLogger';

async function getHandler() {
  return NextResponse.json(generateRailData());
}

export const GET = withApiLogging('GET', '/api/rail', getHandler);
