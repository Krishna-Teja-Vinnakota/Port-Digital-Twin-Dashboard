/**
 * ai.js
 * Google Gemini 2.5 Pro client for Port Digital Twin AI Assistant.
 * Uses Google Cloud service account credentials for authentication.
 * Falls back to mock responses if credentials are not configured.
 */

import { buildSystemPrompt, fewShotExamples } from './promptBuilder.js';
import {
  buildLiveOverlaySchedule,
  generate21DayOccupancy,
  generateWeeklySummary,
} from './berthScheduler.js';

/** Model id for Vertex AI (matches AI advisor). */
export const GEMINI_MODEL = 'gemini-2.5-pro';

/**
 * Get an authenticated access token using Google Cloud service account credentials.
 * @returns {Promise<string|null>} Bearer token or null if not configured
 */
async function getAccessToken() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) return null;

  try {
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    return tokenResponse?.token || null;
  } catch {
    return null;
  }
}

/**
 * Extract project ID from Google Cloud credentials file.
 * @returns {Promise<string|null>}
 */
async function getProjectId() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) return null;
  try {
    const fs = await import('fs');
    const raw = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
    const creds = JSON.parse(raw);
    return creds.project_id || null;
  } catch {
    return null;
  }
}

/**
 * Parse AI response text, extracting JSON or returning a fallback structure.
 * Handles markdown code fences (```json ... ```) and raw JSON equally.
 * @param {string} text
 * @returns {AIResponse}
 */
function parseAIResponse(text) {
  try {
    let cleanText = (text || '').trim();
    // Strip markdown code fences if present
    if (cleanText.startsWith('```')) {
      const firstNl = cleanText.indexOf('\n');
      const endFence = cleanText.lastIndexOf('```');
      if (firstNl >= 0 && endFence > firstNl) {
        cleanText = cleanText.slice(firstNl + 1, endFence).trim();
      }
    }
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Validate required fields exist
      if (parsed && parsed.summary && parsed.impact && parsed.recommendations) {
        return parsed;
      }
    }
    throw new Error('No valid JSON found');
  } catch {
    return {
      summary: text || 'AI response received but could not be parsed.',
      impact: {
        tat_delta: 'Analysis pending',
        congestion_change: 'Analysis pending',
        carbon_delta: 'Analysis pending',
        affected_vessels: 0,
      },
      recommendations: [
        'Review current vessel positions via VTMS',
        'Monitor gate queue levels',
        'Alert terminal operations if thresholds are breached',
      ],
      severity: 'LOW',
      confidence: 0.5,
    };
  }
}

/**
 * Mock AI response for when Google Cloud credentials are not configured.
 * Attempts scenario-aware response when userMessage contains "SCENARIO ACTIVE".
 * @param {string} userMessage
 * @param {SimulationState} state
 * @returns {AIResponse}
 */
