/**
 * promptBuilder.js
 * Dynamic AI system prompt generator for Port Digital Twin.
 * Injects live simulation state and role context into every Gemini API call.
 */

/** Human-readable labels for each scenario ID. */
const SCENARIO_LABELS = {
  heavy_rain: 'Heavy Rain',
  crane_breakdown: 'Crane Breakdown',
  truck_inbound_surge: 'Truck Inbound Surge',
  yard_near_saturation: 'Yard Near Saturation',
  CLOSE_GATE: 'Gate Closure',
  BUNCH_SHIPS: 'Ship Bunching',
  ADD_VESSELS: 'Additional Vessels',
  INCREASE_TRUCKS: 'Increased Truck Volume',
};

/**
 * Few-shot examples demonstrating expected JSON response format.
 * Included in every AI API call as prior assistant turns.
 */
export const fewShotExamples = [
  {
    role: 'user',
    parts: [{ text: 'What happens if Gate 2 closes for 4 hours?' }],
  },
  {
    role: 'model',
    parts: [{ text: JSON.stringify({
      summary: 'Closing Gate 2 for 4 hours will redirect approximately 180 trucks to Gates 1 and 3, increasing their queue lengths by 340% and pushing gate congestion to HIGH within 45 minutes. Expect significant road congestion on the Karal Phata approach road (NH-348), affecting DPD percentage by approximately -8 points.',
      impact: {
        tat_delta: '+3.2 hrs on average',
        congestion_change: 'Gate 1 and 3 reach HIGH within 45 min; NH-348 backlog 12 km',
        carbon_delta: '+12 tons CO2 from extended truck idling',
        affected_vessels: 3,
      },
      recommendations: [
        'Redirect trucks to Gate 4 immediately via PA system announcement',
        'Alert Terminal 2 TOS (FOCUS) for yard adjustment and pre-staging',
        'Request additional traffic personnel at Gate 1 and Gate 3',
        'Coordinate with NMMC for traffic signal prioritization on Uran Road',
      ],
      severity: 'HIGH',
      confidence: 0.89,
    }) }],
  },
  {
    role: 'user',
    parts: [{ text: 'Three vessels are bunching at anchorage. What should I do?' }],
  },
  {
    role: 'model',
    parts: [{ text: JSON.stringify({
      summary: 'With 3 vessels in bunching scenario at Port anchorage, the pre-berthing detention time will spike to 4-6 hours, significantly breaching the RFP threshold of 3 hours. The VTMS should immediately initiate staggered berthing protocols and consider redirecting one vessel to alternate anchorage at Mumbai Roads.',
      impact: {
        tat_delta: '+4.5 hrs pre-berthing detention above threshold',
        congestion_change: 'Anchorage at 85% capacity; pilot boat demand tripled',
        carbon_delta: '+28.6 tons CO2 from 3 vessels idling 4+ hrs each',
        affected_vessels: 3,
      },
      recommendations: [
        'Redirect Vessel 3 to Mumbai Roads alternate anchorage immediately',
        'Assign additional pilot for expedited berthing of highest-priority vessel',
        'Alert JNPCT TOS to pre-clear berth for emergency berthing',
        'Activate VTMS vessel traffic management protocol for bunching scenario',
      ],
      severity: 'HIGH',
      confidence: 0.92,
    }) }],
  },
];

/**
 * Static ML congestion risk forecast array injected into every prompt so the
 * LLM can answer questions about future bottlenecks without a live ML backend.
 */
const ML_CONGESTION_FORECAST = [
  { time: '06:00', risk: 'LOW',    score: 0.18, note: 'Early shift, light gate traffic' },
  { time: '08:00', risk: 'MEDIUM', score: 0.42, note: 'Morning truck surge begins' },
  { time: '10:00', risk: 'HIGH',   score: 0.71, note: 'Peak import delivery window' },
  { time: '12:00', risk: 'MEDIUM', score: 0.55, note: 'Lunch-hour dip in arrivals' },
  { time: '14:00', risk: 'HIGH',   score: 0.78, note: 'Export cutoff for evening vessels' },
  { time: '16:00', risk: 'HIGH',   score: 0.82, note: 'Double peak — worst congestion' },
  { time: '18:00', risk: 'MEDIUM', score: 0.48, note: 'Evening shift handover' },
  { time: '20:00', risk: 'LOW',    score: 0.22, note: 'Night traffic falls off sharply' },
  { time: '00:00', risk: 'LOW',    score: 0.10, note: 'Overnight minimum' },
];

