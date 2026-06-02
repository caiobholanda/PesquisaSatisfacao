const TOKEN_KEY = 'granspa_token';
const LIMIT = 30;
let _token = null;
let _offset = 0;
let _total = 0;
let _filters = {};

function token() { return _token || sessionStorage.getItem(TOKEN_KEY); }
function setToken(t) { _token = t; sessionStorage.setItem(TOKEN_KEY, t); }
function clearToken() { _token = null; sessionStorage.removeItem(TOKEN_KEY); }
function tokenValido() {
  const t = token();
  if (!t) return false;
  try {
    const payload = JSON.parse(atob(t.split('.')[1]));
    return payload.exp * 1000 > Date.now();
  } catch { return false; }
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token()}` },
    ...opts,
  });
  if (res.status === 401) { logout(); return null; }
  return res;
}

function logout() { clearToken(); sessionStorage.removeItem('_vst'); showLogin(); }

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
}
function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';
  loadAll(); // sempre carrega dados do painel principal em background
  const st = JSON.parse(sessionStorage.getItem('_vst') || '{}');
  const view = st.view || 'view-main';
  showView(view);
  if (view === 'view-massagistas') { loadMassagistas(); }
  else if (view === 'view-tipos') { loadTipos(); }
  else if (view === 'view-historico' && st.histId) { showHistoricoMassagista(st.histId, st.histNome); }
  else if (view === 'view-reservas') {
    if (st.calOff != null) _calWeekOffset = st.calOff;
    if (st.calDay) { const [y,m,d]=st.calDay.split('-').map(Number); _calDiaSel=new Date(y,m-1,d); }
    loadReservas();
  }
}

// ── Login ──
document.getElementById('btn-login').addEventListener('click', async () => {
  const btn = document.getElementById('btn-login');
  const msg = document.getElementById('msg-login');
  const username = document.getElementById('inp-user').value.trim();
  const password = document.getElementById('inp-pass').value;
  if (!username || !password) { msg.textContent = 'Preencha usuário e senha.'; return; }
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;
  msg.textContent = '';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const d = await res.json();
    if (d.ok) { setToken(d.token); showApp(); }
    else { msg.textContent = d.error || 'Credenciais inválidas'; }
  } catch { msg.textContent = 'Erro de conexão.'; }
  finally { btn.innerHTML = 'Entrar'; btn.disabled = false; }
});
document.getElementById('inp-pass').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-login').click(); });

document.getElementById('btn-toggle-pass').addEventListener('click', () => {
  const inp = document.getElementById('inp-pass');
  const showing = inp.type === 'text';
  inp.type = showing ? 'password' : 'text';
  document.getElementById('icon-eye-off').style.display = showing ? '' : 'none';
  document.getElementById('icon-eye-on').style.display = showing ? 'none' : '';
});
document.getElementById('btn-sair').addEventListener('click', logout);

// ── Stats + Análise ──
const SERVICOS_LABELS = [
  { campo: 'servicos_expectativa', label: 'A expectativa do tratamento' },
  { campo: 'servicos_explicacao', label: 'A explicação da massoterapeuta sobre benefícios e procedimentos' },
  { campo: 'servicos_atitude', label: 'A atitude e a qualidade dos serviços da massoterapeuta' },
  { campo: 'servicos_tecnica', label: 'A técnica e a habilidade da massoterapeuta' },
];
const INSTALACOES_LABELS = [
  { campo: 'instalacoes_conforto', label: 'Conforto e conservação da estrutura' },
  { campo: 'instalacoes_organizacao', label: 'Organização da sala, equipamentos e atmosfera' },
  { campo: 'instalacoes_conveniencia', label: 'Itens de conveniência (roupões, toalhas, etc.)' },
];

function renderDistBar(dist) {
  if (!dist || dist.total === 0) return '<div class="dist-empty">Sem respostas no período</div>';
  const pct = (k) => dist.total ? +(dist[k] / dist.total * 100).toFixed(1) : 0;
  const seg = (k) => { const p = pct(k); return p > 0 ? `<div class="dist-seg seg-${k}" style="width:${p}%">${p >= 9 ? p + '%' : ''}</div>` : ''; };
  const leg = (k, lbl) => `<span class="dist-leg"><span class="dist-leg-dot ${k}"></span><strong>${pct(k)}%</strong> ${lbl} (${dist[k]})</span>`;
  return `<div class="dist-bar">${seg('otimo')}${seg('bom')}${seg('regular')}${seg('ruim')}</div>
    <div class="dist-legend">${leg('otimo','Ótimo')}${leg('bom','Bom')}${leg('regular','Regular')}${leg('ruim','Ruim')}<span class="dist-leg" style="margin-left:auto">${dist.total} resp.</span></div>`;
}

function renderTextoGroup(titulo, items) {
  if (!items || !items.length) return '';
  return `<div class="textos-sub">${titulo}</div><div class="texto-list">${items.map(t =>
    `<div class="texto-item"><div class="ti-text">"${t.texto}"</div><div class="ti-meta">${t.nome} · ${fmtDate(t.data)}</div></div>`
  ).join('')}</div>`;
}

function renderAnalysis(d) {
  const grid = document.getElementById('analysis-grid');
  if (!d.distribuicoes) { grid.style.display = 'none'; return; }
  grid.style.display = 'grid';
  document.getElementById('dist-servicos').innerHTML = SERVICOS_LABELS.map(({ campo, label }) =>
    `<div class="q-row"><div class="q-label">${label}</div>${renderDistBar(d.distribuicoes[campo])}</div>`).join('');
  document.getElementById('dist-instalacoes').innerHTML = INSTALACOES_LABELS.map(({ campo, label }) =>
    `<div class="q-row"><div class="q-label">${label}</div>${renderDistBar(d.distribuicoes[campo])}</div>`).join('');
  const t = d.textos || {};
  const cols = [
    renderTextoGroup('Comentários sobre serviços', t.servicos),
    renderTextoGroup('Comentários sobre instalações', t.instalacoes),
    renderTextoGroup('Recomendaria a quem?', t.recomenda_qual),
    renderTextoGroup('Por que recomendaria?', t.recomenda_porque),
  ].filter(Boolean);
  document.getElementById('dist-textos').innerHTML = cols.length
    ? cols.map(c => `<div>${c}</div>`).join('')
    : '<div class="dist-empty">Nenhum comentário no período.</div>';
}

async function loadStats() {
  const params = new URLSearchParams();
  if (_filters.from) params.set('from', _filters.from);
  if (_filters.to) params.set('to', _filters.to);
  const res = await api(`/api/feedback/stats?${params}`);
  if (!res) return;
  const d = await res.json();
  if (!d.ok) return;
  document.getElementById('kpi-total').textContent = d.total;
  document.getElementById('kpi-media').textContent = d.mediaGeral != null ? d.mediaGeral.toFixed(2) : '—';
  document.getElementById('kpi-recomenda').textContent = d.pctRecomenda != null ? d.pctRecomenda + '%' : '—';
  const h = d.porOrigem.find(r => r.origem === 'hospede')?.t || 0;
  const c = d.porOrigem.find(r => r.origem === 'colaborador')?.t || 0;
  document.getElementById('kpi-origem').innerHTML = `<span style="color:var(--gold)">${h}</span> / <span style="color:var(--indigo)">${c}</span>`;
  renderAnalysis(d);
}

// ── Table ──
const NOTA_MAP = { otimo: 4, bom: 3, regular: 2, ruim: 1 };
function avgRow(r) {
  const campos = ['servicos_expectativa','servicos_explicacao','servicos_atitude','servicos_tecnica','instalacoes_conforto','instalacoes_organizacao','instalacoes_conveniencia'];
  const vals = campos.map(c => NOTA_MAP[r[c]]).filter(Boolean);
  if (!vals.length) return null;
  return (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2);
}
function scoreClass(v) { if (v == null) return ''; return v >= 3.5 ? 'score-green' : v >= 2.5 ? 'score-yellow' : 'score-red'; }
function fmtDate(s) { if (!s) return '—'; return s.slice(0,10).split('-').reverse().join('/'); }

async function loadTable() {
  const params = new URLSearchParams({ limit: LIMIT, offset: _offset });
  if (_filters.from) params.set('from', _filters.from);
  if (_filters.to) params.set('to', _filters.to);
  if (_filters.origem) params.set('origem', _filters.origem);
  if (_filters.tipo) params.set('tipo_cliente', _filters.tipo);
  const res = await api(`/api/feedback?${params}`);
  if (!res) return;
  const d = await res.json();
  if (!d.ok) return;
  _total = d.total;

  document.getElementById('tbl-count').textContent = `${d.total} resultado${d.total !== 1 ? 's' : ''}`;

  const tbody = document.getElementById('tbl-body');
  const empty = document.getElementById('tbl-empty');

  // client-side busca por nome/email
  const busca = (document.getElementById('f-busca').value || '').toLowerCase();
  let items = d.items;
  if (busca) items = items.filter(r => r.nome?.toLowerCase().includes(busca) || r.email?.toLowerCase().includes(busca));

  if (!items.length) { tbody.innerHTML = ''; empty.style.display = ''; }
  else {
    empty.style.display = 'none';
    tbody.innerHTML = items.map(r => {
      const avg = avgRow(r);
      return `<tr>
        <td>${fmtDate(r.submitted_at)}</td>
        <td style="font-weight:500">${r.nome}</td>
        <td style="color:var(--muted)">${r.email}</td>
        <td style="color:var(--muted)">${r.tipo_cliente || '—'}</td>
        <td><span class="badge ${r.origem === 'hospede' ? 'badge-hospede' : 'badge-colab'}">${r.origem === 'hospede' ? 'Hóspede' : 'Colaborador'}</span></td>
        <td class="${scoreClass(avg)}">${avg ?? '—'}</td>
        <td><button class="btn btn-outline btn-sm" onclick="openDrawer(${r.id})">Ver</button></td>
      </tr>`;
    }).join('');
  }

  // Paginação
  const pages = Math.ceil(_total / LIMIT);
  const cur = Math.floor(_offset / LIMIT) + 1;
  const pag = document.getElementById('pagination');
  if (pages <= 1) { pag.innerHTML = ''; return; }
  pag.innerHTML = `
    <button class="btn btn-outline btn-sm" ${_offset === 0 ? 'disabled' : ''} onclick="goPage(${_offset - LIMIT})">←</button>
    <span>Página ${cur} de ${pages}</span>
    <button class="btn btn-outline btn-sm" ${_offset + LIMIT >= _total ? 'disabled' : ''} onclick="goPage(${_offset + LIMIT})">→</button>`;
}

window.goPage = (o) => { _offset = o; loadTable(); };

// ── Drawer ──
let _allItems = [];
async function openDrawer(id) {
  const res = await api(`/api/feedback?limit=9999&offset=0`);
  if (!res) return;
  const d = await res.json();
  const r = d.items.find(i => i.id === id);
  if (!r) return;

  function nota(v) {
    if (!v) return '<span style="color:var(--muted)">—</span>';
    const cls = { otimo:'nota-otimo', bom:'nota-bom', regular:'nota-regular', ruim:'nota-ruim' }[v] || '';
    const label = { otimo:'Ótimo', bom:'Bom', regular:'Regular', ruim:'Ruim' }[v] || v;
    return `<span class="nota-pill ${cls}">${label}</span>`;
  }
  function row(k, v) { return `<div class="detail-row"><span class="detail-key">${k}</span><span>${v || '<span style="color:var(--muted)">—</span>'}</span></div>`; }

  document.getElementById('drawer-content').innerHTML = `
    <div class="detail-section">
      <h3>Identificação</h3>
      ${row('Nome', r.nome)} ${row('E-mail', r.email)} ${row('Apto', r.apto)}
      ${row('Telefone', r.telefone)} ${row('Tipo', r.tipo_cliente)}
      <div class="detail-row"><span class="detail-key">Origem</span><span class="badge ${r.origem==='hospede'?'badge-hospede':'badge-colab'}">${r.origem==='hospede'?'Hóspede':'Colaborador'}</span></div>
      ${row('Data avaliação', fmtDate(r.submitted_at))}
    </div>
    <div class="detail-section">
      <h3>Tratamento</h3>
      ${row('Data tratamento', fmtDate(r.data_tratamento))} ${row('Tratamento', r.tratamento_realizado)} ${row('Massoterapista', r.nome_massoterapeuta)}
    </div>
    <div class="detail-section">
      <h3>Serviços</h3>
      <div class="detail-row"><span class="detail-key">Expectativa</span>${nota(r.servicos_expectativa)}</div>
      <div class="detail-row"><span class="detail-key">Explicação</span>${nota(r.servicos_explicacao)}</div>
      <div class="detail-row"><span class="detail-key">Atitude</span>${nota(r.servicos_atitude)}</div>
      <div class="detail-row"><span class="detail-key">Técnica</span>${nota(r.servicos_tecnica)}</div>
      ${r.servicos_comentario ? `<div class="detail-row"><span class="detail-key">Comentário</span><span style="font-style:italic;color:var(--muted)">"${r.servicos_comentario}"</span></div>` : ''}
    </div>
    <div class="detail-section">
      <h3>Instalações</h3>
      <div class="detail-row"><span class="detail-key">Conforto</span>${nota(r.instalacoes_conforto)}</div>
      <div class="detail-row"><span class="detail-key">Organização</span>${nota(r.instalacoes_organizacao)}</div>
      <div class="detail-row"><span class="detail-key">Conveniência</span>${nota(r.instalacoes_conveniencia)}</div>
      ${r.instalacoes_comentario ? `<div class="detail-row"><span class="detail-key">Comentário</span><span style="font-style:italic;color:var(--muted)">"${r.instalacoes_comentario}"</span></div>` : ''}
    </div>
    <div class="detail-section">
      <h3>Recomendação</h3>
      ${row('Recomenda?', r.recomenda)} ${row('Para quem', r.recomenda_qual)} ${row('Por quê', r.recomenda_porque)}
    </div>`;

  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
}
window.openDrawer = openDrawer;

document.getElementById('btn-close-drawer').addEventListener('click', closeDrawer);
document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}

// ── Filtros ──
document.getElementById('btn-filtrar').addEventListener('click', () => {
  _filters = {
    from: document.getElementById('f-from').value,
    to: document.getElementById('f-to').value,
    origem: document.getElementById('f-origem').value,
    tipo: document.getElementById('f-tipo').value,
  };
  _offset = 0;
  loadAll();
});

// ── Exportar CSV ──
document.getElementById('btn-exportar').addEventListener('click', () => {
  const params = new URLSearchParams({ format: 'csv' });
  if (_filters.from) params.set('from', _filters.from);
  if (_filters.to) params.set('to', _filters.to);
  if (_filters.origem) params.set('origem', _filters.origem);
  if (_filters.tipo) params.set('tipo_cliente', _filters.tipo);
  const url = `/api/feedback?${params}`;
  const a = document.createElement('a');
  a.href = url;
  a.click();
});

function loadAll() { loadStats(); loadTable(); }

// ── Navegação entre views ──
function showView(id) {
  ['view-main', 'view-massagistas', 'view-tipos', 'view-historico', 'view-reservas'].forEach(v => {
    document.getElementById(v).style.display = v === id ? 'block' : 'none';
  });
  window.scrollTo(0, 0);
  const cur = JSON.parse(sessionStorage.getItem('_vst') || '{}');
  sessionStorage.setItem('_vst', JSON.stringify({ ...cur, view: id }));
}

// ── Init ──
(function init() {
  if (tokenValido()) { showApp(); }
  else { clearToken(); sessionStorage.removeItem('_vst'); showLogin(); }

  const hoje = new Date();
  const d30 = new Date(Date.now() - 30 * 86400000);
  document.getElementById('f-to').value = hoje.toISOString().slice(0,10);
  document.getElementById('f-from').value = d30.toISOString().slice(0,10);
})();

document.getElementById('btn-open-massagistas').addEventListener('click', () => { showView('view-massagistas'); loadMassagistas(); });
document.getElementById('btn-back-massagistas').addEventListener('click', () => showView('view-main'));
document.getElementById('btn-back-historico').addEventListener('click', () => showView('view-massagistas'));

document.getElementById('btn-open-tipos').addEventListener('click', () => { showView('view-tipos'); loadTipos(); });
document.getElementById('btn-back-tipos').addEventListener('click', () => showView('view-main'));

// ── Massagistas ──
let _tabMassagistas = 'ativas';
let _massagistas = [];
let _editMId = null;
let _editTId = null;

document.querySelectorAll('#tabs-massagistas .mgmt-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    _tabMassagistas = btn.dataset.tab;
    document.querySelectorAll('#tabs-massagistas .mgmt-tab').forEach(b => b.classList.toggle('active', b === btn));
    renderMassagistas();
  });
});

document.getElementById('search-massagistas').addEventListener('input', renderMassagistas);

async function loadMassagistas() {
  const res = await api('/api/massagistas');
  if (!res) return;
  const d = await res.json();
  _massagistas = d.items;
  renderMassagistas();
}

function renderMassagistas() {
  const el = document.getElementById('list-massagistas');
  const busca = (document.getElementById('search-massagistas').value || '').toLowerCase().trim();

  const ativas = _massagistas.filter(m => m.ativo);
  const inativas = _massagistas.filter(m => !m.ativo);

  const tabA = document.querySelector('#tabs-massagistas [data-tab="ativas"]');
  const tabI = document.querySelector('#tabs-massagistas [data-tab="inativas"]');
  if (tabA) tabA.textContent = `Ativas (${ativas.length})`;
  if (tabI) tabI.textContent = `Inativas (${inativas.length})`;

  let filtered = _tabMassagistas === 'ativas' ? ativas : inativas;
  if (busca) filtered = filtered.filter(m => m.nome.toLowerCase().includes(busca));

  if (!filtered.length) {
    el.innerHTML = `<div class="mgmt-empty">${busca ? 'Nenhum resultado encontrado.' : _tabMassagistas === 'ativas' ? 'Nenhuma massoterapeuta ativa.' : 'Nenhuma massoterapeuta inativa.'}</div>`;
    return;
  }
  el.innerHTML = '<div class="mgmt-list">' + filtered.map(m => {
    const tot = m.total_avaliacoes || 0;
    const pctRec = tot > 0 ? Math.round((m.rec_sim || 0) / tot * 100) : null;
    const statHtml = tot > 0
      ? `<span class="mgmt-item-stat">${tot} avaliação${tot !== 1 ? 'ões' : ''}${pctRec != null ? ` · ${pctRec}% recomendam` : ''}</span>`
      : `<span class="mgmt-item-stat sem-aval">Sem avaliações</span>`;
    return `
      <div class="mgmt-item${m.ativo ? '' : ' mgmt-item-inativo'}">
        <div class="mgmt-item-info">
          <span class="mgmt-item-nome">${m.nome}</span>
          ${statHtml}
        </div>
        <button class="btn btn-outline btn-sm" onclick="showHistoricoMassagista(${m.id},'${m.nome.replace(/'/g,"\\'")}')">Ver histórico</button>
        <button class="btn btn-outline btn-sm" onclick="openEditMassagista(${m.id},'${m.nome.replace(/'/g,"\\'")}',${m.ativo})">Editar</button>
      </div>`;
  }).join('') + '</div>';
}

function toggleFormMassagista(show) {
  const wrap = document.getElementById('form-massagista-wrap');
  wrap.style.display = show ? 'block' : 'none';
  if (show) document.getElementById('inp-m-nome').focus();
  else { document.getElementById('inp-m-nome').value = ''; document.getElementById('err-massagista').textContent = ''; }
}

document.getElementById('btn-toggle-form-massagista').addEventListener('click', () => {
  const open = document.getElementById('form-massagista-wrap').style.display !== 'none';
  toggleFormMassagista(!open);
});

document.getElementById('btn-cancel-form-massagista').addEventListener('click', () => toggleFormMassagista(false));

document.getElementById('btn-add-massagista').addEventListener('click', async () => {
  const nome = document.getElementById('inp-m-nome').value.trim();
  const err = document.getElementById('err-massagista');
  err.textContent = '';
  if (!nome) { err.textContent = 'Informe o nome.'; return; }
  const res = await api('/api/massagistas', { method: 'POST', body: JSON.stringify({ nome }) });
  if (!res) return;
  const d = await res.json();
  if (!d.ok) { err.textContent = d.error; return; }
  toggleFormMassagista(false);
  loadMassagistas();
});

window.openEditMassagista = (id, nome, ativo) => {
  _editMId = id;
  document.getElementById('mgmt-m-sub').textContent = nome;
  document.getElementById('mgmt-m-nome').value = nome;
  const chk = document.getElementById('mgmt-m-ativo');
  chk.checked = !!ativo;
  document.getElementById('mgmt-m-ativo-txt').textContent = ativo ? 'Ativa' : 'Inativa';
  document.getElementById('mgmt-m-err').textContent = '';
  document.getElementById('mgmt-m-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('mgmt-m-nome').focus(), 50);
};

document.getElementById('mgmt-m-ativo').addEventListener('change', function() {
  document.getElementById('mgmt-m-ativo-txt').textContent = this.checked ? 'Ativa' : 'Inativa';
});
function closeMgmtM() { document.getElementById('mgmt-m-overlay').style.display = 'none'; _editMId = null; }
document.getElementById('mgmt-m-x').addEventListener('click', closeMgmtM);
document.getElementById('mgmt-m-cancelar').addEventListener('click', closeMgmtM);
document.getElementById('mgmt-m-overlay').addEventListener('click', e => { if (e.target === document.getElementById('mgmt-m-overlay')) closeMgmtM(); });
document.getElementById('mgmt-m-salvar').addEventListener('click', async () => {
  const err = document.getElementById('mgmt-m-err');
  err.textContent = '';
  const nome = document.getElementById('mgmt-m-nome').value.trim();
  if (!nome) { err.textContent = 'Informe o nome.'; return; }
  const ativo = document.getElementById('mgmt-m-ativo').checked ? 1 : 0;
  const btn = document.getElementById('mgmt-m-salvar');
  btn.disabled = true;
  try {
    const res = await api(`/api/massagistas/${_editMId}`, { method: 'PUT', body: JSON.stringify({ nome, ativo }) });
    if (!res) return;
    const d = await res.json();
    if (!d.ok) { err.textContent = d.error || 'Erro ao salvar.'; return; }
    closeMgmtM(); loadMassagistas();
  } finally { btn.disabled = false; }
});

// ── Tipos de Tratamento ──
let _tabTipos = 'ativos';
let _tipos = [];

document.querySelectorAll('#tabs-tipos .mgmt-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    _tabTipos = btn.dataset.tab;
    document.querySelectorAll('#tabs-tipos .mgmt-tab').forEach(b => b.classList.toggle('active', b === btn));
    renderTipos();
  });
});

document.getElementById('search-tipos').addEventListener('input', renderTipos);

async function loadTipos() {
  const res = await api('/api/tipos-massagem');
  if (!res) return;
  const d = await res.json();
  _tipos = d.items;
  renderTipos();
}

function renderTipos() {
  const el = document.getElementById('list-tipos');
  const busca = (document.getElementById('search-tipos').value || '').toLowerCase().trim();

  const ativos = _tipos.filter(t => t.ativo);
  const inativos = _tipos.filter(t => !t.ativo);

  const tabA = document.querySelector('#tabs-tipos [data-tab="ativos"]');
  const tabI = document.querySelector('#tabs-tipos [data-tab="inativos"]');
  if (tabA) tabA.textContent = `Ativos (${ativos.length})`;
  if (tabI) tabI.textContent = `Inativos (${inativos.length})`;

  let filtered = _tabTipos === 'ativos' ? ativos : inativos;
  if (busca) filtered = filtered.filter(t => t.nome.toLowerCase().includes(busca));

  if (!filtered.length) {
    el.innerHTML = `<div class="mgmt-empty">${busca ? 'Nenhum resultado encontrado.' : _tabTipos === 'ativos' ? 'Nenhum tratamento ativo.' : 'Nenhum tratamento inativo.'}</div>`;
    return;
  }

  el.innerHTML = '<div class="mgmt-list">' + filtered.map(t => {
    const meta = [t.duracao_min ? t.duracao_min + 'min' : null, t.preco ? 'R$' + Number(t.preco).toFixed(2) : null].filter(Boolean).join(' · ');
    const nomeSafe = t.nome.replace(/'/g, "\\'");
    const descSafe = (t.descricao || '').replace(/'/g, "\\'");
    return `
    <div class="mgmt-item ${t.ativo ? '' : 'mgmt-item-inativo'}">
      <div style="flex:1;min-width:0">
        <div class="mgmt-item-nome">${t.nome}</div>
        ${t.descricao ? `<div class="mgmt-item-meta" style="margin-top:2px">${t.descricao}</div>` : ''}
      </div>
      ${meta ? `<span class="mgmt-item-meta">${meta}</span>` : ''}
      <button class="btn btn-outline btn-sm" onclick="openEditTipo(${t.id},'${nomeSafe}',${t.duracao_min || 'null'},${t.preco || 'null'},${t.ativo},'${descSafe}')">Editar</button>
    </div>`;
  }).join('') + '</div>';
}

function toggleFormTipo(show) {
  const wrap = document.getElementById('form-tipo-wrap');
  wrap.style.display = show ? 'block' : 'none';
  if (show) document.getElementById('inp-t-nome').focus();
  else {
    document.getElementById('inp-t-nome').value = '';
    document.getElementById('inp-t-duracao').value = '';
    document.getElementById('inp-t-preco').value = '';
    document.getElementById('inp-t-descricao').value = '';
    document.getElementById('err-tipo').textContent = '';
  }
}

document.getElementById('btn-toggle-form-tipo').addEventListener('click', () => {
  const open = document.getElementById('form-tipo-wrap').style.display !== 'none';
  toggleFormTipo(!open);
});

document.getElementById('btn-cancel-form-tipo').addEventListener('click', () => toggleFormTipo(false));

document.getElementById('btn-add-tipo').addEventListener('click', async () => {
  const nome = document.getElementById('inp-t-nome').value.trim();
  const duracao_min = parseInt(document.getElementById('inp-t-duracao').value) || null;
  const preco = parseFloat(document.getElementById('inp-t-preco').value) || null;
  const descricao = document.getElementById('inp-t-descricao').value.trim() || null;
  const err = document.getElementById('err-tipo');
  err.textContent = '';
  if (!nome) { err.textContent = 'Informe o nome.'; return; }
  const res = await api('/api/tipos-massagem', { method: 'POST', body: JSON.stringify({ nome, duracao_min, preco, descricao }) });
  if (!res) return;
  const d = await res.json();
  if (!d.ok) { err.textContent = d.error; return; }
  toggleFormTipo(false);
  loadTipos();
});

window.openEditTipo = (id, nome, dur, preco, ativo, desc) => {
  _editTId = id;
  document.getElementById('mgmt-t-sub').textContent = nome;
  document.getElementById('mgmt-t-nome').value = nome;
  document.getElementById('mgmt-t-desc').value = desc || '';
  document.getElementById('mgmt-t-dur').value = dur != null ? dur : '';
  document.getElementById('mgmt-t-preco').value = preco != null ? preco : '';
  const chk = document.getElementById('mgmt-t-ativo');
  chk.checked = !!ativo;
  document.getElementById('mgmt-t-ativo-txt').textContent = ativo ? 'Ativo' : 'Inativo';
  document.getElementById('mgmt-t-err').textContent = '';
  document.getElementById('mgmt-t-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('mgmt-t-nome').focus(), 50);
};

document.getElementById('mgmt-t-ativo').addEventListener('change', function() {
  document.getElementById('mgmt-t-ativo-txt').textContent = this.checked ? 'Ativo' : 'Inativo';
});
function closeMgmtT() { document.getElementById('mgmt-t-overlay').style.display = 'none'; _editTId = null; }
document.getElementById('mgmt-t-x').addEventListener('click', closeMgmtT);
document.getElementById('mgmt-t-cancelar').addEventListener('click', closeMgmtT);
document.getElementById('mgmt-t-overlay').addEventListener('click', e => { if (e.target === document.getElementById('mgmt-t-overlay')) closeMgmtT(); });
document.getElementById('mgmt-t-salvar').addEventListener('click', async () => {
  const err = document.getElementById('mgmt-t-err');
  err.textContent = '';
  const nome = document.getElementById('mgmt-t-nome').value.trim();
  if (!nome) { err.textContent = 'Informe o nome.'; return; }
  const descricao = document.getElementById('mgmt-t-desc').value.trim() || null;
  const duracao_min = parseInt(document.getElementById('mgmt-t-dur').value) || null;
  const preco_val = parseFloat(document.getElementById('mgmt-t-preco').value) || null;
  const ativo = document.getElementById('mgmt-t-ativo').checked ? 1 : 0;
  const btn = document.getElementById('mgmt-t-salvar');
  btn.disabled = true;
  try {
    const res = await api(`/api/tipos-massagem/${_editTId}`, { method: 'PUT', body: JSON.stringify({ nome, descricao, duracao_min, preco: preco_val, ativo }) });
    if (!res) return;
    const d = await res.json();
    if (!d.ok) { err.textContent = d.error || 'Erro ao salvar.'; return; }
    closeMgmtT(); loadTipos(); _tratamentos = [];
  } finally { btn.disabled = false; }
});
document.getElementById('mgmt-t-excluir').addEventListener('click', async () => {
  const err = document.getElementById('mgmt-t-err');
  const nome = document.getElementById('mgmt-t-sub').textContent;
  if (!confirm(`Excluir "${nome}"? Esta ação não pode ser desfeita.`)) return;
  const btn = document.getElementById('mgmt-t-excluir');
  btn.disabled = true;
  try {
    const res = await api(`/api/tipos-massagem/${_editTId}`, { method: 'DELETE' });
    if (!res) return;
    const d = await res.json();
    if (!d.ok) { err.textContent = d.error || 'Erro ao excluir.'; return; }
    closeMgmtT(); loadTipos(); _tratamentos = [];
  } finally { btn.disabled = false; }
});

// ── Histórico de Massagista ──
window.showHistoricoMassagista = async (id, nome) => {
  showView('view-historico');
  const st = JSON.parse(sessionStorage.getItem('_vst') || '{}');
  sessionStorage.setItem('_vst', JSON.stringify({ ...st, view: 'view-historico', histId: id, histNome: nome }));
  document.getElementById('hist-title').textContent = nome;
  document.getElementById('hist-kpi-row').innerHTML = '<div class="hist-kpi"><div class="hist-kpi-label">Carregando…</div></div>';
  document.getElementById('hist-list').innerHTML = '';

  const res = await api(`/api/massagistas/${id}/historico`);
  if (!res) return;
  const d = await res.json();
  if (!d.ok) return;

  const items = d.items;
  const total = items.length;
  const avgs = items.map(avgRow).filter(v => v !== null).map(Number);
  const mediaGeral = avgs.length ? (avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(2) : null;
  const recSim = items.filter(r => r.recomenda === 'sim').length;
  const pctRec = total > 0 ? (recSim / total * 100).toFixed(0) : null;

  document.getElementById('hist-kpi-row').innerHTML = `
    <div class="hist-kpi">
      <div class="hist-kpi-label">Total de pesquisas</div>
      <div class="hist-kpi-val">${total}</div>
    </div>
    <div class="hist-kpi">
      <div class="hist-kpi-label">Média geral</div>
      <div class="hist-kpi-val" style="color:var(--gold)">${mediaGeral ?? '—'}</div>
    </div>
    <div class="hist-kpi">
      <div class="hist-kpi-label">Recomendariam</div>
      <div class="hist-kpi-val">${pctRec != null ? pctRec + '%' : '—'}</div>
    </div>`;

  if (!total) {
    document.getElementById('hist-list').innerHTML = '<div class="table-wrap"><div class="empty">Nenhuma pesquisa vinculada a esta profissional.</div></div>';
    return;
  }

  function computeDist(campo) {
    const dist = { otimo: 0, bom: 0, regular: 0, ruim: 0, total: 0 };
    for (const r of items) {
      const v = r[campo];
      if (v && v in dist) { dist[v]++; dist.total++; }
    }
    return dist;
  }

  function notaPill(v) {
    if (!v) return '<span style="color:var(--muted)">—</span>';
    const cls = { otimo: 'nota-otimo', bom: 'nota-bom', regular: 'nota-regular', ruim: 'nota-ruim' }[v] || '';
    const lbl = { otimo: 'Ótimo', bom: 'Bom', regular: 'Regular', ruim: 'Ruim' }[v] || v;
    return `<span class="nota-pill ${cls}">${lbl}</span>`;
  }

  const HIST_SERVICOS = [
    { campo: 'servicos_expectativa', label: 'Expectativa do tratamento' },
    { campo: 'servicos_explicacao', label: 'Explicação sobre benefícios e procedimentos' },
    { campo: 'servicos_atitude', label: 'Atitude e qualidade dos serviços' },
    { campo: 'servicos_tecnica', label: 'Técnica e habilidade' },
  ];
  const HIST_INSTALACOES = [
    { campo: 'instalacoes_conforto', label: 'Conforto e conservação da estrutura' },
    { campo: 'instalacoes_organizacao', label: 'Organização da sala e atmosfera' },
    { campo: 'instalacoes_conveniencia', label: 'Itens de conveniência' },
  ];

  const servicosHtml = HIST_SERVICOS.map(({ campo, label }) =>
    `<div class="q-row"><div class="q-label">${label}</div>${renderDistBar(computeDist(campo))}</div>`
  ).join('');
  const instalacoesHtml = HIST_INSTALACOES.map(({ campo, label }) =>
    `<div class="q-row"><div class="q-label">${label}</div>${renderDistBar(computeDist(campo))}</div>`
  ).join('');

  const comentariosServicos = items
    .filter(r => r.servicos_comentario)
    .map(r => ({ texto: r.servicos_comentario, nome: r.nome, data: r.submitted_at }));
  const comentariosInst = items
    .filter(r => r.instalacoes_comentario)
    .map(r => ({ texto: r.instalacoes_comentario, nome: r.nome, data: r.submitted_at }));
  const temComentarios = comentariosServicos.length > 0 || comentariosInst.length > 0;

  document.getElementById('hist-list').innerHTML = `
    <div class="hist-analysis-grid">
      <div class="analysis-block">
        <div class="block-head">
          <span class="block-num">01</span>
          <h3 class="block-title">Serviços</h3>
        </div>
        ${servicosHtml}
      </div>
      <div class="analysis-block">
        <div class="block-head">
          <span class="block-num">02</span>
          <h3 class="block-title">Instalações</h3>
        </div>
        ${instalacoesHtml}
      </div>
      ${temComentarios ? `
      <div class="analysis-block full">
        <div class="block-head">
          <span class="block-num">03</span>
          <h3 class="block-title">Comentários</h3>
        </div>
        ${renderTextoGroup('Sobre serviços', comentariosServicos)}
        ${renderTextoGroup('Sobre instalações', comentariosInst)}
      </div>` : ''}
    </div>

    <div class="table-wrap" style="margin-top:1.5rem">
      <div class="table-head">
        <h2>Pesquisas vinculadas</h2>
        <span>${total} resultado${total !== 1 ? 's' : ''}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Data</th><th>Cliente</th><th>Tratamento</th>
            <th>Expectativa</th><th>Atitude</th><th>Técnica</th>
            <th>Média</th><th>Recomenda</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${items.map(r => {
            const avg = avgRow(r);
            const recBadge = r.recomenda === 'sim'
              ? '<span class="badge badge-hospede">Sim</span>'
              : r.recomenda === 'nao'
                ? '<span class="badge" style="background:var(--danger-dim);color:var(--danger)">Não</span>'
                : '—';
            return `<tr>
              <td>${fmtDate(r.submitted_at)}</td>
              <td style="font-weight:500">${r.nome}</td>
              <td style="color:var(--muted)">${r.tratamento_realizado || '—'}</td>
              <td>${notaPill(r.servicos_expectativa)}</td>
              <td>${notaPill(r.servicos_atitude)}</td>
              <td>${notaPill(r.servicos_tecnica)}</td>
              <td class="${scoreClass(avg)}">${avg ?? '—'}</td>
              <td>${recBadge}</td>
              <td><button class="btn btn-outline btn-sm" onclick="openDrawer(${r.id})">Ver</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
};

// ── Reservas de Salas ────────────────────────────────────────

const CAL_ROOMS = [
  { id: 1, nome: 'Sala 1', tipo: 'Individual', cap: 1, cls: 's1' },
  { id: 2, nome: 'Sala 2', tipo: 'Individual', cap: 1, cls: 's2' },
  { id: 3, nome: 'Casal',  tipo: 'Casal',      cap: 2, cls: 's3' },
];
const CAL_H_START = 8;
const CAL_H_END   = 22;
const CAL_SLOT_PX = 60;

let _calWeekOffset = 0;
let _calDiaSel = null;
let _reservas  = [];
let _resSala       = null;
let _resTipo       = null;
let _resHoraInicio = null;
let _resHoraFim    = null;
let _tratamentos = []; // [{nome, duracao_min}]

async function loadTratamentosModal() {
  if (_tratamentos.length) return;
  try {
    const r = await fetch('/api/tipos-massagem-ativos');
    const d = await r.json();
    _tratamentos = d.items || [];
    const sel = document.getElementById('res-inp-tratamento');
    sel.innerHTML = '<option value="">— Selecione —</option>' +
      _tratamentos.map(t => `<option value="${t.nome}" data-dur="${t.duracao_min||''}">${t.nome}${t.duracao_min?' ('+t.duracao_min+' min)':''}</option>`).join('');
  } catch {}
}

const DIAS_PT  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const MESES_PT = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

function calDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function calTimeMin(t) { const [h,m]=(t||'0:0').split(':').map(Number); return h*60+(m||0); }
function calMinTime(m) { return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); }

function calGetWeek(off=0) {
  const t=new Date(); t.setHours(0,0,0,0);
  const dow=t.getDay(); const diff=dow===0?-6:1-dow;
  const mon=new Date(t); mon.setDate(t.getDate()+diff+off*7);
  return Array.from({length:7},(_,i)=>{ const d=new Date(mon); d.setDate(mon.getDate()+i); return d; });
}

async function loadReservas() {
  const days=calGetWeek(_calWeekOffset);
  const res=await api(`/api/reservas?from=${calDateStr(days[0])}&to=${calDateStr(days[6])}`);
  if(!res)return;
  const d=await res.json();
  if(d.ok){
    _reservas=d.items; renderCalWeekPills(); renderCalDia();
    const st=JSON.parse(sessionStorage.getItem('_vst')||'{}');
    sessionStorage.setItem('_vst',JSON.stringify({...st,calOff:_calWeekOffset,calDay:_calDiaSel?calDateStr(_calDiaSel):null}));
  }
}

function renderCalWeekPills() {
  const days=calGetWeek(_calWeekOffset);
  const todayStr=calDateStr(new Date());
  if(!_calDiaSel || !days.some(d=>calDateStr(d)===calDateStr(_calDiaSel))) {
    _calDiaSel=days.find(d=>calDateStr(d)===todayStr)||days[0];
  }
  const selStr=calDateStr(_calDiaSel);
  document.getElementById('cal-week-days').innerHTML=days.map(d=>{
    const ds=calDateStr(d);
    const isToday=ds===todayStr;
    const isSel=ds===selStr;
    const cnt=_reservas.filter(r=>r.data===ds).length;
    return `<button class="cal-day-pill${isToday?' today':''}${isSel?' selected':''}"
      onclick="calSelectDay('${ds}')">
      <span class="cdp-abbr">${DIAS_PT[d.getDay()]}</span>
      <span class="cdp-num">${d.getDate()}</span>
      ${cnt>0?'<span class="cdp-dot"></span>':''}
    </button>`;
  }).join('');
}

window.calSelectDay=(ds)=>{
  const [y,m,day]=ds.split('-').map(Number);
  _calDiaSel=new Date(y,m-1,day);
  renderCalWeekPills();
  renderCalDia();
};

function renderCalDia() {
  if(!_calDiaSel)return;
  const ds=calDateStr(_calDiaSel);
  const dayRes=_reservas.filter(r=>r.data===ds);

  document.getElementById('cal-rooms-header').innerHTML=
    `<div></div>`+
    CAL_ROOMS.map(r=>`
      <div class="cal-room-col-head ${r.cls}">
        <div class="cal-room-col-name ${r.cls}">${r.nome}</div>
        <div class="cal-room-col-sub">${r.tipo} · ${r.cap} pessoa${r.cap>1?'s':''}</div>
      </div>`).join('');

  let html='';
  for(let h=CAL_H_START;h<CAL_H_END;h++){
    const slotS=h*60, slotE=slotS+60;
    const timeStr=String(h).padStart(2,'0')+':00';
    html+=`<div class="cal-time-cell">${timeStr}</div>`;
    CAL_ROOMS.forEach(room=>{
      const res=dayRes.find(r=>r.sala===room.id&&calTimeMin(r.hora_inicio)<slotE&&calTimeMin(r.hora_fim)>slotS);
      if(res){
        const rs=calTimeMin(res.hora_inicio), re=calTimeMin(res.hora_fim);
        const isFirst=rs>=slotS&&rs<slotE;
        if(isFirst){
          const topPx=((rs-slotS)/60)*CAL_SLOT_PX+2;
          const ht=((re-rs)/60)*CAL_SLOT_PX-4;
          html+=`<div class="cal-slot occupied" style="overflow:visible;position:relative">
            <div class="cal-res-block ${room.cls}" style="top:${topPx}px;height:${ht}px">
              <div>
                <div class="cal-res-name">${res.cliente}</div>
                <div class="cal-res-time">${res.hora_inicio} – ${res.hora_fim}</div>
              </div>
              <button class="cal-res-cancel" onclick="calCancelar(${res.id})" title="Cancelar reserva">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>`;
        } else {
          html+=`<div class="cal-slot occupied-cont"></div>`;
        }
      } else {
        html+=`<div class="cal-slot" onclick="calOpenModal(${room.id},'${ds}','${timeStr}')"></div>`;
      }
    });
  }
  document.getElementById('cal-grid').innerHTML=html;
}

window.calCancelar=async(id)=>{
  if(!confirm('Cancelar esta reserva?'))return;
  const res=await api(`/api/reservas/${id}`,{method:'DELETE'});
  if(res)loadReservas();
};

// ── Modal Reserva ──
function calSetTipo(tipo) {
  _resTipo = tipo;
  document.querySelectorAll('.res-tipo-btn').forEach(b => b.classList.toggle('active', b.dataset.tipo === tipo));
  document.getElementById('res-fg-apto').style.display = tipo === 'hospede' ? '' : 'none';
  if (tipo !== 'hospede') document.getElementById('res-inp-apto').value = '';
}

function calOpenModal(salaId, data, hora) {
  _resSala=salaId||1;
  _resTipo=null;
  document.getElementById('res-modal-overlay').style.display='flex';
  document.getElementById('res-modal-err').textContent='';
  document.querySelectorAll('.res-tipo-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('res-fg-apto').style.display='none';
  ['res-inp-nome','res-inp-apto','res-inp-email','res-inp-tel','res-inp-tratamento'].forEach(id=>{
    document.getElementById(id).value='';
  });
  _resHoraInicio = hora || '09:00';
  _resHoraFim = null;
  document.getElementById('res-tempo-val').textContent = _resHoraInicio;
  if(data) document.getElementById('res-inp-data').value=data;
  document.querySelectorAll('.res-room-btn').forEach(b=>b.classList.toggle('active',+b.dataset.sala===_resSala));
  loadTratamentosModal();
  setTimeout(()=>document.getElementById('res-inp-nome').focus(),50);
}
window.calOpenModal=calOpenModal;

function calCloseModal(){
  document.getElementById('res-modal-overlay').style.display='none';
  _resSala=null;
}

document.getElementById('btn-nova-reserva').addEventListener('click',()=>calOpenModal(1,_calDiaSel?calDateStr(_calDiaSel):null,'09:00'));
document.getElementById('btn-res-x').addEventListener('click',calCloseModal);
document.getElementById('btn-res-cancelar').addEventListener('click',calCloseModal);
document.getElementById('res-modal-overlay').addEventListener('click',e=>{
  if(e.target===document.getElementById('res-modal-overlay'))calCloseModal();
});

document.querySelectorAll('.res-room-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    _resSala=+btn.dataset.sala;
    document.querySelectorAll('.res-room-btn').forEach(b=>b.classList.toggle('active',b===btn));
  });
});

document.querySelectorAll('.res-tipo-btn').forEach(btn=>{
  btn.addEventListener('click',()=>calSetTipo(btn.dataset.tipo));
});

document.getElementById('res-inp-tratamento').addEventListener('change', function() {
  const opt = this.options[this.selectedIndex];
  const rawDur = parseInt(opt?.dataset?.dur || '0', 10);
  const dur = rawDur || 60;
  if (!this.value) { _resHoraFim = null; document.getElementById('res-tempo-val').textContent = _resHoraInicio || '—'; return; }
  _resHoraFim = calMinTime(Math.min(calTimeMin(_resHoraInicio) + dur, CAL_H_END * 60));
  const durLabel = rawDur ? ` (${rawDur} min)` : '';
  document.getElementById('res-tempo-val').textContent = `${_resHoraInicio} – ${_resHoraFim}${durLabel}`;
});

document.getElementById('btn-res-salvar').addEventListener('click',async()=>{
  const err=document.getElementById('res-modal-err');
  err.textContent='';
  const sala=_resSala;
  const tipo=_resTipo;
  const nome=document.getElementById('res-inp-nome').value.trim();
  const apto=document.getElementById('res-inp-apto').value.trim();
  const email=document.getElementById('res-inp-email').value.trim();
  const telefone=document.getElementById('res-inp-tel').value.trim();
  const tratamento=document.getElementById('res-inp-tratamento').value.trim();
  const data=document.getElementById('res-inp-data').value;
  if(!sala){err.textContent='Selecione uma sala.';return;}
  if(!tipo){err.textContent='Selecione o tipo de cliente (Hóspede ou Passante).';return;}
  if(!nome){err.textContent='Informe o nome do cliente.';return;}
  if(!email){err.textContent='Informe o e-mail.';return;}
  if(!tratamento){err.textContent='Selecione o tratamento.';return;}
  if(!_resHoraFim){err.textContent='Tratamento sem duração definida, contate o administrador.';return;}
  if(!data){err.textContent='Informe a data.';return;}
  const btn=document.getElementById('btn-res-salvar');
  btn.disabled=true;
  try{
    const res=await api('/api/reservas',{method:'POST',body:JSON.stringify({
      sala, tipo_cliente: tipo, cliente: nome, apto, email, telefone, tratamento, data, hora_inicio: _resHoraInicio, hora_fim: _resHoraFim
    })});
    if(!res)return;
    const d=await res.json();
    if(!d.ok){err.textContent=d.error||'Erro ao salvar.';return;}
    calCloseModal();
    loadReservas();
  }finally{btn.disabled=false;}
});

document.getElementById('btn-week-prev').addEventListener('click',()=>{_calWeekOffset--;_calDiaSel=null;loadReservas();});
document.getElementById('btn-week-next').addEventListener('click',()=>{_calWeekOffset++;_calDiaSel=null;loadReservas();});
document.getElementById('btn-week-hoje').addEventListener('click',()=>{_calWeekOffset=0;_calDiaSel=null;loadReservas();});
document.getElementById('btn-open-reservas').addEventListener('click',()=>{showView('view-reservas');loadReservas();});
document.getElementById('btn-back-reservas').addEventListener('click',()=>showView('view-main'));