function getMockAIResponse(userMessage, state) {
  const { vessels = [], kpis = {}, gates = [], trucks = [], yard = null, activeScenarioIds = [] } = state;
  const anchored  = vessels.filter(v => v.lifecycleState === 'ANCHORED');
  const loading   = vessels.filter(v => v.lifecycleState === 'LOADING');
  const highGates = gates.filter(g => g.congestionLevel === 'HIGH');
  const closedGates = gates.filter(g => g.status === 'CLOSED');
  const openGates   = gates.filter(g => g.status === 'OPEN');
  const gateQueueTotal = gates.reduce((s, g) => s + (g.queueLength || 0), 0);
  const yardPct = yard ? Math.round((yard.currentTEU / yard.capacityTEU) * 100) : (kpis.yardOccupancy ?? 0);

  // Detect active scenario from message prefix or activeScenarioIds
  const isScenario = userMessage.startsWith('SCENARIO ACTIVE');
  const scenarioHint = activeScenarioIds[0] ?? '';

  if (isScenario && (scenarioHint === 'crane_breakdown' || userMessage.includes('crane'))) {
    const craneVessel = loading.find(v => v.assignedCranes === 1) ?? loading[0];
    return {
      summary: `Crane breakdown on ${craneVessel?.name ?? 'a berthed vessel'} at berth ${craneVessel?.berthNumber ?? '—'} has reduced crane capacity to 1 unit. Vessel TAT is projected to increase by 4-6 hrs beyond the 24-hr target. With ${anchored.length} vessel(s) anchored and pre-berthing detention at ${kpis.preBerthingDetention || 0} hrs, berth queue risk is HIGH.`,
      impact: {
        tat_delta: `+4–6 hrs on ${craneVessel?.name ?? 'affected vessel'} (TAT now ~${((kpis.avgVesselTAT || 18) + 5).toFixed(0)} hrs)`,
        congestion_change: `${anchored.length} vessel(s) waiting for berth; pre-berthing detention ${kpis.preBerthingDetention || 0} hrs`,
        carbon_delta: `+${((craneVessel?.emissionsRate || 1.8) * 5).toFixed(1)} t CO₂ from extended berth stay`,
        affected_vessels: anchored.length + 1,
      },
      recommendations: [
        `Contact JNPCT maintenance to dispatch emergency crane technician to berth ${craneVessel?.berthNumber ?? '—'} for ${craneVessel?.name ?? 'the affected vessel'} immediately`,
        `Assign next available pilot to highest-priority anchored vessel (${anchored[0]?.name ?? 'V001'}) to free anchorage pressure`,
        `Pre-alert TOS (FOCUS/SAP) to begin yard pre-staging for ${anchored.length} waiting vessel(s) to minimize berth turnaround once available`,
        `If repairs exceed 3 hrs, evaluate shifting ${craneVessel?.name ?? 'affected vessel'} to adjacent berth with 2 functional cranes`,
      ],
      severity: 'HIGH',
      confidence: 0.87,
    };
  }

  if (isScenario && (scenarioHint.includes('heavy_rain') || userMessage.includes('rain'))) {
    return {
      summary: `Heavy rain conditions have extended gate processing time and berth turnaround. With ${gates.length} gates handling ${gateQueueTotal} trucks and yard at ${yardPct}%, gate queues will reach HIGH congestion 40–60% faster than baseline. Pre-berthing detention for ${anchored.length} anchored vessel(s) is at risk of breaching the 3-hr RFP threshold.`,
      impact: {
        tat_delta: `+1.5–2.5 hrs per vessel due to slower crane ops and berth turnaround`,
        congestion_change: `Gate queue build-up rate +40%; ${highGates.length > 0 ? `Gates ${highGates.map(g => g.id).join(', ')} already at HIGH` : 'all gates approaching HIGH'}`,
        carbon_delta: `+8–12 t CO₂ from extended truck idling at gates`,
        affected_vessels: anchored.length + loading.length,
      },
      recommendations: [
        `Extend gate staff shift by 2 hrs at Gates ${openGates.slice(0, 2).map(g => g.id).join(' and ') || '1 and 2'} to maintain throughput`,
        `Issue PA announcement to stagger inbound truck arrivals on NH-348 — request trucks arriving after 14:00 to hold at Karal Phata`,
        `Alert VTMS to implement reduced approach speed protocol for ${anchored.map(v => v.name).join(', ') || 'anchored vessels'} and stagger berthing by 90-min intervals`,
        `Coordinate with NMMC for traffic signal prioritization on Uran Road junction to prevent NH-348 spillback`,
      ],
      severity: 'MEDIUM',
      confidence: 0.82,
    };
  }

  if (isScenario && (scenarioHint.includes('truck') || userMessage.includes('truck surge') || userMessage.includes('INCREASE_TRUCKS'))) {
    const worstGate = gates.reduce((a, b) => (a.queueLength > b.queueLength ? a : b), gates[0] ?? { id: 1, queueLength: 0 });
    return {
      summary: `Truck volume surge has pushed total gate queue to ${gateQueueTotal} trucks across ${gates.length} gates. Gate ${worstGate.id} is the primary bottleneck with ${worstGate.queueLength} trucks queued. At current processing rates, carbon emissions index will worsen within 30 minutes as truck idling time accumulates.`,
      impact: {
        tat_delta: 'No direct vessel TAT impact — gate throughput is the constraint',
        congestion_change: `Gate ${worstGate.id} queue: ${worstGate.queueLength} trucks; total geo-fence: ${trucks.length}/${200} threshold`,
        carbon_delta: `+${(trucks.length * 0.04).toFixed(1)} t CO₂/hr from geo-fence idling`,
        affected_vessels: 0,
      },
      recommendations: [
        `Activate alternate parking plaza at Karal Phata on NH-348 immediately — divert all non-time-critical trucks from Gate ${worstGate.id}`,
        `Open additional processing lanes at Gate ${openGates.find(g => g.id !== worstGate.id)?.id ?? 2} to absorb diverted volume`,
        `Issue Port Traffic Management Centre PA announcement: trucks bound for Export should use Gate ${openGates[openGates.length - 1]?.id ?? 4}`,
        `Coordinate with NMMC/CIDCO for priority traffic signals on Uran Road and Karal Phata junction to prevent NH-348 backlog`,
      ],
      severity: trucks.length > 200 ? 'HIGH' : 'MEDIUM',
      confidence: 0.85,
    };
  }

  if (isScenario && (scenarioHint.includes('yard') || userMessage.includes('saturation'))) {
    return {
      summary: `Yard occupancy is at ${yardPct}% (${yard?.currentTEU?.toLocaleString() ?? '—'} TEU), critically close to full capacity. DPD percentage will deteriorate sharply as containers cannot flow out to consignees. With ${approaching.length ?? 0} vessels approaching, additional TEU load is imminent. Immediate interventions are required to prevent yard lockout.`,
      impact: {
        tat_delta: `+2–4 hrs per vessel if yard-driven berth hold is triggered`,
        congestion_change: `Yard at ${yardPct}% — import container dwell time rising, DPD at risk`,
        carbon_delta: `+6–9 t CO₂ from trucks circling yard without delivery slot`,
        affected_vessels: loading.length,
      },
      recommendations: [
        `Alert TOS (FOCUS/SAP) for emergency yard redistribution — prioritise DPD movement of high-dwell import containers`,
        `Coordinate with FOIS/Indian Railways to schedule additional rakes for ICD offloading within next 6 hrs`,
        `Delay berth assignment for approaching vessel(s) until yard clears below 80% — notify VTMS accordingly`,
        `Issue pre-gate documentation fast-track for DPD-eligible containers to accelerate consignee pickup`,
      ],
      severity: yardPct >= 90 ? 'CRITICAL' : 'HIGH',
      confidence: 0.88,
    };
  }

  if (isScenario && (userMessage.includes('BUNCH_SHIPS') || userMessage.includes('bunching'))) {
    return {
      summary: `${anchored.length} vessels are bunching at Port anchorage, with pre-berthing detention at ${kpis.preBerthingDetention || 0} hrs — ${(kpis.preBerthingDetention || 0) > 3 ? 'already breaching the 3-hr RFP threshold' : 'approaching the 3-hr RFP threshold'}. Combined anchorage carbon output is ${anchored.reduce((s, v) => s + (v.emissionsRate || 0), 0).toFixed(1)} t CO₂/hr. Pilot demand has tripled; berth sequencing must be activated immediately.`,
      impact: {
        tat_delta: `+4.5 hrs pre-berthing detention above RFP threshold`,
        congestion_change: `Anchorage at capacity; ${anchored.length} vessels competing for ${loading.length > 0 ? `${loading.length} berth(s) in turnover` : 'next available berth'}`,
        carbon_delta: `+${(anchored.reduce((s, v) => s + (v.emissionsRate || 0), 0) * 4).toFixed(1)} t CO₂ over 4-hr window`,
        affected_vessels: anchored.length,
      },
      recommendations: [
        `Redirect ${anchored[anchored.length - 1]?.name ?? 'lowest-priority vessel'} to Mumbai Roads alternate anchorage immediately — contact VTMS for routing`,
        `Assign next available pilot to ${anchored[0]?.name ?? 'highest-priority anchored vessel'} for priority berthing`,
        `Activate VTMS vessel bunching management protocol — stagger berthing at 90-min intervals for remaining ${anchored.length - 1} vessel(s)`,
        `Pre-alert JNPCT TOS to clear berth turnover paperwork for emergency berthing sequence`,
      ],
      severity: 'HIGH',
      confidence: 0.91,
    };
  }

  // Default: general port state response
  return {
    summary: `Current Port port state: ${vessels.length} vessels active, berth occupancy ${kpis.berthOccupancy || 0}%, pre-berthing detention ${kpis.preBerthingDetention || 0} hrs (threshold: 3 hrs). Gate congestion is ${kpis.gateCongestionLevel || 'LOW'} with ${gateQueueTotal} trucks queued across ${gates.length} gates.`,
    impact: {
      tat_delta: kpis.avgVesselTAT > 20 ? `+${(kpis.avgVesselTAT - 18).toFixed(1)} hrs above 18-hr baseline` : 'Within 18–24 hr target range',
      congestion_change: highGates.length > 0 ? `Gates ${highGates.map(g => g.id).join(', ')} at HIGH — immediate action required` : `All gates within tolerance (total queue: ${gateQueueTotal})`,
      carbon_delta: kpis.carbonIndex === 'HIGH' ? `+18.4 t CO₂ from anchorage idling (${anchored.length} vessels)` : 'Within acceptable limits',
      affected_vessels: anchored.length,
    },
    recommendations: [
      anchored.length > 3 ? `PRIORITY: Initiate staggered berthing protocol for ${anchored.length} anchored vessels via VTMS` : `Monitor ${anchored.length} anchored vessel(s) — detention within threshold`,
      highGates.length > 0 ? `Activate Karal Phata alternate parking plaza; redirect trucks from Gate ${highGates[0].id}` : 'Maintain current gate operations — queues within tolerance',
      closedGates.length > 0 ? `Consider reopening Gate ${closedGates[0].id} to redistribute gate load` : `No closed gates — operations normal`,
      'Review DPD/DPE percentages with terminal operations for next shift handover',
    ],
    severity: (kpis.carbonIndex === 'HIGH' || (kpis.preBerthingDetention || 0) > 3) ? 'MEDIUM' : 'LOW',
    confidence: 0.84,
  };
}

