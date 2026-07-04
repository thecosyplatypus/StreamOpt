// ============================================================
// Twitch API
// ============================================================
const TWITCH_AUTH_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_API_URL = 'https://api.twitch.tv/helix';

class TwitchAPI {
  constructor() {
    this.accessToken = null;
    this.clientId = null;
    this.tokenExpiresAt = 0;
  }

  async connect(clientId, clientSecret) {
    const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' });
    const res = await fetch(TWITCH_AUTH_URL + '?' + params, { method: 'POST' });
    if (!res.ok) throw new Error('Auth failed (' + res.status + '): ' + (await res.text()));
    const data = await res.json();
    this.accessToken = data.access_token;
    this.clientId = clientId;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
  }

  isConnected() { return !!this.accessToken; }

  async _fetch(path) {
    if (!this.accessToken || !this.clientId) throw new Error('Not connected.');
    const res = await fetch(TWITCH_API_URL + path, {
      headers: { 'Authorization': 'Bearer ' + this.accessToken, 'Client-Id': this.clientId },
    });
    if (res.status === 401) throw new Error('Token expired. Reconnect.');
    if (!res.ok) throw new Error('API error (' + res.status + '): ' + (await res.text()));
    return res.json();
  }

  async getUser(login) { return this._fetch('/users?login=' + encodeURIComponent(login)); }
  async getVODs(userId, first = 50) { return this._fetch('/videos?user_id=' + userId + '&type=archive&first=' + first); }
  async getStream(login) { return this._fetch('/streams?user_login=' + encodeURIComponent(login)); }
}

// ============================================================
// Curve Estimator
// ============================================================
function parseDuration(str) {
  if (!str) return 1;
  var h = 0, m = 0, s = 0;
  var hm = str.match(/(\d+)h/), mm = str.match(/(\d+)m/), sm = str.match(/(\d+)s/);
  if (hm) h = parseInt(hm[1]);
  if (mm) m = parseInt(mm[1]);
  if (sm) s = parseInt(sm[1]);
  return Math.max(0.5, h + m / 60 + s / 3600);
}

function generateEstimatedCurve(vod) {
  var durationHours = parseDuration(vod.duration);
  var numSegments = Math.max(2, Math.round(durationHours / 0.5));
  var estimatedPeak = Math.max(5, Math.round((vod.view_count || 100) * 0.04));
  var segments = [];
  for (var i = 0; i < numSegments; i++) {
    var t = i / numSegments;
    var factor = t < 0.2 ? 0.35 + (t / 0.2) * 0.65 : Math.exp(-1.8 * (t - 0.2));
    var viewers = Math.max(1, Math.round(estimatedPeak * factor));
    segments.push({ segmentIndex: i, durationMinutes: 30, avgViewers: i === 0 ? Math.max(1, Math.round(viewers * 0.6)) : viewers });
  }
  return segments;
}

// ============================================================
// LiveTracker
// ============================================================
class LiveTracker {
  constructor(twitchApi) {
    this.twitch = twitchApi;
    this.channel = '';
    this.dataPoints = [];
    this.streamStartedAt = 0;
    this._pollInterval = null;
    this._timerInterval = null;
    this.onUpdate = null;
    this.onStreamEnd = null;
    this.lastStreamId = null;
  }

  isTracking() { return this._pollInterval !== null; }

  start(channel, callbacks) {
    this.channel = channel;
    this.dataPoints = [];
    this.streamStartedAt = Date.now();
    this.lastStreamId = null;
    this.onUpdate = callbacks.onUpdate || null;
    this.onStreamEnd = callbacks.onStreamEnd || null;

    this._pollNow();
    this._pollInterval = setInterval(this._pollNow.bind(this), 60000);
    this._timerInterval = setInterval(this._tick.bind(this), 1000);
  }

  stop() {
    if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
    if (this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null; }
  }

