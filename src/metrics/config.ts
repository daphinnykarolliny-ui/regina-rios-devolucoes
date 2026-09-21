export const metricsConfig = {
  maturityLagDays: Number(process.env.METRICS_MATURITY_LAG_DAYS ?? 30),
  minVolumeThreshold: Number(process.env.METRICS_MIN_VOLUME_THRESHOLD ?? 15),
};