/**
 * Send a message to Google Gemini 2.5 Pro via Vertex AI and return structured response.
 * @param {ChatMessage[]} messages - Conversation history
 * @param {SimulationState} context - Current simulation state
 * @param {string} userRole - Current operator role
 * @returns {Promise<AIResponse>}
 */
export async function sendChatMessage(messages, context, userRole) {
  const systemPrompt = buildSystemPrompt(context, userRole);

  // Try to get credentials
  const [token, projectId] = await Promise.all([getAccessToken(), getProjectId()]);

  // Fall back to mock if no credentials
  if (!token || !projectId) {
    const lastUserMsg = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
    return getMockAIResponse(lastUserMsg, context);
  }

  // Build Vertex AI Gemini request
  const location = process.env.GEMINI_LOCATION || 'us-central1';
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${GEMINI_MODEL}:generateContent`;

  // Convert message history to Gemini format
  const formattedMessages = messages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  // Insert few-shot examples before actual conversation
  const contents = [...fewShotExamples, ...formattedMessages];

  const requestBody = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096,
      topP: 0.8,
      responseMimeType: 'application/json',
    },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', errorText);
      return getMockAIResponse(messages.slice(-1)[0]?.content || '', context);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return parseAIResponse(text);
  } catch (err) {
    console.error('Gemini API call failed:', err);
    return getMockAIResponse(messages.slice(-1)[0]?.content || '', context);
  }
}

// ——— Berth forecast (Gemini 2.5 Pro) ———

const BERTH_STATUSES = new Set(['CONFIRMED', 'EXPECTED', 'TENTATIVE', 'BERTHED', 'DEPARTED']);
const BERTH_FORECAST_GEMINI_TIMEOUT_MS = 45000;

function clamp01(n) {
  return Math.min(100, Math.max(0, n));
}

/**
 * @param {string} text
 * @returns {object|null}
 */
function parseJsonObjectFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const firstNl = trimmed.indexOf('\n');
    const endFence = trimmed.lastIndexOf('```');
    if (firstNl >= 0 && endFence > firstNl) {
      const inner = trimmed.slice(firstNl + 1, endFence).trim();
      try {
        return JSON.parse(inner);
      } catch {
        /* fall through */
      }
    }
  }
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