  getSegments() {
    if (this.dataPoints.length < 2) return [];
    var buckets = {};
    for (var i = 0; i < this.dataPoints.length; i++) {
      var elapsedMin = (this.dataPoints[i].timestamp - this.streamStartedAt) / 60000;
      var idx = Math.floor(elapsedMin / 30);
      if (!buckets[idx]) buckets[idx] = [];
      buckets[idx].push(this.dataPoints[i].viewers);
    }
    var result = [];
    var keys = Object.keys(buckets).map(Number).sort(function(a, b) { return a - b; });
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      var arr = buckets[k];
      result.push({
        segmentIndex: k,
        durationMinutes: 30,
        avgViewers: Math.round(arr.reduce(function(s, v) { return s + v; }, 0) / arr.length),
      });
    }
    return result;
  }

  getStats() {
    var elapsed = this.dataPoints.length > 0 ? this.dataPoints[this.dataPoints.length - 1].timestamp - this.streamStartedAt : 0;
    var current = this.dataPoints.length > 0 ? this.dataPoints[this.dataPoints.length - 1].viewers : 0;
    return { durationMs: elapsed, currentViewers: current, dataPointCount: this.dataPoints.length };
  }

  _pollNow() {
    var self = this;
    this.twitch.getStream(this.channel).then(function(data) {
      var streams = data.data || [];
      if (streams.length > 0) {
        var stream = streams[0];
        self.lastStreamId = stream.id;
        self.dataPoints.push({ timestamp: Date.now(), viewers: stream.viewer_count });
        if (self.onUpdate) self.onUpdate();
      } else {
        self.stop();
        if (self.onStreamEnd) self.onStreamEnd();
      }
    }).catch(function(err) {
      self.stop();
      if (self.onStreamEnd) self.onStreamEnd(err.message);
    });
  }

  _tick() {
    if (this.onUpdate) this.onUpdate();
  }
}

// ============================================================
// StreamAnalyzer
// ============================================================
class StreamAnalyzer {
  analyze(segments, retentionThreshold, minHours) {
    if (retentionThreshold === undefined) retentionThreshold = 0.5;
    if (minHours === undefined) minHours = 6;
    var blockDurationHours = segments[0].durationMinutes / 60;
    var peakViewers = Math.max.apply(null, segments.map(function(s) { return s.avgViewers; }));
    var cumulativeViewerHours = 0;
    var totalDecay = 0;
    var decayCount = 0;
    var curve = [];

    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var hoursElapsed = (i + 1) * blockDurationHours;
      var viewerRetention = seg.avgViewers / peakViewers;
      cumulativeViewerHours += seg.avgViewers * blockDurationHours;

      var decayRate = 0;
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

    var peakIdx = 0;
    for (var j = 1; j < curve.length; j++) {
      if (curve[j].avgViewers > curve[peakIdx].avgViewers) peakIdx = j;
    }

    var optimalStopTime = curve[curve.length - 1].time;
    for (var k = peakIdx + 1; k < curve.length; k++) {
      if (curve[k].viewerRetention / 100 < retentionThreshold) {
        optimalStopTime = curve[k - 1].time;
        break;
      }
    }
    if (optimalStopTime < minHours) optimalStopTime = minHours;

    var kneeSegment = curve.find(function(p) { return p.time === optimalStopTime; });
    var retentionAtStop = kneeSegment ? kneeSegment.viewerRetention : curve[curve.length - 1].viewerRetention;
    var avgDecayRate = decayCount > 0 ? (totalDecay / decayCount) / blockDurationHours * 100 : 0;
    var avgViewers = segments.reduce(function(s, seg) { return s + seg.avgViewers; }, 0) / segments.length;

    return {
      peakViewers: peakViewers,
      avgViewers: Math.round(avgViewers * 10) / 10,
      totalViewerHours: Math.round(cumulativeViewerHours * 10) / 10,
      optimalStopTime: optimalStopTime,
      retentionAtStop: Math.round(retentionAtStop * 10) / 10,
      avgDecayRate: Math.round(avgDecayRate * 100) / 100,
      curve: curve,
    };
  }
}

