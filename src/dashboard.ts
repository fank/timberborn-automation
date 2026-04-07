export function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Timberborn Automation</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 16px; }
  h1 { font-size: 1.3rem; color: #a0c4ff; margin-bottom: 12px; display: flex; align-items: center; gap: 10px; }
  h2 { font-size: 1rem; color: #7eb8da; margin-bottom: 8px; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .status-dot.on { background: #4caf50; }
  .status-dot.off { background: #666; }
  .meta { font-size: 0.75rem; color: #888; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  .card { background: #16213e; border-radius: 8px; padding: 12px; overflow-x: auto; }
  .card.full { grid-column: 1 / -1; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th { text-align: left; color: #7eb8da; border-bottom: 1px solid #2a3a5c; padding: 6px 8px; white-space: nowrap; }
  td { padding: 5px 8px; border-bottom: 1px solid #1e2d4a; vertical-align: top; }
  tr:hover { background: #1e2d4a; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; font-weight: 600; }
  .pill.on { background: #1b5e20; color: #a5d6a7; }
  .pill.off { background: #333; color: #999; }
  .pill.enabled { background: #1b3a5e; color: #90caf9; }
  .pill.disabled { background: #4a1a1a; color: #ef9a9a; }
  .pill.edge { background: #3e2723; color: #ffcc80; }
  .pill.continuous { background: #1a237e; color: #9fa8da; }
  .pill.success { background: #1b5e20; color: #a5d6a7; }
  .pill.fail { background: #4a1a1a; color: #ef9a9a; }
  .cond { font-family: 'Fira Code', monospace; font-size: 0.75rem; color: #ccc; }
  .action-text { font-family: 'Fira Code', monospace; font-size: 0.75rem; color: #ccc; }
  .empty { color: #666; font-style: italic; padding: 20px; text-align: center; }
  .ts { color: #888; font-size: 0.75rem; white-space: nowrap; }
</style>
</head>
<body>

<h1>
  <span class="status-dot" id="conn-dot"></span>
  Timberborn Automation
</h1>
<div class="meta" id="meta">Loading...</div>

<div class="grid">
  <div class="card">
    <h2>Adapters</h2>
    <table><thead><tr><th>Name</th><th>State</th><th>Group</th></tr></thead>
    <tbody id="adapters"><tr><td colspan="3" class="empty">Loading...</td></tr></tbody></table>
  </div>
  <div class="card">
    <h2>Levers</h2>
    <table><thead><tr><th>Name</th><th>State</th><th>Group</th></tr></thead>
    <tbody id="levers"><tr><td colspan="3" class="empty">Loading...</td></tr></tbody></table>
  </div>
</div>

<div class="grid">
  <div class="card full">
    <h2>Automation Rules</h2>
    <table><thead><tr><th>ID</th><th>Mode</th><th>Condition</th><th>Action</th><th>Cooldown</th><th>Status</th></tr></thead>
    <tbody id="rules"><tr><td colspan="6" class="empty">Loading...</td></tr></tbody></table>
  </div>
</div>

<div class="grid">
  <div class="card">
    <h2>Rule Executions</h2>
    <table><thead><tr><th>Time</th><th>Rule</th><th>Trigger</th><th>Action</th><th>OK</th></tr></thead>
    <tbody id="executions"><tr><td colspan="5" class="empty">Loading...</td></tr></tbody></table>
  </div>
  <div class="card">
    <h2>Events</h2>
    <table><thead><tr><th>Time</th><th>Type</th><th>Device</th><th>Message</th></tr></thead>
    <tbody id="events"><tr><td colspan="4" class="empty">Loading...</td></tr></tbody></table>
  </div>
</div>

<script>
function pill(text, cls) { return '<span class="pill ' + cls + '">' + esc(text) + '</span>'; }
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function ts(iso) { if (!iso) return ''; const d = new Date(iso); return d.toLocaleTimeString(); }

function summarizeCond(c) {
  if (!c) return '?';
  switch (c.type) {
    case 'device': return esc(c.name) + ' = ' + (c.state ? 'true' : 'false');
    case 'not': return 'NOT(' + summarizeCond(c.condition) + ')';
    case 'and': return c.conditions.map(summarizeCond).join(' AND ');
    case 'or': return c.conditions.map(summarizeCond).join(' OR ');
    case 'duration': return esc(c.name) + ' = ' + c.state + ' for > ' + esc(c.duration);
    case 'group_all': return 'all(' + esc(c.group) + ') = ' + c.state;
    case 'group_any': return 'any(' + esc(c.group) + ') = ' + c.state;
    default: return JSON.stringify(c);
  }
}

function summarizeAction(a) {
  if (!a) return '?';
  switch (a.type) {
    case 'switch': return esc(a.lever) + ' \\u2192 ' + (a.value === false ? 'OFF' : a.value === true ? 'ON' : 'track');
    case 'notify': return 'notify: ' + esc(a.message.substring(0, 40));
    case 'enable_group': return 'enable ' + esc(a.group);
    case 'disable_group': return 'disable ' + esc(a.group);
    case 'sequence': return a.actions.map(summarizeAction).join(', ');
    default: return JSON.stringify(a);
  }
}

function cooldownLabel(ms) {
  if (!ms) return '-';
  if (ms < 60000) return (ms / 1000) + 's';
  return (ms / 60000) + 'm';
}

async function refresh() {
  try {
    const [devRes, rulesRes, execRes, evtRes] = await Promise.all([
      fetch('/api/devices'), fetch('/api/rules'), fetch('/api/executions'), fetch('/api/events')
    ]);
    const devices = await devRes.json();
    const rules = await rulesRes.json();
    const execs = await execRes.json();
    const events = await evtRes.json();

    const adapters = devices.filter(d => d.type === 'adapter');
    const levers = devices.filter(d => d.type === 'lever');

    document.getElementById('conn-dot').className = 'status-dot on';
    document.getElementById('meta').textContent =
      adapters.length + ' adapters, ' + levers.length + ' levers, ' +
      rules.length + ' rules \\u2014 updated ' + new Date().toLocaleTimeString();

    document.getElementById('adapters').innerHTML = adapters.length === 0
      ? '<tr><td colspan="3" class="empty">No adapters</td></tr>'
      : adapters.map(d =>
        '<tr><td>' + esc(d.name) + '</td><td>' + pill(d.currentState ? 'ON' : 'OFF', d.currentState ? 'on' : 'off') +
        '</td><td>' + esc(d.groupName || '-') + '</td></tr>'
      ).join('');

    document.getElementById('levers').innerHTML = levers.length === 0
      ? '<tr><td colspan="3" class="empty">No levers</td></tr>'
      : levers.map(d =>
        '<tr><td>' + esc(d.name) + '</td><td>' + pill(d.currentState ? 'ON' : 'OFF', d.currentState ? 'on' : 'off') +
        '</td><td>' + esc(d.groupName || '-') + '</td></tr>'
      ).join('');

    document.getElementById('rules').innerHTML = rules.length === 0
      ? '<tr><td colspan="6" class="empty">No rules</td></tr>'
      : rules.map(r =>
        '<tr><td>' + esc(r.id) + '</td><td>' + pill(r.mode, r.mode) +
        '</td><td class="cond">' + summarizeCond(r.condition) +
        '</td><td class="action-text">' + summarizeAction(r.action) +
        '</td><td>' + cooldownLabel(r.cooldownMs) +
        '</td><td>' + pill(r.enabled ? 'enabled' : 'disabled', r.enabled ? 'enabled' : 'disabled') + '</td></tr>'
      ).join('');

    document.getElementById('executions').innerHTML = execs.length === 0
      ? '<tr><td colspan="5" class="empty">No executions yet</td></tr>'
      : execs.map(e =>
        '<tr><td class="ts">' + ts(e.timestamp) + '</td><td>' + esc(e.rule_id) +
        '</td><td>' + esc(e.trigger_device || '-') +
        '</td><td class="action-text">' + esc(e.action_summary) +
        '</td><td>' + pill(e.success ? 'OK' : 'FAIL', e.success ? 'success' : 'fail') + '</td></tr>'
      ).join('');

    document.getElementById('events').innerHTML = events.length === 0
      ? '<tr><td colspan="4" class="empty">No events yet</td></tr>'
      : events.map(e =>
        '<tr><td class="ts">' + ts(e.timestamp) + '</td><td>' + esc(e.type) +
        '</td><td>' + esc(e.deviceName || '-') +
        '</td><td>' + esc(e.message) + '</td></tr>'
      ).join('');
  } catch (err) {
    document.getElementById('conn-dot').className = 'status-dot off';
    document.getElementById('meta').textContent = 'Connection error \\u2014 ' + new Date().toLocaleTimeString();
  }
}

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
}