/**
 * @param {string|undefined} a
 * @param {string|undefined} b
 */
function sameYmdFromIso(a, b) {
  if (!a || !b) return false;
  const da = String(a).slice(0, 10);
  const db = String(b).slice(0, 10);
  return da === db;
}

/**
 * Build 21 consecutive day rows from local "today" (matches berthScheduler style).
 * @param {Date} [ref]
 */
function buildBase21DayGrid(ref = new Date()) {
  const today = new Date(ref);
  const days = [];
  for (let d = 0; d < 21; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const ymd = date.toISOString().split('T')[0];
    days.push({
      date: ymd,
      dayLabel: date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
      occupancyPercent: isWeekend ? 55 : 72,
      vessels: 15,
      isWeekend,
    });
  }
  return days;
}

/**
 * Parse and fix berth forecast JSON from Gemini. Returns null if unusable.
 * @param {unknown} raw
 * @returns {import('./berthScheduler.js').BerthForecastData | null}
 */
export function normalizeBerthForecastPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (raw);

  const baseGrid = buildBase21DayGrid();
  const byDate = new Map(baseGrid.map((d) => [d.date, { ...d }]));

  if (Array.isArray(o.occupancyGrid) && o.occupancyGrid.length) {
    for (const cell of o.occupancyGrid) {
      if (!cell || typeof cell !== 'object') continue;
      const c = /** @type {Record<string, unknown>} */ (cell);
      const dateStr = typeof c.date === 'string' ? c.date.slice(0, 10) : null;
      if (!dateStr || !byDate.has(dateStr)) continue;
      const target = byDate.get(dateStr);
      const op = Number(c.occupancyPercent);
      if (Number.isFinite(op)) target.occupancyPercent = parseFloat(clamp01(op).toFixed(1));
      const v = Number(c.vessels);
      if (Number.isFinite(v)) target.vessels = Math.max(0, Math.floor(v));
      if (typeof c.dayLabel === 'string' && c.dayLabel.trim()) {
        target.dayLabel = c.dayLabel.trim();
      }
      if (typeof c.isWeekend === 'boolean') target.isWeekend = c.isWeekend;
    }
  }

  const occupancyGrid = baseGrid.map((b) => {
    const merged = byDate.get(b.date) || b;
    const op = Number(merged.occupancyPercent);
    const ve = Number(merged.vessels);
    return {
      date: String(merged.date).slice(0, 10),
      dayLabel: String(merged.dayLabel || b.dayLabel),
      occupancyPercent: parseFloat(
        Number.isFinite(op) ? clamp01(op).toFixed(1) : String(b.occupancyPercent)
      ),
      vessels: Number.isFinite(ve) ? Math.max(0, Math.floor(ve)) : b.vessels,
      isWeekend: Boolean(merged.isWeekend),
    };
  });

  if (!Array.isArray(o.vesselSchedule) || o.vesselSchedule.length < 1) return null;

  const vesselSchedule = o.vesselSchedule
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const v = /** @type {Record<string, unknown>} */ (row);
      const etaD = v.eta ? new Date(/** @type {string} */ (v.eta)) : new Date(NaN);
      const etdD = v.etd ? new Date(/** @type {string} */ (v.etd)) : new Date(NaN);
      if (Number.isNaN(etaD.getTime()) || Number.isNaN(etdD.getTime())) return null;
      let status = String(v.status || 'EXPECTED').toUpperCase();
      if (!BERTH_STATUSES.has(status)) status = 'EXPECTED';
      const id = v.id != null ? String(v.id) : `GEN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      return {
        id,
        vesselName: v.vesselName != null ? String(v.vesselName) : 'UNKNOWN',
        eta: etaD.toISOString(),
        etd: etdD.toISOString(),
        berthNumber: v.berthNumber != null ? String(v.berthNumber) : 'B1',
        status,
        teus: Math.max(0, Math.floor(Number(v.teus) || 0)),
        vesselType: v.vesselType != null ? String(v.vesselType) : 'CONTAINER',
      };
    })
    .filter(Boolean);

  if (vesselSchedule.length < 1) return null;

  vesselSchedule.sort((a, b) => new Date(a.eta).getTime() - new Date(b.eta).getTime());

  let weeklySummary;
  if (Array.isArray(o.weeklySummary) && o.weeklySummary.length >= 1) {
    weeklySummary = o.weeklySummary.slice(0, 7).map((w, i) => {
      const d = w && typeof w === 'object' ? /** @type {Record<string, unknown>} */ (w) : {};
      const fromGrid = occupancyGrid[i] || occupancyGrid[0];
      return {
        date: typeof d.date === 'string' ? d.date.slice(0, 10) : fromGrid.date,
        dayLabel: typeof d.dayLabel === 'string' ? d.dayLabel : fromGrid.dayLabel,
        occupancyPercent: Number.isFinite(Number(d.occupancyPercent))
          ? parseFloat(clamp01(Number(d.occupancyPercent)).toFixed(1))
          : fromGrid.occupancyPercent,
        vessels: Number.isFinite(Number(d.vessels)) ? Math.max(0, Math.floor(Number(d.vessels))) : fromGrid.vessels,
        isWeekend: typeof d.isWeekend === 'boolean' ? d.isWeekend : fromGrid.isWeekend,
        avgTAT: Number.isFinite(Number(d.avgTAT))
          ? parseFloat(Number(d.avgTAT).toFixed(1))
          : 18.0,
        totalVesselsHandled: Number.isFinite(Number(d.totalVesselsHandled))
          ? Math.max(0, Math.floor(Number(d.totalVesselsHandled)))
          : Math.floor((fromGrid.vessels || 0) * 0.8),
      };
    });
  } else {
    weeklySummary = generateWeeklySummary(occupancyGrid);
  }

  const avgOccupancy21Day = parseFloat(
    (occupancyGrid.reduce((s, d) => s + d.occupancyPercent, 0) / 21).toFixed(1)
  );

  return {
    occupancyGrid,
    vesselSchedule,
    weeklySummary,
    avgOccupancy21Day,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Merge VTMS overlay rows, then recompute grid/summary from combined schedule.
 * @param {import('./berthScheduler.js').BerthForecastData} data
 * @param {Array<Record<string, unknown>>|undefined} liveOverlays
 */
function mergeBerthWithVtmsAndRecompute(data, liveOverlays) {
  if (!data || !Array.isArray(liveOverlays) || liveOverlays.length === 0) return data;

  const vtmsRows = buildLiveOverlaySchedule(/** @type {any} */ (liveOverlays));
  const seen = new Set(vtmsRows.map((r) => r.id));
  const merged = [...vtmsRows];
  for (const row of data.vesselSchedule) {
    const dup = vtmsRows.some(
      (t) => t.id === row.id || (t.vesselName === row.vesselName && sameYmdFromIso(t.eta, row.eta))
    );
    if (!dup) {
      merged.push(row);
      if (row.id) seen.add(row.id);
    }
  }
  merged.sort((a, b) => new Date(a.eta).getTime() - new Date(b.eta).getTime());

  const occupancyGrid = generate21DayOccupancy(merged);
  const weeklySummary = generateWeeklySummary(occupancyGrid);
  const avgOccupancy21Day = parseFloat(
    (occupancyGrid.reduce((s, d) => s + d.occupancyPercent, 0) / 21).toFixed(1)
  );

  return {
    ...data,
    vesselSchedule: merged,
    occupancyGrid,
    weeklySummary,
    avgOccupancy21Day,
    lastUpdated: new Date().toISOString(),
  };
}

const BERTH_FORECAST_SYSTEM = `You are a port operations forecaster for Port (the Port Authority).
Output ONLY a single JSON object (no markdown, no commentary) with this exact structure:
{
  "occupancyGrid": [ /* exactly 21 objects, one per consecutive calendar day starting from today */ ],
  "vesselSchedule": [ /* at least 8 vessel rows */ ],
  "weeklySummary": [ /* exactly 7 objects for the first 7 days */ ]
}
Each occupancyGrid object:
  "date": "YYYY-MM-DD",
  "dayLabel": "short day label, e.g. Mon, 26 Apr",
  "occupancyPercent": number 0-100 (realistic for Port container port),
  "vessels": non-negative integer (approx 23 total berths capacity),
  "isWeekend": boolean