// ============================================================
// Mock Data
// ============================================================
var MOCK_VODS = [
  { id: 'mock-001', title: 'Late Night - Full Stack', date: '2026-06-28', duration: '12h', view_count: 8500,
    segments: genSeg([60,120,200,280,310,305,290,270,250,230,210,195,180,170,160,150,140,130,120,115,110,105,100,95]) },
  { id: 'mock-002', title: 'Afternoon - Design & CSS', date: '2026-06-25', duration: '10h', view_count: 6200,
    segments: genSeg([80,160,240,300,320,310,290,260,235,210,190,175,160,150,140,130,120,110,105,100]) },
  { id: 'mock-003', title: 'Weekend Marathon', date: '2026-06-22', duration: '14h', view_count: 12000,
    segments: genSeg([40,90,150,220,280,300,310,300,285,265,245,225,205,190,175,160,145,135,125,115,108,100,95,90,85,80,75,70]) },
  { id: 'mock-004', title: 'Quick Evening - Code Review', date: '2026-06-20', duration: '4h', view_count: 3400,
    segments: genSeg([100,180,250,280,260,230,200,170]) },
  { id: 'mock-005', title: 'Morning - Rust Project', date: '2026-06-18', duration: '6h', view_count: 2100,
    segments: genSeg([45,95,160,210,250,240,220,200,180,165,150,140]) },
];

function genSeg(arr) {
  return arr.map(function(v, i) { return { segmentIndex: i, durationMinutes: 30, avgViewers: v }; });
}

// ============================================================
// State
// ============================================================
var twitch = new TwitchAPI();
var channelVODs = [];
var liveVOD = null;
var liveTracker = new LiveTracker(twitch);
var analysisResult = null;
var chartCanvas = document.getElementById('chart-canvas');
var chartCtx = chartCanvas.getContext('2d');
var chartWidth = 0, chartHeight = 0;
var dpr = window.devicePixelRatio || 1;

// ============================================================
// UI References
// ============================================================
var clientIdInput = document.getElementById('client-id');
var clientSecretInput = document.getElementById('client-secret');
var connectBtn = document.getElementById('connect-btn');
var connectStatus = document.getElementById('connect-status');
var channelInput = document.getElementById('channel-input');
var fetchBtn = document.getElementById('fetch-btn');
var startTrackBtn = document.getElementById('start-track-btn');
var stopTrackBtn = document.getElementById('stop-track-btn');
var trackActive = document.getElementById('track-active');
var trackDuration = document.getElementById('track-duration');
var trackViewers = document.getElementById('track-viewers');
var trackPoints = document.getElementById('track-points');
var vodSelect = document.getElementById('vod-select');
var vodInfo = document.getElementById('vod-info');
var thresholdSlider = document.getElementById('threshold');
var thresholdVal = document.getElementById('threshold-val');
var minHoursSlider = document.getElementById('min-hours');
var minHoursVal = document.getElementById('min-hours-val');
var analyzeBtn = document.getElementById('analyze-btn');

// ============================================================
// Connect
// ============================================================
connectBtn.addEventListener('click', function() {
  var cid = clientIdInput.value.trim();
  var csec = clientSecretInput.value.trim();
  if (!cid || !csec) { setStatus('error', 'Enter ID and Secret'); return; }
  setStatus('connecting', 'Connecting...');
  connectBtn.disabled = true;
  twitch.connect(cid, csec).then(function() {
    setStatus('connected', 'Connected');
    fetchBtn.disabled = false;
    startTrackBtn.disabled = false;
  }).catch(function(err) {
    setStatus('error', err.message);
  }).then(function() {
    connectBtn.disabled = false;
  });
});

function setStatus(type, text) {
  connectStatus.className = 'status-badge ' + type;
  connectStatus.textContent = text;
}

// ============================================================
// Fetch VODs
// ============================================================
fetchBtn.addEventListener('click', function() {
  var channel = channelInput.value.trim().toLowerCase();
  if (!channel) return;
  fetchBtn.disabled = true;
  fetchBtn.textContent = 'Fetching...';
  twitch.getUser(channel).then(function(userData) {
    var users = userData.data;
    if (!users || users.length === 0) throw new Error('Channel "' + channel + '" not found');
    return twitch.getVODs(users[0].id);
  }).then(function(vodsData) {
    var apiVODs = vodsData.data || [];
    if (apiVODs.length === 0) throw new Error('No VODs found');
    channelVODs = apiVODs.map(function(v) {
      return {
        id: v.id, title: v.title, date: v.created_at.slice(0, 10),
        duration: v.duration, view_count: v.view_count,
        segments: generateEstimatedCurve(v), _fromApi: true,
      };
    });
    rebuildDropdown();
    showVODInfo();
    runAnalysis();
  }).catch(function(err) {
    vodInfo.innerHTML = '<span style="color:#ff6b6b;">' + err.message + '</span>';
  }).then(function() {
    fetchBtn.disabled = false;
    fetchBtn.textContent = 'Fetch';
  });
});

