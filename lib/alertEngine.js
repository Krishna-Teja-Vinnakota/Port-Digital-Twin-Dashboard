/**
 * alertEngine.js
 * Rule-based alert engine for Port Digital Twin.
 * Evaluates threshold conditions and fires typed alerts per Port RFP terminology.
 */

/**
 * Port RFP alert type definitions with severity and color encoding.
 */
export const ALERT_TYPES = {
  GATE_OVERLOAD:      { severity: 'HIGH',     color: 'red'    },
  VESSEL_BUNCHING:    { severity: 'HIGH',     color: 'red'    },
  HIGH_EMISSIONS:     { severity: 'MEDIUM',   color: 'amber'  },
  PRE_BERTHING_DELAY: { severity: 'MEDIUM',   color: 'amber'  },
  POWER_FAULT:        { severity: 'HIGH',     color: 'red'    },
  FIRE_HAZARD:        { severity: 'CRITICAL', color: 'red'    },
  PERIMETER_BREACH:   { severity: 'HIGH',     color: 'red'    },
  ENCROACHMENT:       { severity: 'MEDIUM',   color: 'amber'  },
  RAKE_DELAY:         { severity: 'LOW',      color: 'blue'   },
  VESSEL_DELAY:       { severity: 'LOW',      color: 'blue'   },
  HIGH_BERTH_OCCUPANCY: { severity: 'MEDIUM', color: 'amber'  },
  TRUCK_SURGE:        { severity: 'MEDIUM',   color: 'amber'  },
};

let alertIdCounter = 1;

/**
 * Create a new alert object.
 * @param {string} type
 * @param {string} message
 * @param {string} affectedEntity
 * @returns {Alert}
 */
function createAlert(type, message, affectedEntity) {
  const def = ALERT_TYPES[type] || { severity: 'LOW', color: 'blue' };
  return {
    id: `ALT-${String(alertIdCounter++).padStart(4, '0')}`,
    type,
    severity: def.severity,
    color: def.color,
    message,
    affectedEntity,
    timestamp: new Date().toISOString(),
    dismissed: false,
    origin: 'SIMULATED',
    source: 'RULE_ENGINE_SIMULATION',
  };
}

/**
 * Evaluate all alert conditions and return newly triggered alerts.
 * Based on RFP rule-based logic from Feature 8.
 * @param {SimulationState} state
 * @returns {Alert[]}
 */
export function checkAllAlerts(state) {
  const { vessels = [], gates = [], trucks = [], kpis = {}, simulationFlags = {} } = state;
  const alerts = [];

  // Rule 1: Vessel bunching — 3+ vessels with ETA within 2 hours
  const now = Date.now();
  const imminent = vessels.filter(v => {
    const etaMs = new Date(v.eta).getTime();
    return (etaMs - now) < 2 * 3600000 && v.lifecycleState === 'APPROACHING';
  });
  if (imminent.length >= 3 || simulationFlags.bunchingActive) {
    alerts.push(createAlert(
      'VESSEL_BUNCHING',
      `${imminent.length || 5} vessels approaching within 2-hour window — anchorage capacity at risk`,
      `Vessels: ${imminent.slice(0, 3).map(v => v.name).join(', ') || 'Multiple'}`
    ));
  }

  // Rule 2: Gate overload
  for (const gate of gates) {
    if (gate.queueLength > 50 || gate.status === 'CLOSED') {
      alerts.push(createAlert(
        'GATE_OVERLOAD',
        `Gate ${gate.id} queue at ${gate.queueLength} trucks — threshold exceeded`,
        `Gate ${gate.id} - ${gate.name}`
      ));
    }
  }

  // Rule 3: Pre-berthing detention spike
  if (kpis.preBerthingDetention > 3) {
    alerts.push(createAlert(
      'PRE_BERTHING_DELAY',
      `Pre-berthing detention at ${kpis.preBerthingDetention} hrs — exceeds 3-hr RFP threshold`,
      'VTMS / Anchorage Control'
    ));
  }

  // Rule 4: High carbon emissions
  if (kpis.carbonIndex === 'HIGH') {
    alerts.push(createAlert(
      'HIGH_EMISSIONS',
      `Carbon emissions index at HIGH — ${vessels.filter(v => v.lifecycleState === 'ANCHORED').length} vessels idling at anchorage`,
      'Environmental Control - CPCB'
    ));
  }

  // Rule 5: Berth occupancy > 85%
  if (kpis.berthOccupancy > 85) {
    alerts.push(createAlert(
      'HIGH_BERTH_OCCUPANCY',
      `Berth occupancy at ${kpis.berthOccupancy}% — exceeds 85% threshold, vessel queueing expected`,
      'Terminal Operations - TOS'
    ));
  }

  // Rule 6: Truck surge
  if (trucks.length > 200) {
    alerts.push(createAlert(
      'TRUCK_SURGE',
      `${trucks.length} trucks in geo-fence zone — exceeds 200-truck threshold`,
      'Gate Control / Traffic Management'
    ));
  }

  return alerts;
}