Each vesselSchedule object:
  "id": string (unique),
  "vesselName": string,
  "eta": ISO-8601 string,
  "etd": ISO-8601 string (after eta),
  "berthNumber": one of B1..B8,
  "status": one of CONFIRMED, EXPECTED, TENTATIVE, BERTHED, DEPARTED,
  "teus": non-negative number,
  "vesselType": CONTAINER, BULK, TANKER, or RO_RO
Each weeklySummary object: same day fields as occupancyGrid plus
  "avgTAT": number (hours, ~16-24),
  "totalVesselsHandled": non-negative integer
Incorporate live VTMS overlay vessels in the user message when present (match names, ETAs, berths, confidence). Remaining schedule fill with realistic 21-day Port traffic.`;

/**
 * @param {{ liveOverlays?: any[] }} [opts] VTMS (or similar) live overlay rows; shape matches berthScheduler liveOverlays
 * @returns {Promise<import('./berthScheduler.js').BerthForecastData | null>}
 */
export async function generateBerthForecastWithGemini(opts = {}) {
  const [token, projectId] = await Promise.all([getAccessToken(), getProjectId()]);
  if (!token || !projectId) return null;

  const today = new Date();
  const todayYmd = today.toISOString().split('T')[0];
  const liveJson = JSON.stringify(opts.liveOverlays || [], null, 0);

  const userText = `Today (UTC date): ${todayYmd}