/**
 * Build the dynamic system prompt injected with live port state.
 * @param {SimulationState} simulationState - Current port simulation state
 * @param {string} userRole - Current operator role
 * @returns {string} System prompt string
 */
export function buildSystemPrompt(simulationState, userRole) {
  const {
    vessels = [],
    gates = [],
    trucks = [],
    kpis = {},
    alerts = [],
    weatherScenario = 'CLEAR',
    yard = null,
    containers = [],
    activeScenarioIds = [],
    simTime = 0,
    lastTimingProfile = null,
  } = simulationState;

  const anchored = vessels.filter(v => v.lifecycleState === 'ANCHORED').length;
  const berthing = vessels.filter(v => v.lifecycleState === 'BERTHING').length;
  const loading = vessels.filter(v => v.lifecycleState === 'LOADING').length;
  const approaching = vessels.filter(v => v.lifecycleState === 'APPROACHING').length;

  const gateQueueCount = gates.reduce((sum, g) => sum + (g.queueLength || 0), 0);

  const yardOccupancy = yard
    ? Math.round((yard.currentTEU / yard.capacityTEU) * 100)
    : (kpis.yardOccupancy ?? 0);

  const containersInYard = containers.filter(c => c.status === 'IN_YARD').length;
  const containersOnTruck = containers.filter(c => c.status === 'ON_TRUCK').length;

  const activeAlertTypes = alerts
    .filter(a => !a.dismissed)
    .slice(0, 10)
    .map(a => a.type)
    .join(', ');

  const mlForecastText = ML_CONGESTION_FORECAST
    .map(f => `  ${f.time} → Risk: ${f.risk} (score ${f.score}) — ${f.note}`)
    .join('\n');

  return `You are an AI operations advisor for Port (the Port Authority),
Navi Mumbai — India's largest container port by volume. You assist port controllers
at the Integrated Command and Control Centre (ICCC) with real-time operational decisions.

Current user role: ${userRole}

CURRENT PORT STATE (live simulation data — answer ALL questions based on these constraints):
- Weather Scenario: ${weatherScenario}
- Active vessels: ${vessels.length} total
  • Approaching: ${approaching}
  • Anchored (pre-berthing): ${anchored}
  • Berthing: ${berthing}
  • Loading/Unloading: ${loading}
- Berth occupancy: ${kpis.berthOccupancy || 0}% (threshold: 85%)
- Pre-berthing detention: ${kpis.preBerthingDetention || 0} hrs (threshold: 3 hrs)
- Avg vessel TAT: ${kpis.avgVesselTAT || 0} hrs (target: < 24 hrs)
- Yard capacity: ${yardOccupancy}% full${yard ? ` (${yard.currentTEU.toLocaleString()} / ${yard.capacityTEU.toLocaleString()} TEU)` : ''}
- Containers in yard: ${containersInYard} | On truck: ${containersOnTruck}
- Gates:
  ${gates.map(g => `Gate ${g.id}: ${g.status}, Queue: ${g.queueLength}, Level: ${g.congestionLevel}`).join('\n  ')}
- Total gate queue: ${gateQueueCount} trucks
- Trucks in geo-fence: ${trucks.length} (threshold: 200)
- Gate congestion: ${kpis.gateCongestionLevel || 'UNKNOWN'}
- Carbon emissions index: ${kpis.carbonIndex || 'UNKNOWN'}
- Crane moves/hr: ${kpis.craneMoves || 0}
- Active alerts (${alerts.filter(a => !a.dismissed).length}): ${activeAlertTypes || 'None'}
- Active what-if scenarios: ${activeScenarioIds.length > 0 ? activeScenarioIds.map(id => SCENARIO_LABELS[id] || id).join(' + ') : 'None'}
- Simulation clock: t+${simTime} min${lastTimingProfile ? `\n- Gate processing time: ${lastTimingProfile.gateProcess?.toFixed(1)} min/truck | Customs: ${lastTimingProfile.customsCheck?.toFixed(1)} min | Berth turnaround base: ${lastTimingProfile.berthTurnaround?.toFixed(0)} min` : ''}
${activeScenarioIds.length > 1 ? `
⚠️ COMPOUND CRISIS IN EFFECT ⚠️
${activeScenarioIds.length} scenarios are running SIMULTANEOUSLY: [${activeScenarioIds.map(id => SCENARIO_LABELS[id] || id).join('] + [')}]
You MUST analyze how these scenarios INTERACT and AMPLIFY each other — do not treat them as isolated events.
For example: if Heavy Rain AND Crane Breakdown are both active, the crane vessel's already-extended berth stay is further worsened by slower yard transit and gate processing, creating a cascading backlog for anchored vessels.
Your recommendations must address the COMBINED crisis and explain the cross-scenario amplification effect explicitly.` : ''}

ML CONGESTION FORECAST (next 24 hrs, model-generated):
${mlForecastText}
Use this forecast when the user asks about future bottlenecks, optimal gate opening times, or shift planning.

Port DOMAIN KNOWLEDGE:
- TAT: Vessel Turnaround Time (target < 24 hrs); includes berthing, loading, departure
- DPD: Direct Port Delivery — cargo delivered directly from port to consignee (target ~45%)
- DPE: Direct Port Entry — cargo entered directly without pre-gate staging (target ~40%)
- Pre-berthing detention: Time vessel waits at Port anchorage before berth assigned
- TOS: Terminal Operating System (FOCUS at NSICT, SAP at JNPCT)
- VTMS: Vessel Traffic Management System (iVTS at Port)
- PCS: Port Community System (connects shippers, CHA, banks, customs)
- ULIP: Unified Logistics Interface Platform (GOI integration)
- FOIS: Freight Operations Information System (Indian Railways)
- MMLP: Multimodal Logistics Park
- ICD: Inland Container Depot
- CHA: Customs House Agent
- NSICT: Nhava Sheva International Container Terminal
- JNPCT: the Port Container Terminal
- GTI: Gateway Terminals India

AVAILABLE OPERATOR ACTIONS (refer to these specifically):
- Open or close any gate (Gates 1-4)
- Redirect vessels to alternate anchorage (Mumbai Roads, Dharamtar Creek)
- Activate alternate parking plaza near Karal Phata on NH-348
- Issue PA announcement to truck drivers via Port Traffic Management Centre
- Request additional pilot from Port Pilotage Department for vessel berthing
- Alert TOS (FOCUS/SAP) for yard pre-staging
- Coordinate with NMMC/CIDCO for external traffic management
- Activate emergency response protocol for FIRE_HAZARD or PERIMETER_BREACH

RESPONSE FORMAT (strict JSON only):
{
  "summary": "Concise operational assessment in 2-3 sentences",
  "impact": {
    "tat_delta": "change to vessel TAT with units",
    "congestion_change": "description of congestion impact",
    "carbon_delta": "CO2 impact with units",
    "affected_vessels": <integer>
  },
  "recommendations": ["Action 1", "Action 2", "Action 3", "Action 4"],
  "severity": "LOW | MEDIUM | HIGH | CRITICAL",
  "confidence": <float 0.0-1.0>
}`;
}

