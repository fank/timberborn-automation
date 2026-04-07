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

  /* ── Header ─────────────────────────────────────── */
  header { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  header h1 { font-size: 1.3rem; color: #a0c4ff; }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .dot.on { background: #4caf50; }
  .dot.off { background: #666; }
  .meta { font-size: 0.75rem; color: #888; margin-bottom: 12px; }

  /* ── Tabs ────────────────────────────────────────── */
  .tabs { display: flex; gap: 2px; margin-bottom: 16px; }
  .tab { padding: 8px 20px; border-radius: 6px 6px 0 0; cursor: pointer; font-size: 0.85rem; font-weight: 600;
         background: #16213e; color: #7eb8da; border: 1px solid transparent; border-bottom: none; user-select: none; }
  .tab:hover { background: #1e2d4a; }
  .tab.active { background: #0f3460; color: #a0c4ff; border-color: #2a4a7f; }
  .tab-body { display: none; }
  .tab-body.active { display: block; }

  /* ── Cards & Tables ─────────────────────────────── */
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  @media (max-width: 960px) { .grid { grid-template-columns: 1fr; } }
  .card { background: #16213e; border-radius: 8px; padding: 12px; overflow-x: auto; }
  .card.full { grid-column: 1 / -1; }
  h2 { font-size: 1rem; color: #7eb8da; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th { text-align: left; color: #7eb8da; border-bottom: 1px solid #2a3a5c; padding: 6px 8px; white-space: nowrap; }
  td { padding: 5px 8px; border-bottom: 1px solid #1e2d4a; vertical-align: top; }
  tr:hover { background: #1e2d4a; }
  .empty { color: #666; font-style: italic; padding: 20px; text-align: center; }
  .ts { color: #888; font-size: 0.75rem; white-space: nowrap; }
  .mono { font-family: 'Fira Code', 'Cascadia Code', monospace; font-size: 0.78rem; }

  /* ── Pills ──────────────────────────────────────── */
  .p { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; font-weight: 600; }
  .p.on   { background: #1b5e20; color: #a5d6a7; }
  .p.off  { background: #333;    color: #999; }
  .p.en   { background: #1b3a5e; color: #90caf9; }
  .p.dis  { background: #4a1a1a; color: #ef9a9a; }
  .p.edge { background: #3e2723; color: #ffcc80; }
  .p.cont { background: #1a237e; color: #9fa8da; }
  .p.ok   { background: #1b5e20; color: #a5d6a7; }
  .p.fail { background: #4a1a1a; color: #ef9a9a; }

  /* ── Rule cards ─────────────────────────────────── */
  .rules-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
  .rule-card { background: #16213e; border-radius: 8px; padding: 12px 14px; border-left: 4px solid #2a4a7f; }
  .rule-card.disabled { opacity: 0.5; border-left-color: #4a1a1a; }
  .rule-header { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
  .rule-id { font-weight: 700; color: #a0c4ff; font-size: 0.88rem; }
  .rule-name { color: #888; font-size: 0.78rem; }
  .rule-group { color: #888; font-size: 0.72rem; background: #0d1b2a; padding: 1px 6px; border-radius: 4px; }
  .rule-cooldown { color: #666; font-size: 0.72rem; }

  /* ── Flow: vertical layout (condition block, then arrow, then action) */
  .flow-section { margin-bottom: 6px; }
  .flow-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.5px; color: #556; margin-bottom: 4px; }
  .flow-arrow { color: #4a6fa5; font-size: 0.8rem; margin: 6px 0; padding-left: 4px; }

  /* Condition nodes */
  .cnode { border-radius: 5px; padding: 4px 8px; font-size: 0.78rem; margin: 2px 0; display: block; }
  .cnode.device { background: #1a2744; border: 1px solid #2a4a7f; color: #b0d0ff; }
  .cnode.device .dev-state { font-weight: 700; }
  .cnode.device .dev-state.t { color: #66bb6a; }
  .cnode.device .dev-state.f { color: #999; }
  .cnode.gate { background: #1a1a33; border: 1px solid #3a3a6e; padding: 5px 8px; }
  .cnode.gate > .gate-label { color: #9fa8da; font-weight: 700; font-size: 0.7rem; text-transform: uppercase; margin-bottom: 3px; }
  .cnode.gate > .gate-children { padding-left: 10px; border-left: 2px solid #3a3a6e; display: flex; flex-direction: column; gap: 2px; }
  .cnode.neg { background: #2a1a1a; border: 1px solid #5a3a3a; padding: 3px 8px; }
  .cnode.neg > .neg-label { color: #ef9a9a; font-weight: 700; font-size: 0.7rem; margin-right: 4px; }
  .cnode.neg > .neg-child { display: inline; }
  .cnode.dur { background: #1a2a1a; border: 1px solid #3a5a3a; color: #a5d6a7; }
  .cnode.grp { background: #1a1a2a; border: 1px solid #3a3a5a; color: #b0b0ff; }

  /* Action nodes */
  .anode { border-radius: 5px; padding: 5px 10px; font-size: 0.78rem; display: block; margin: 2px 0; }
  .anode.switch { background: #1a2a1a; border: 1px solid #3a5a3a; }
  .anode.switch .lever-name { color: #a5d6a7; font-weight: 700; }
  .anode.switch .lever-dir { font-weight: 700; margin-left: 4px; }
  .anode.switch .lever-dir.aon { color: #66bb6a; }
  .anode.switch .lever-dir.aoff { color: #ef9a9a; }
  .anode.switch .lever-dir.track { color: #90caf9; }
  .anode.notify { background: #2a2a1a; border: 1px solid #5a5a3a; color: #ffe082; word-break: break-word; }
  .anode.group-ctl { background: #1a1a2a; border: 1px solid #3a3a5a; color: #b0b0ff; }
  .anode.seq { display: flex; flex-direction: column; gap: 3px; background: none; border: none; padding: 0; }

  /* ── Exec mini-table inside rule card ───────────── */
  .rule-execs { margin-top: 8px; border-top: 1px solid #1e2d4a; padding-top: 6px; }
  .rule-execs summary { font-size: 0.72rem; color: #666; cursor: pointer; }
  .rule-execs summary:hover { color: #90caf9; }
  .rule-execs table { margin-top: 4px; font-size: 0.75rem; }
</style>
</head>
<body>

<header>
  <span class="dot" id="conn-dot"></span>
  <h1>Timberborn Automation</h1>
</header>
<div class="meta" id="meta">Loading...</div>

<div class="tabs">
  <div class="tab active" data-tab="devices">Devices</div>
  <div class="tab" data-tab="rules">Rules</div>
  <div class="tab" data-tab="history">History</div>
</div>

<!-- ── Devices tab ──────────────────────────────────── -->
<div class="tab-body active" id="tab-devices">
  <div class="grid">
    <div class="card">
      <h2>Adapters</h2>
      <table><thead><tr><th>Name</th><th>State</th><th>Group</th><th>Label</th></tr></thead>
      <tbody id="adapters"><tr><td colspan="4" class="empty">Loading...</td></tr></tbody></table>
    </div>
    <div class="card">
      <h2>Levers</h2>
      <table><thead><tr><th>Name</th><th>State</th><th>Group</th><th>Label</th></tr></thead>
      <tbody id="levers"><tr><td colspan="4" class="empty">Loading...</td></tr></tbody></table>
    </div>
  </div>
</div>

<!-- ── Rules tab ────────────────────────────────────── -->
<div class="tab-body" id="tab-rules">
  <div class="rules-grid" id="rules-grid">
    <div class="empty">Loading...</div>
  </div>
</div>

<!-- ── History tab ──────────────────────────────────── -->
<div class="tab-body" id="tab-history">
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
</div>

<script>
/* ── Helpers ────────────────────────────────────────── */
function esc(s) { if (!s && s !== 0) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
function ts(iso) { if (!iso) return ''; return new Date(iso).toLocaleTimeString(); }
function pill(text, cls) { return '<span class="p ' + cls + '">' + esc(text) + '</span>'; }
function cdMs(ms) { if (!ms) return ''; if (ms < 60000) return (ms/1000)+'s'; return (ms/60000)+'m'; }

/* ── Tabs ───────────────────────────────────────────── */
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab-body').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('tab-' + t.dataset.tab).classList.add('active');
  });
});

/* ── Condition renderer → HTML ──────────────────────── */
function renderCond(c) {
  if (!c) return '<span class="cnode device">?</span>';
  switch (c.type) {
    case 'device':
      return '<span class="cnode device">' + esc(c.name) +
        ' <span class="dev-state ' + (c.state ? 't' : 'f') + '">' + (c.state ? 'ON' : 'OFF') + '</span></span>';
    case 'not':
      return '<div class="cnode neg"><span class="neg-label">NOT</span> <span class="neg-child">' + renderCond(c.condition) + '</span></div>';
    case 'and':
    case 'or':
      return '<div class="cnode gate"><div class="gate-label">' + c.type.toUpperCase() + '</div>' +
        '<div class="gate-children">' + c.conditions.map(renderCond).join('') + '</div></div>';
    case 'duration':
      return '<span class="cnode dur">' + esc(c.name) +
        ' = ' + (c.state ? 'ON' : 'OFF') + ' for &gt; ' + esc(c.duration) + '</span>';
    case 'group_all':
      return '<span class="cnode grp">all <b>' + esc(c.group) + '</b> = ' + (c.state ? 'ON' : 'OFF') + '</span>';
    case 'group_any':
      return '<span class="cnode grp">any <b>' + esc(c.group) + '</b> = ' + (c.state ? 'ON' : 'OFF') + '</span>';
    default:
      return '<span class="cnode device">' + esc(JSON.stringify(c)) + '</span>';
  }
}

/* ── Action renderer → HTML ─────────────────────────── */
function renderAction(a) {
  if (!a) return '<span class="anode notify">?</span>';
  switch (a.type) {
    case 'switch': {
      var dir, cls;
      if (a.value === true) { dir = 'ON'; cls = 'aon'; }
      else if (a.value === false) { dir = 'OFF'; cls = 'aoff'; }
      else { dir = 'TRACK'; cls = 'track'; }
      return '<div class="anode switch"><span class="lever-name">' + esc(a.lever) +
        '</span> <span class="lever-dir ' + cls + '">\\u2192 ' + dir + '</span></div>';
    }
    case 'notify':
      return '<div class="anode notify">\\ud83d\\udce3 ' + esc(a.message.length > 50 ? a.message.substring(0,47) + '...' : a.message) + '</div>';
    case 'enable_group':
      return '<div class="anode group-ctl">\\u25b6 enable <b>' + esc(a.group) + '</b></div>';
    case 'disable_group':
      return '<div class="anode group-ctl">\\u23f8 disable <b>' + esc(a.group) + '</b></div>';
    case 'sequence':
      return '<div class="anode seq">' + a.actions.map(renderAction).join('') + '</div>';
    default:
      return '<div class="anode notify">' + esc(JSON.stringify(a)) + '</div>';
  }
}

/* ── Rule card renderer ─────────────────────────────── */
function renderRuleCard(r, execs) {
  var ruleExecs = execs.filter(function(e) { return e.rule_id === r.id; }).slice(0, 5);
  var disabledCls = r.enabled ? '' : ' disabled';

  var execsHtml = '';
  if (ruleExecs.length > 0) {
    execsHtml = '<div class="rule-execs"><details><summary>' + ruleExecs.length + ' recent execution(s)</summary>' +
      '<table><thead><tr><th>Time</th><th>Trigger</th><th>Action</th><th>OK</th></tr></thead><tbody>' +
      ruleExecs.map(function(e) {
        return '<tr><td class="ts">' + ts(e.timestamp) + '</td><td>' + esc(e.trigger_device || '-') +
          '</td><td class="mono">' + esc(e.action_summary) +
          '</td><td>' + pill(e.success ? 'OK' : 'FAIL', e.success ? 'ok' : 'fail') + '</td></tr>';
      }).join('') +
      '</tbody></table></details></div>';
  }

  return '<div class="rule-card' + disabledCls + '">' +
    '<div class="rule-header">' +
      '<span class="rule-id">' + esc(r.id) + '</span>' +
      pill(r.enabled ? 'enabled' : 'disabled', r.enabled ? 'en' : 'dis') +
      (r.group ? '<span class="rule-group">' + esc(r.group) + '</span>' : '') +
      (r.cooldownMs ? '<span class="rule-cooldown">\\u23f1 ' + cdMs(r.cooldownMs) + '</span>' : '') +
      (r.name ? '<span class="rule-name">' + esc(r.name) + '</span>' : '') +
    '</div>' +
    '<div class="flow-section"><div class="flow-label">When</div>' + renderCond(r.condition) + '</div>' +
    '<div class="flow-arrow">\\u2193 then</div>' +
    '<div class="flow-section"><div class="flow-label">Do</div>' + renderAction(r.action) + '</div>' +
    execsHtml +
  '</div>';
}

/* ── Data refresh ───────────────────────────────────── */
async function refresh() {
  try {
    var [devRes, rulesRes, execRes, evtRes] = await Promise.all([
      fetch('/api/devices'), fetch('/api/rules'), fetch('/api/executions'), fetch('/api/events')
    ]);
    var devices = await devRes.json();
    var rules = await rulesRes.json();
    var execs = await execRes.json();
    var events = await evtRes.json();

    var adapters = devices.filter(function(d) { return d.type === 'adapter'; });
    var levers = devices.filter(function(d) { return d.type === 'lever'; });

    document.getElementById('conn-dot').className = 'dot on';
    document.getElementById('meta').textContent =
      adapters.length + ' adapters, ' + levers.length + ' levers, ' +
      rules.length + ' rules \\u2014 ' + new Date().toLocaleTimeString();

    /* ── Devices tab ── */
    document.getElementById('adapters').innerHTML = adapters.length === 0
      ? '<tr><td colspan="4" class="empty">No adapters</td></tr>'
      : adapters.map(function(d) {
        return '<tr><td>' + esc(d.name) + '</td><td>' +
          pill(d.currentState ? 'ON' : 'OFF', d.currentState ? 'on' : 'off') +
          '</td><td>' + esc(d.groupName || '-') + '</td><td>' + esc(d.label || '-') + '</td></tr>';
      }).join('');

    document.getElementById('levers').innerHTML = levers.length === 0
      ? '<tr><td colspan="4" class="empty">No levers</td></tr>'
      : levers.map(function(d) {
        return '<tr><td>' + esc(d.name) + '</td><td>' +
          pill(d.currentState ? 'ON' : 'OFF', d.currentState ? 'on' : 'off') +
          '</td><td>' + esc(d.groupName || '-') + '</td><td>' + esc(d.label || '-') + '</td></tr>';
      }).join('');

    /* ── Rules tab ── */
    document.getElementById('rules-grid').innerHTML = rules.length === 0
      ? '<div class="empty">No rules defined</div>'
      : rules.map(function(r) { return renderRuleCard(r, execs); }).join('');

    /* ── History tab ── */
    document.getElementById('executions').innerHTML = execs.length === 0
      ? '<tr><td colspan="5" class="empty">No executions yet</td></tr>'
      : execs.map(function(e) {
        return '<tr><td class="ts">' + ts(e.timestamp) + '</td><td>' + esc(e.rule_id) +
          '</td><td>' + esc(e.trigger_device || '-') +
          '</td><td class="mono">' + esc(e.action_summary) +
          '</td><td>' + pill(e.success ? 'OK' : 'FAIL', e.success ? 'ok' : 'fail') + '</td></tr>';
      }).join('');

    document.getElementById('events').innerHTML = events.length === 0
      ? '<tr><td colspan="4" class="empty">No events yet</td></tr>'
      : events.map(function(e) {
        return '<tr><td class="ts">' + ts(e.timestamp) + '</td><td>' + esc(e.type) +
          '</td><td>' + esc(e.deviceName || '-') +
          '</td><td>' + esc(e.message) + '</td></tr>';
      }).join('');

  } catch (err) {
    document.getElementById('conn-dot').className = 'dot off';
    document.getElementById('meta').textContent = 'Connection error \\u2014 ' + new Date().toLocaleTimeString();
  }
}

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
}
