class StreamAnalyzer {
  analyze(segments, retentionThreshold = 0.5, minHours = 6) {
    const blockDurationHours = segments[0].durationMinutes / 60;
    const peakViewers = Math.max(...segments.map(s => s.avgViewers));
    let cumulativeViewerHours = 0;
    let totalDecay = 0;
    let decayCount = 0;
    const curve = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const hoursElapsed = (i + 1) * blockDurationHours;
      const viewerRetention = seg.avgViewers / peakViewers;
      cumulativeViewerHours += seg.avgViewers * blockDurationHours;

      let decayRate = 0;
      if (i > 0) {
        decayRate = (segments[i - 1].avgViewers - seg.avgViewers) / segments[i - 1].avgViewers;
        totalDecay += decayRate;
        decayCount++;
      }

      curve.push({
        block: i + 1,
        time: Math.round(hoursElapsed * 100) / 100,
        avgViewers: seg.avgViewers,
        viewerRetention: Math.round(viewerRetention * 10000) / 100,
        cumulativeViewerHours: Math.round(cumulativeViewerHours * 100) / 100,
        decayRate: Math.round(decayRate * 10000) / 100,
      });
    }

    let peakIdx = 0;
    for (let i = 1; i < curve.length; i++) {
      if (curve[i].avgViewers > curve[peakIdx].avgViewers) {
        peakIdx = i;
      }
    }

    let optimalStopTime = curve[curve.length - 1].time;
    for (let i = peakIdx + 1; i < curve.length; i++) {
      if (curve[i].viewerRetention / 100 < retentionThreshold) {
        optimalStopTime = curve[i - 1].time;
        break;
      }
    }
    if (optimalStopTime < minHours) {
      optimalStopTime = minHours;
    }

    const kneeSegment = curve.find(p => p.time === optimalStopTime);
    const retentionAtStop = kneeSegment
      ? kneeSegment.viewerRetention
      : curve[curve.length - 1].viewerRetention;
    const avgDecayRate = decayCount > 0
      ? (totalDecay / decayCount) / blockDurationHours * 100
      : 0;
    const avgViewers = segments.reduce((sum, s) => sum + s.avgViewers, 0) / segments.length;

    return {
      peakViewers,
      avgViewers: Math.round(avgViewers * 10) / 10,
      totalViewerHours: Math.round(cumulativeViewerHours * 10) / 10,
      optimalStopTime,
      retentionAtStop: Math.round(retentionAtStop * 10) / 10,
      avgDecayRate: Math.round(avgDecayRate * 100) / 100,
      curve,
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StreamAnalyzer };
}
