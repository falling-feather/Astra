// Upgrade baselines are explicit: adding a release must not silently weaken its gate.
const policies = {
  '1.0.0': ['V0.9.3', 'V0.9.4'],
  '3.0.1': ['V3.0.0'],
};

export function releaseBaselines(version) {
  const baselines = policies[version];
  if (!baselines) throw new Error(`版本 ${version} 尚未定义严格发布收据策略`);
  return [...baselines];
}

export function baselineStopMode(ref) {
  return ref === 'V0.9.3'
    ? 'forced_crash_then_explicit_stale_lease_recovery'
    : 'ipc_graceful_close';
}
