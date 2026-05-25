import { spoilageRiskService } from "../services/spoilage-risk.service";

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

export function startSpoilageRiskCron(): void {
  if (timer || !isSpoilageRiskCronEnabled()) {
    return;
  }

  const intervalMs = normalizePositiveNumber(process.env.SPOILAGE_RISK_CRON_INTERVAL_MINUTES, 60) * 60_000;
  const initialDelayMs = normalizePositiveNumber(process.env.SPOILAGE_RISK_CRON_INITIAL_DELAY_SECONDS, 180) * 1000;

  setTimeout(() => {
    void runSpoilageRiskCronOnce();
  }, initialDelayMs).unref?.();

  timer = setInterval(() => {
    void runSpoilageRiskCronOnce();
  }, intervalMs);
  timer.unref?.();
}

export async function runSpoilageRiskCronOnce(): Promise<void> {
  if (running) {
    return;
  }
  running = true;
  try {
    const result = await spoilageRiskService.dispatchSpoilageRiskAlerts({ dedupe: true });
    if (result.householdsScanned > 0 || result.sent > 0 || result.failed > 0) {
      console.log({
        job: "spoilage-risk-cron",
        householdsScanned: result.householdsScanned,
        householdsNotified: result.householdsNotified,
        sent: result.sent,
        failed: result.failed,
      });
    }
  } catch (error) {
    console.error({ job: "spoilage-risk-cron", error });
  } finally {
    running = false;
  }
}

function isSpoilageRiskCronEnabled(): boolean {
  if (process.env.SPOILAGE_RISK_CRON_ENABLED === "true") return true;
  if (process.env.SPOILAGE_RISK_CRON_ENABLED === "false") return false;
  return process.env.NODE_ENV === "production";
}

function normalizePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