Local context: 21-day berth forecast for the digital twin dashboard.

VTMS live overlays (JSON array, may be empty):
${liveJson}

Produce the berth forecast JSON as specified. If overlays are non-empty, include every vessel in the schedule and align with their ETAs/berths where possible.`;

  const location = process.env.GEMINI_LOCATION || 'us-central1';
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${GEMINI_MODEL}:generateContent`;

  const requestBody = {
    system_instruction: {
      parts: [{ text: BERTH_FORECAST_SYSTEM }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userText }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
      topP: 0.85,
    },
  };

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), BERTH_FORECAST_GEMINI_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: ac.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini berth forecast API error:', errText);
      return null;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = parseJsonObjectFromText(text);
    if (!parsed) {
      console.error('Gemini berth forecast: could not parse JSON from response');
      return null;
    }

    let out = normalizeBerthForecastPayload(parsed);
    if (!out) {
      console.error('Gemini berth forecast: normalization failed');
      return null;
    }

    if (Array.isArray(opts.liveOverlays) && opts.liveOverlays.length > 0) {
      out = mergeBerthWithVtmsAndRecompute(out, opts.liveOverlays) || out;
    }

    return out;
  } catch (err) {
    if (err?.name === 'AbortError') {
      console.error('Gemini berth forecast: request timed out');
    } else {
      console.error('Gemini berth forecast call failed:', err);
    }
    return null;
  } finally {
    clearTimeout(t);
  }
}
