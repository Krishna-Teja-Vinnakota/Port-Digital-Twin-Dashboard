import type { Alert, Gate, Vessel } from '@/store/useSimulationStore';
import type { CameraAnalytics } from '@/lib/opencvProxy';

const TOTAL_BERTHS = 23;

function isLiveSource(source: string): boolean {
  return source.toUpperCase().includes('LIVE');
}

function severityMeta(type: string): Pick<Alert, 'severity' | 'color'> {
  const map: Record<string, Pick<Alert, 'severity' | 'color'>> = {
    GATE_OVERLOAD: { severity: 'HIGH', color: 'red' },
    VESSEL_BUNCHING: { severity: 'HIGH', color: 'red' },
    PRE_BERTHING_DELAY: { severity: 'MEDIUM', color: 'amber' },
    HIGH_EMISSIONS: { severity: 'MEDIUM', color: 'amber' },
    HIGH_BERTH_OCCUPANCY: { severity: 'MEDIUM', color: 'amber' },
    TRUCK_SURGE: { severity: 'MEDIUM', color: 'amber' },
    PERIMETER_BREACH: { severity: 'CRITICAL', color: 'red' },
  };
  return map[type] || { severity: 'LOW', color: 'blue' };
}

function createAlert(
  id: string,
  type: string,
  message: string,
  affectedEntity: string,
  source: string
): Alert {
  const meta = severityMeta(type);
  return {
    id,
    type,
    ...meta,
    message,
    affectedEntity,
    timestamp: new Date().toISOString(),
    dismissed: false,
    origin: isLiveSource(source) ? 'LIVE' : 'SIMULATED',
    source,
  };
}

interface BuildLiveAlertInputs {
  vessels: Vessel[];
  vesselSource: string;
  gates: Gate[];
  gateSource: string;
  trucksCount: number;
  truckSource: string;
  camera: CameraAnalytics | null;
}

export function buildOperationalAlerts({
  vessels,
  vesselSource,
  gates,
  gateSource,
  trucksCount,
  truckSource,
  camera,
}: BuildLiveAlertInputs): Alert[] {
  const alerts: Alert[] = [];
  const now = Date.now();

  const imminent = vessels.filter((v) => {
    if (v.lifecycleState !== 'APPROACHING') return false;
    const etaMs = new Date(v.eta).getTime();
    return etaMs > now && etaMs - now <= 2 * 60 * 60 * 1000;
  });
  if (imminent.length >= 3) {
    alerts.push(
      createAlert(
        'ALERT-VESSEL_BUNCHING-2H',
        'VESSEL_BUNCHING',
        `${imminent.length} vessels approaching within 2-hour window — anchorage capacity at risk`,
        `Vessels: ${imminent
          .slice(0, 3)
          .map((v) => v.name)
          .join(', ')}`,
        vesselSource
      )
    );
  }

  for (const gate of gates) {
    if (gate.queueLength > 50 || gate.status === 'CLOSED') {
      const gateMessage =
        gate.status === 'CLOSED'
          ? `Gate ${gate.id} is CLOSED — traffic diversion in effect`
          : `Gate ${gate.id} queue at ${gate.queueLength} trucks — threshold exceeded`;
      alerts.push(
        createAlert(
          `ALERT-GATE_OVERLOAD-${gate.id}`,
          'GATE_OVERLOAD',
          gateMessage,
          `Gate ${gate.id} - ${gate.name}`,
          gateSource
        )
      );
    }
  }

  const anchored = vessels.filter((v) => v.lifecycleState === 'ANCHORED');
  if (anchored.length > 0) {
    const avgWait =
      anchored.reduce((sum, v) => sum + (Number.isFinite(v.waitHours) ? v.waitHours : 0), 0) /
      anchored.length;

    if (avgWait > 3) {
      alerts.push(
        createAlert(
          'ALERT-PRE_BERTHING_DELAY',
          'PRE_BERTHING_DELAY',
          `Pre-berthing detention at ${avgWait.toFixed(1)} hrs — exceeds 3-hr threshold`,
          'VTMS / Anchorage Control',
          vesselSource
        )
      );
    }

    const anchoredEmissionsPerHour = anchored.reduce(
      (sum, v) => sum + (Number.isFinite(v.emissionsRate) ? v.emissionsRate : 0),
      0
    );
    if (anchoredEmissionsPerHour > 80) {
      alerts.push(
        createAlert(
          'ALERT-HIGH_EMISSIONS',
          'HIGH_EMISSIONS',
          `Carbon emissions index at HIGH — ${anchored.length} vessels idling at anchorage`,
          'Environmental Control - CPCB',
          vesselSource
        )
      );
    }
  }

  const occupiedBerths = vessels.filter((v) =>
    ['BERTHING', 'LOADING'].includes(v.lifecycleState)
  ).length;
  const berthOccupancy = (occupiedBerths / TOTAL_BERTHS) * 100;
  if (berthOccupancy > 85) {
    alerts.push(
      createAlert(
        'ALERT-HIGH_BERTH_OCCUPANCY',
        'HIGH_BERTH_OCCUPANCY',
        `Berth occupancy at ${berthOccupancy.toFixed(
          1
        )}% — exceeds 85% threshold, vessel queueing expected`,
        'Terminal Operations - TOS',
        vesselSource
      )
    );
  }

  if (trucksCount > 200) {
    alerts.push(
      createAlert(
        'ALERT-TRUCK_SURGE',
        'TRUCK_SURGE',
        `${trucksCount} trucks in geo-fence zone — exceeds 200-truck threshold`,
        'Gate Control / Traffic Management',
        truckSource
      )
    );
  }

  if (camera?.intrusionDetected) {
    const impactedZones = camera.zones
      .filter((z) => z.intrusion)
      .map((z) => z.zoneName)
      .join(', ');
    alerts.push(
      createAlert(
        'ALERT-PERIMETER_BREACH',
        'PERIMETER_BREACH',
        `Unauthorized vehicle/person detected — Zone: ${impactedZones || 'Perimeter'}`,
        'Zone-C Perimeter - CCTV Surveillance',
        camera.source
      )
    );
  }

  const severityRank: Record<Alert['severity'], number> = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
  };

  return alerts.sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
}