/**
 * Build a data-rich, scenario-specific user message for the AI advisor.
 * References live entity data: specific gate numbers, vessel names, queue counts, yard %.
 * @param {string} scenarioId
 * @param {object} state - Current simulation state (from Zustand store snapshot)
 * @returns {string}
 */
export function buildScenarioUserMessage(scenarioId, state) {
  const {
    vessels = [],
    gates = [],
    trucks = [],
    kpis = {},
    yard = null,
    alerts = [],
    activeScenarioIds = [],
    lastTimingProfile = null,
    weatherScenario = 'CLEAR',
  } = state;

  const anchored   = vessels.filter(v => v.lifecycleState === 'ANCHORED');
  const loading    = vessels.filter(v => v.lifecycleState === 'LOADING');
  const approaching = vessels.filter(v => v.lifecycleState === 'APPROACHING');

  const yardPct     = yard
    ? Math.round((yard.currentTEU / yard.capacityTEU) * 100)
    : (kpis.yardOccupancy ?? 0);
  const yardTEU     = yard ? yard.currentTEU.toLocaleString() : '—';
  const yardCapacity = yard ? yard.capacityTEU.toLocaleString() : '—';

  const gateQueueTotal = gates.reduce((s, g) => s + (g.queueLength || 0), 0);
  const highGates   = gates.filter(g => g.congestionLevel === 'HIGH');
  const openGates   = gates.filter(g => g.status === 'OPEN');
  const closedGates = gates.filter(g => g.status === 'CLOSED');
  const gateDetail  = gates.map(g =>
    `Gate ${g.id} (${g.status}, queue: ${g.queueLength}, ${g.congestionLevel})`
  ).join('; ');

  const timingLine = lastTimingProfile
    ? `Gate processing: ${lastTimingProfile.gateProcess?.toFixed(1)} min/truck | Customs: ${lastTimingProfile.customsCheck?.toFixed(1)} min | Berth turnaround base: ${lastTimingProfile.berthTurnaround?.toFixed(0)} min`
    : 'Timing profile: baseline (no active modifier)';

  // Compound scenario: multiple simultaneous what-if events
  if (activeScenarioIds.length > 1) {
    const scenarioNames = activeScenarioIds.map(id => SCENARIO_LABELS[id] || id).join(' AND ');
    const hasRain = activeScenarioIds.includes('heavy_rain');
    const hasCrane = activeScenarioIds.includes('crane_breakdown');
    const hasTrucks = activeScenarioIds.includes('truck_inbound_surge') || activeScenarioIds.includes('INCREASE_TRUCKS');
    const hasYard = activeScenarioIds.includes('yard_near_saturation');
    const hasBunching = activeScenarioIds.includes('BUNCH_SHIPS');

    const craneVessel = loading.find(v => v.assignedCranes === 1) ?? loading[0];
    const yardPctStr = `${yardPct}% (${yardTEU} / ${yardCapacity} TEU)`;

    const compoundEffects = [];
    if (hasRain && hasCrane) {
      compoundEffects.push(
        `Rain + Crane Breakdown: Slower yard transit (×1.4) COMBINED with reduced crane throughput on ${craneVessel?.name ?? 'affected vessel'} — berth stay is doubly extended, increasing anchorage backlog for ${anchored.length} waiting vessel(s)`
      );
    }
    if (hasRain && hasTrucks) {
      compoundEffects.push(
        `Rain + Truck Surge: Gate processing is ×1.5 slower AND truck arrival rate is ×2 higher — gate queues will spike to HIGH congestion approximately 3× faster than either scenario alone`
      );
    }
    if (hasCrane && hasYard) {
      compoundEffects.push(
        `Crane Breakdown + Yard Saturation: Extended berth stay on ${craneVessel?.name ?? 'affected vessel'} is discharging TEU into a yard already at ${yardPct}% — risk of yard lockout is CRITICAL`
      );
    }
    if (hasBunching && hasRain) {
      compoundEffects.push(
        `Ship Bunching + Rain: Pilot boat operations are slower in rain, extending pre-berthing detention beyond the 3-hr RFP threshold for all ${anchored.length} anchored vessels simultaneously`
      );
    }
    if (compoundEffects.length === 0) {
      compoundEffects.push(
        `Combined effect of [${scenarioNames}]: each scenario multiplies the operational delay of the other — total system stress is greater than the sum of individual impacts`
      );
    }

    return `COMPOUND CRISIS ACTIVE — The following scenarios are running SIMULTANEOUSLY:
Scenarios: [${scenarioNames}]

CROSS-SCENARIO CASCADE EFFECTS:
${compoundEffects.map((e, i) => `${i + 1}. ${e}`).join('\n')}

LIVE PORT STATE:
Gate state: ${gateDetail}
Total gate queue: ${gateQueueTotal} trucks | Trucks in geo-fence: ${trucks.length} (threshold: 200)
${highGates.length > 0 ? `HIGH congestion gates: ${highGates.map(g => `Gate ${g.id} (queue: ${g.queueLength})`).join(', ')}` : 'No gates at HIGH yet — monitor closely'}
Anchored vessels (${anchored.length}): ${anchored.map(v => `${v.name} (waited ${v.waitHours?.toFixed(1) ?? '?'} hrs)`).join(', ') || 'none'}
Loading vessels (${loading.length}): ${loading.map(v => `${v.name} — ${v.assignedCranes} crane(s) at berth ${v.berthNumber ?? '?'}`).join(', ') || 'none'}
Yard: ${yardPctStr} | Berth occupancy: ${kpis.berthOccupancy || 0}% (threshold: 85%)
Pre-berthing detention: ${kpis.preBerthingDetention || 0} hrs (threshold: 3 hrs) | Avg vessel TAT: ${kpis.avgVesselTAT || 0} hrs (target: <24 hrs)
Carbon index: ${kpis.carbonIndex || 'UNKNOWN'} | Active alerts: ${alerts.filter(a => !a.dismissed).length}
${timingLine}

INSTRUCTIONS:
This is a COMPOUND CRISIS — your analysis MUST:
1. Explicitly explain how the simultaneous scenarios interact and amplify each other's impact (do not treat them as independent events)
2. Prioritize recommendations that address the most dangerous cross-scenario cascades first
3. Name specific vessels, gate numbers, and yard blocks in every recommendation
4. Quantify the combined TAT impact and carbon penalty compared to normal operations
5. Identify which single intervention would give the most relief across all active scenarios simultaneously`;
  }

  switch (scenarioId) {
    case 'CLOSE_GATE': {
      const closed = closedGates[0];
      const redirectOptions = openGates.filter(g => !closed || g.id !== closed.id);
      return `SCENARIO ACTIVE — Gate closure has been applied.
Closed gate(s): ${closedGates.map(g => `Gate ${g.id}`).join(', ') || 'Pending confirmation'}
Remaining open gates: ${redirectOptions.map(g => `Gate ${g.id} (queue: ${g.queueLength}, ${g.congestionLevel})`).join(', ')}
Current gate state: ${gateDetail}
Trucks in geo-fence: ${trucks.length} | Total gate queue: ${gateQueueTotal} trucks
Yard: ${yardPct}% full (${yardTEU} / ${yardCapacity} TEU) | Berth occupancy: ${kpis.berthOccupancy || 0}%
Carbon index: ${kpis.carbonIndex || 'UNKNOWN'} (idling trucks worsen emissions)
${timingLine}

With ${closedGates.map(g => `Gate ${g.id}`).join(', ') || 'a gate'} now closed, analyze the truck redirection impact and provide specific recommendations: which open gates (by number) to redirect diverted trucks to, whether the Karal Phata alternate parking plaza should be activated on NH-348, whether a PA system announcement should be issued to inbound drivers, and the estimated time before Gate ${redirectOptions[0]?.id ?? '—'} reaches HIGH congestion at current arrival rates. Include carbon impact of extended idling.`;
    }

    case 'heavy_rain': {
      return `SCENARIO ACTIVE — Heavy rain weather conditions are now in effect.
Weather: ${weatherScenario}
Timing impact: ${timingLine}
Gate queues: ${gateDetail} | Total queue: ${gateQueueTotal} trucks
Trucks in geo-fence: ${trucks.length} (threshold: 200)
Anchored vessels (${anchored.length}): ${anchored.map(v => `${v.name} (waited ${v.waitHours?.toFixed(1)} hrs)`).join(', ') || 'none'}
Loading vessels (${loading.length}): ${loading.map(v => `${v.name} — ${v.assignedCranes} crane(s) at berth ${v.berthNumber ?? '?'}`).join(', ') || 'none'}
Yard: ${yardPct}% (${yardTEU} TEU) | Pre-berthing detention: ${kpis.preBerthingDetention || 0} hrs (threshold: 3 hrs)
Berth occupancy: ${kpis.berthOccupancy || 0}%

Analyze the cascading impact of heavy rain on Port operations. Provide specific recommendations: which gates to prioritize to compensate for slower processing, whether shift hours should be extended for gate staff, how to stagger incoming truck arrivals on NH-348, and how to protect pre-berthing detention SLA for ${anchored.map(v => v.name).join(', ') || 'anchored vessels'}. Name specific gates and vessels in your response.`;
    }

    case 'crane_breakdown': {
      const craneVessel = loading.find(v => v.assignedCranes === 1) ?? loading[0];
      return `SCENARIO ACTIVE — Crane breakdown on a berthed vessel.
Affected vessel: ${craneVessel ? `${craneVessel.name} at berth ${craneVessel.berthNumber ?? 'unknown'} — now operating with ${craneVessel.assignedCranes} crane (reduced)` : 'Unconfirmed — check VTMS feed'}
Wait hours accumulated: ${craneVessel?.waitHours?.toFixed(1) ?? '—'} hrs
All loading vessels: ${loading.map(v => `${v.name} (${v.assignedCranes} crane(s), berth ${v.berthNumber ?? '?'})`).join(', ') || 'none'}
Crane moves/hr: ${kpis.craneMoves || 0} (reduced from breakdown)
Berth occupancy: ${kpis.berthOccupancy || 0}% (threshold: 85%) | Avg vessel TAT: ${kpis.avgVesselTAT || 0} hrs (target: <24 hrs)
Anchored waiting (${anchored.length}): ${anchored.map(v => `${v.name} (wait: ${v.waitHours?.toFixed(1)} hrs)`).join(', ') || 'none'}
Pre-berthing detention: ${kpis.preBerthingDetention || 0} hrs (threshold: 3 hrs)

Analyze the crane breakdown impact for ${craneVessel?.name ?? 'the affected vessel'}. Provide specific recommendations: whether to request emergency crane maintenance from JNPCT/NSICT, whether the vessel should be moved to another berth, how to manage the queue for ${anchored.length} waiting vessel(s) by priority, and the estimated additional TAT penalty at the reduced crane rate. Reference specific vessel names, berth numbers, and current queue waits.`;
    }

    case 'truck_inbound_surge': {
      return `SCENARIO ACTIVE — Truck inbound surge (higher arrival rate applied to all gates).
Gate state: ${gateDetail}
Total gate queue: ${gateQueueTotal} trucks | Trucks in geo-fence: ${trucks.length} (threshold: 200)
${highGates.length > 0 ? `HIGH congestion gates: ${highGates.map(g => `Gate ${g.id} (queue: ${g.queueLength})`).join(', ')}` : 'No gates at HIGH congestion yet'}
${timingLine}
Yard: ${yardPct}% (${yardTEU} TEU) | Carbon index: ${kpis.carbonIndex || 'UNKNOWN'} (rising from truck idling)

Analyze the surge impact on gate throughput and carbon emissions. Provide specific recommendations: which gate(s) by number to open additional lanes for, whether to activate the Karal Phata alternate parking plaza on NH-348, whether to issue a PA announcement to stagger arrival times, and how to coordinate with NMMC/CIDCO for traffic signal prioritization on Uran Road. Calculate estimated time before each gate reaches HIGH congestion at current arrival rates based on queue length and processing time.`;
    }

    case 'yard_near_saturation': {
      return `SCENARIO ACTIVE — Yard near-saturation scenario activated (~90% occupancy).
Yard state: ${yardPct}% full (${yardTEU} / ${yardCapacity} TEU)
DPD target: ~45% (CRITICAL: yard saturation blocks direct port delivery flow)
Loading vessels (${loading.length}): ${loading.map(v => `${v.name} — est. TEU: ~${v.teuEstimate?.value?.toLocaleString() ?? 'unknown'}`).join(', ') || 'none'}
Approaching vessels (${approaching.length}): ${approaching.map(v => v.name).join(', ') || 'none'} — will add TEU on berthing
Gate queues: ${gateDetail} | Total queue: ${gateQueueTotal} trucks
Pre-berthing detention: ${kpis.preBerthingDetention || 0} hrs | Berth occupancy: ${kpis.berthOccupancy || 0}%
Active unresolved alerts: ${alerts.filter(a => !a.dismissed).length}

Analyze the yard saturation risk. Provide specific recommendations: whether to delay berth assignment for ${approaching.length > 0 ? approaching.map(v => v.name).join(', ') : 'incoming vessels'}, how to prioritize DPD delivery for high-dwell containers, whether to coordinate with FOIS/Indian Railways to offload TEU via rail to an ICD, and whether to alert TOS (FOCUS/SAP) for emergency yard redistribution. State which yard blocks are at highest risk and the estimated hours to full capacity given current inflow rate.`;
    }

    case 'BUNCH_SHIPS': {
      return `SCENARIO ACTIVE — Ship bunching event at Port anchorage.
Anchored vessels (${anchored.length}): ${anchored.map(v => `${v.name} (waited ${v.waitHours?.toFixed(1)} hrs, emitting ${v.emissionsRate?.toFixed(2)} t CO₂/hr)`).join(', ') || 'bunching confirmed'}
Pre-berthing detention: ${kpis.preBerthingDetention || 0} hrs — ${(kpis.preBerthingDetention || 0) > 3 ? 'BREACH of 3-hr RFP threshold' : 'approaching 3-hr RFP threshold'}
Berth occupancy: ${kpis.berthOccupancy || 0}% | Loading vessels in berth: ${loading.length} (${loading.map(v => v.name).join(', ') || 'none'})
Pilot status: ${vessels.filter(v => v.pilotAssigned).length} assigned, ${vessels.filter(v => !v.pilotAssigned && v.lifecycleState !== 'DEPARTED').length} pending
Total anchorage carbon penalty: ${anchored.reduce((s, v) => s + (v.emissionsRate || 0), 0).toFixed(1)} t CO₂/hr from idling

Analyze the bunching scenario for ${anchored.length} vessels at Port anchorage. Provide specific recommendations in priority order: which vessel(s) by name to redirect to Mumbai Roads or Dharamtar Creek alternate anchorage, which vessel to assign the next available pilot to, how to sequence remaining vessels for staggered berthing using VTMS protocol, and the total carbon penalty over the next 4 hours if no action is taken. Name each vessel in priority order.`;
    }

    case 'ADD_VESSELS': {
      return `SCENARIO ACTIVE — 3 additional incoming vessels added to the queue.
Approaching (${approaching.length}): ${approaching.map(v => v.name).join(', ') || 'incoming vessels confirmed'}
Anchored (${anchored.length}): ${anchored.map(v => `${v.name} (wait: ${v.waitHours?.toFixed(1)} hrs)`).join(', ') || 'none'}
Berth occupancy: ${kpis.berthOccupancy || 0}% (threshold: 85%) | Loading in berth: ${loading.length}
Pre-berthing detention: ${kpis.preBerthingDetention || 0} hrs (threshold: 3 hrs)
Yard: ${yardPct}% (${yardTEU} TEU) — additional vessels will load further TEU
Pilots awaiting assignment: ${vessels.filter(v => !v.pilotAssigned && ['APPROACHING', 'ANCHORED'].includes(v.lifecycleState)).length}

Analyze the impact of 3 additional incoming vessels on berth capacity and anchorage queuing. Provide specific recommendations: which approaching vessels to prioritize for berth assignment first (by name), whether to request additional pilots from Port Pilotage Department, whether to pre-alert TOS (FOCUS/SAP) for yard pre-staging, and the estimated time before berth occupancy crosses the 85% threshold at the current turnaround rate. Reference specific vessel names in your priority ordering.`;
    }

    case 'INCREASE_TRUCKS': {
      return `SCENARIO ACTIVE — Truck volume increased (+50 trucks added to geo-fence).
Gate state: ${gateDetail}
Trucks in geo-fence: ${trucks.length} (threshold: 200) | Total gate queue: ${gateQueueTotal} trucks
${highGates.length > 0 ? `HIGH congestion: ${highGates.map(g => `Gate ${g.id} (queue: ${g.queueLength})`).join(', ')}` : 'No gates at HIGH congestion yet — monitor closely'}
${timingLine}
Carbon index: ${kpis.carbonIndex || 'UNKNOWN'} — truck idling is primary driver
Yard: ${yardPct}% (${yardTEU} TEU)

Analyze the increased truck volume impact on gate operations and carbon emissions. Provide specific recommendations: which gate(s) by number to open additional lanes or extend operating hours for, whether to activate the Karal Phata alternate parking plaza on NH-348, whether to coordinate with NMMC/CIDCO for traffic signal prioritization on Uran Road, and how to prioritize DPE (Direct Port Entry) trucks to reduce gate dwell time. Calculate per-truck wait time at Gate ${gates[0]?.id ?? 1} given current queue and processing rate.`;
    }

    default: {
      const scenarioLabel = activeScenarioIds.length > 0 ? activeScenarioIds.join(', ') : scenarioId;
      return `SCENARIO ACTIVE — What-if simulation: ${scenarioLabel}.
Vessels: ${vessels.length} total (approaching: ${approaching.length}, anchored: ${anchored.length}, loading: ${loading.length})
Gate state: ${gateDetail}
Total gate queue: ${gateQueueTotal} trucks | Trucks in geo-fence: ${trucks.length}
Yard: ${yardPct}% (${yardTEU} TEU) | Berth occupancy: ${kpis.berthOccupancy || 0}%
Pre-berthing detention: ${kpis.preBerthingDetention || 0} hrs | Avg vessel TAT: ${kpis.avgVesselTAT || 0} hrs
Carbon index: ${kpis.carbonIndex || 'UNKNOWN'} | Active alerts: ${alerts.filter(a => !a.dismissed).length}
${timingLine}

Analyze the current port situation given the active scenario and provide specific, data-driven operational recommendations that reference exact gate numbers, vessel names, and threshold values from the live state above.`;
    }
  }
}