// ============================================================
// Live Tracking
// ============================================================
startTrackBtn.addEventListener('click', function() {
  var channel = channelInput.value.trim().toLowerCase();
  if (!channel) return;
  if (!twitch.isConnected()) { setStatus('error', 'Connect first'); return; }

  liveVOD = {
    id: '__live__', title: '● Live — Today', date: new Date().toISOString().slice(0, 10),
    duration: '0h', view_count: 0, segments: [], _isLive: true,
  };

  startTrackBtn.style.display = 'none';
  trackActive.style.display = '';
  rebuildDropdown();
  vodSelect.value = '__live__';
  showVODInfo();
  runAnalysis();

  liveTracker.start(channel, {
    onUpdate: onLiveUpdate,
    onStreamEnd: onLiveEnd,
  });
});

stopTrackBtn.addEventListener('click', function() {
  liveTracker.stop();
  finishLiveTracking(false);
});

function onLiveUpdate() {
  var stats = liveTracker.getStats();
  var elapsed = stats.durationMs;
  var totalSec = Math.floor(elapsed / 1000);
  var h = Math.floor(totalSec / 3600);
  var m = Math.floor((totalSec % 3600) / 60);
  trackDuration.textContent = h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
  trackViewers.textContent = stats.currentViewers;
  trackPoints.textContent = stats.dataPointCount;

  if (liveVOD) {
    liveVOD.segments = liveTracker.getSegments();
    liveVOD.view_count = stats.dataPointCount * 60;
    var dh = elapsed / 3600000;
    liveVOD.duration = dh;
  }

  if (vodSelect.value === '__live__') runAnalysis();
}

function onLiveEnd(errMsg) {
  if (errMsg) {
    trackDuration.textContent = 'Error: ' + errMsg;
  }
  finishLiveTracking(true);
}

function finishLiveTracking(keepData) {
  startTrackBtn.style.display = '';
  trackActive.style.display = 'none';

  if (liveVOD) {
    if (keepData && liveVOD.segments.length > 0) {
      liveVOD.title = '📼 Live Replay — Today';
      liveVOD._isLive = false;
      liveVOD._isReplay = true;
      rebuildDropdown();
      showVODInfo();
      if (vodSelect.value === '__live__') { vodSelect.value = liveVOD.id; runAnalysis(); }
    } else {
      liveVOD = null;
    }
  }

  rebuildDropdown();
  if (!liveVOD && vodSelect.value === '__live__') {
    vodSelect.value = MOCK_VODS[0] ? MOCK_VODS[0].id : '';
    showVODInfo();
    runAnalysis();
  }
}

// ============================================================
// VOD Select
// ============================================================
function rebuildDropdown() {
  var prevId = vodSelect.value;
  vodSelect.innerHTML = '';

  var items = [];
  if (liveVOD) items.push(liveVOD);
  MOCK_VODS.forEach(function(v) { items.push(v); });
  channelVODs.forEach(function(v) { items.push(v); });

  items.forEach(function(v) {
    var opt = document.createElement('option');
    opt.value = v.id;
    if (v._isLive) opt.textContent = '● Live — ' + v.date;
    else if (v._isReplay) opt.textContent = '📼 Live Replay — ' + v.date;
    else if (v._fromApi) opt.textContent = v.date + ' — ' + v.title + ' (' + fmtDuration(v.duration) + ', ' + v.view_count.toLocaleString() + ' views)';
    else opt.textContent = v.date + ' — ' + v.title + ' (' + v.duration + ')';
    vodSelect.appendChild(opt);
  });

  if (liveVOD && liveVOD._isLive) vodSelect.value = liveVOD.id;
  else if (prevId && items.some(function(v) { return v.id === prevId; })) vodSelect.value = prevId;

  vodSelect.onchange = function() { showVODInfo(); runAnalysis(); };
}

function showVODInfo() {
  var vod = getSelectedVOD();
  if (!vod) { vodInfo.textContent = ''; return; }
  if (vod._isLive) {
    var stats = liveTracker.getStats();
    var totalSec = Math.floor(stats.durationMs / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    vodInfo.innerHTML = '<strong>' + h + 'h ' + m + 'm</strong> tracked &middot; ' + stats.dataPointCount + ' data points';
  } else if (vod._isReplay) {
    var segs = vod.segments.length;
    vodInfo.innerHTML = 'Replay &middot; <strong>' + segs + ' segments</strong>';
  } else if (vod._fromApi) {
    vodInfo.innerHTML = '<strong>' + fmtDuration(vod.duration) + '</strong> &middot; ' + vod.view_count.toLocaleString() + ' views';
  } else {
    vodInfo.textContent = '';
  }
}

function getSelectedVOD() {
  var id = vodSelect.value;
  if (!id) return null;
  if (liveVOD && liveVOD.id === id) return liveVOD;
  var all = MOCK_VODS.concat(channelVODs);
  for (var i = 0; i < all.length; i++) { if (all[i].id === id) return all[i]; }
  return null;
}

function fmtDuration(d) {
  if (typeof d === 'number') {
    var hh = Math.floor(d);
    var mm = Math.round((d - hh) * 60);
    return hh + 'h ' + mm + 'm';
  }
  var hh = Math.floor(parseDuration(d));
  var mm = Math.round((parseDuration(d) - hh) * 60);
  return hh + 'h ' + mm + 'm';
}

// ============================================================
// Slider
// ============================================================
thresholdSlider.addEventListener('input', function() {
  thresholdVal.textContent = thresholdSlider.value + '%';
});

minHoursSlider.addEventListener('input', function() {
  minHoursVal.textContent = parseFloat(minHoursSlider.value).toFixed(1).replace('.0', '') + 'h';
});

// ============================================================
// Canvas
// ============================================================
function resizeCanvas() {
  var rect = chartCanvas.parentElement.getBoundingClientRect();
  chartWidth = rect.width - 32;
  chartHeight = Math.max(300, rect.height - 32);
  chartCanvas.width = chartWidth * dpr;
  chartCanvas.height = chartHeight * dpr;
  chartCanvas.style.width = chartWidth + 'px';
  chartCanvas.style.height = chartHeight + 'px';
  chartCtx.scale(dpr, dpr);
}

window.addEventListener('resize', function() {
  resizeCanvas();
  if (analysisResult) drawChart(analysisResult);
});

// ============================================================
// Chart
// ============================================================
function drawChart(result) {
  var ctx = chartCtx;
  var W = chartWidth;
  var H = chartHeight;
  var pad = { top: 24, right: 50, bottom: 40, left: 50 };
  var plotW = W - pad.left - pad.right;
  var plotH = H - pad.top - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  var curve = result.curve;
  if (!curve.length) return;

  var maxTime = curve[curve.length - 1].time;
  var maxViewers = result.peakViewers;
  var numBars = curve.length;

  function xPos(t) { return pad.left + (t / maxTime) * plotW; }
  function yViewers(v) { return pad.top + plotH - (v / maxViewers) * plotH; }
  function yRetention(pct) { return pad.top + plotH - (pct / 100) * plotH; }

  // Grid
  ctx.strokeStyle = '#22222e';
  ctx.lineWidth = 1;
  for (var i = 0; i <= 4; i++) {
    var y = pad.top + (i / 4) * plotH;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + plotW, y); ctx.stroke();
  }
  for (var j = 0; j <= 6; j++) {
    var x = pad.left + (j / 6) * plotW;
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + plotH); ctx.stroke();
  }

  // X-axis
  ctx.fillStyle = '#6b6b80';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  for (var j2 = 0; j2 <= 6; j2++) {
    var t = Math.round((j2 / 6) * maxTime * 10) / 10;
    ctx.fillText(t + 'h', pad.left + (j2 / 6) * plotW, pad.top + plotH + 16);
  }
  ctx.fillText('Time (hours)', pad.left + plotW / 2, pad.top + plotH + 34);

  // Left Y-axis
  ctx.textAlign = 'right';
  ctx.fillStyle = '#6b6b80';
  ctx.font = '10px sans-serif';
  for (var v = 0; v <= 4; v++) {
    var val = Math.round((v / 4) * maxViewers);
    ctx.fillText(val, pad.left - 8, pad.top + plotH - (v / 4) * plotH + 3);
  }
  ctx.save();
  ctx.translate(14, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('Viewers', 0, 0);
  ctx.restore();

  // Right Y-axis
  ctx.textAlign = 'left';
  ctx.fillStyle = '#60d0a8';
  ctx.font = '10px sans-serif';
  for (var p = 0; p <= 4; p++) {
    var pct = Math.round((p / 4) * 100);
    ctx.fillText(pct + '%', pad.left + plotW + 6, pad.top + plotH - (p / 4) * plotH + 3);
  }
  ctx.save();
  ctx.translate(pad.left + plotW + 40, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#60d0a8';
  ctx.fillText('Retention', 0, 0);
  ctx.restore();

  // Bars
  var barAreaW = plotW / numBars;
  var barW = Math.max(2, barAreaW - 2);
  for (var b = 0; b < curve.length; b++) {
    var bx = pad.left + b * barAreaW;
    var by = yViewers(curve[b].avgViewers);
    ctx.fillStyle = '#c084fc';
    ctx.fillRect(bx, by, barW, pad.top + plotH - by);
  }

  // Retention line
  ctx.beginPath();
  ctx.moveTo(xPos(curve[0].time), yRetention(curve[0].viewerRetention));
  for (var l = 1; l < curve.length; l++) {
    ctx.lineTo(xPos(curve[l].time), yRetention(curve[l].viewerRetention));
  }
  ctx.strokeStyle = '#60d0a8';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Knee
  var kneeIdx = -1;
  for (var ki = 0; ki < curve.length; ki++) { if (curve[ki].time === result.optimalStopTime) { kneeIdx = ki; break; } }
  if (kneeIdx >= 0) {
    var kneeTime = curve[kneeIdx].time;
    var kx = xPos(kneeTime);
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(kx, pad.top); ctx.lineTo(kx, pad.top + plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff6b6b';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('▼ Stop: ' + kneeTime + 'h', kx, pad.top - 4);
  }
}

function renderLegend() {
  document.getElementById('legend').innerHTML =
    '<div class="legend-item"><div class="legend-swatch" style="background:#c084fc;"></div>Viewers per Segment</div>' +
    '<div class="legend-item"><div class="legend-swatch" style="background:#60d0a8;"></div>Viewer Retention %</div>' +
    '<div class="legend-item"><div class="legend-marker" style="background:#ff6b6b;"></div>Optimal Stop Time</div>';
}

// ============================================================
// Analysis
// ============================================================
function runAnalysis() {
  var vod = getSelectedVOD();
  if (!vod || !vod.segments || vod.segments.length < 2) {
    analysisResult = null;
    document.getElementById('opt-stop').textContent = '—';
    document.getElementById('peak-viewers').textContent = '—';
    document.getElementById('avg-viewers').textContent = '—';
    document.getElementById('retention-stop').textContent = '—';
    document.getElementById('viewer-hours').textContent = '—';
    document.getElementById('decay-rate').textContent = '—';
    resizeCanvas();
    var ctx = chartCtx;
    ctx.clearRect(0, 0, chartWidth, chartHeight);
    ctx.fillStyle = '#6b6b80';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for data...', chartWidth / 2, chartHeight / 2);
    return;
  }

  var threshold = parseFloat(thresholdSlider.value) / 100;
  var minHours = parseFloat(minHoursSlider.value);
  var analyzer = new StreamAnalyzer();
  analysisResult = analyzer.analyze(vod.segments, threshold, minHours);

  document.getElementById('opt-stop').textContent = analysisResult.optimalStopTime;
  document.getElementById('peak-viewers').textContent = analysisResult.peakViewers;
  document.getElementById('avg-viewers').textContent = analysisResult.avgViewers;
  document.getElementById('retention-stop').textContent = analysisResult.retentionAtStop;
  document.getElementById('viewer-hours').textContent = analysisResult.totalViewerHours;
  document.getElementById('decay-rate').textContent = analysisResult.avgDecayRate;

  resizeCanvas();
  drawChart(analysisResult);
  renderLegend();
}

analyzeBtn.addEventListener('click', runAnalysis);

// ============================================================
// Init
// ============================================================
rebuildDropdown();
showVODInfo();
runAnalysis();
