const TOKEN_KEY = 'granspa_token';
const LIMIT = 30;
let _token = null;
let _offset = 0;
let _total = 0;
let _filters = {};

function token() { return _token || sessionStorage.getItem(TOKEN_KEY); }
function setToken(t) { _token = t; sessionStorage.setItem(TOKEN_KEY, t); }
function clearToken() { _token = null; sessionStorage.removeItem(TOKEN_KEY); }

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token()}` },
    ...opts,
  });
  if (res.status === 401) { logout(); return null; }
  return res;
}

function logout() { clearToken(); showLogin(); }

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
}
function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';
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
    if (d.ok) { setToken(d.token); showApp(); loadAll(); }
    else { msg.textContent = d.error || 'Credenciais inválidas'; }
  } catch { msg.textContent = 'Erro de conexão.'; }
  finally { btn.innerHTML = 'Entrar'; btn.disabled = false; }
});
document.getElementById('inp-pass').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-login').click(); });
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

// ── Init ──
(function init() {
  const t = token();
  if (t) { showApp(); loadAll(); }
  else { showLogin(); }

  // Default dates: últimos 30 dias
  const hoje = new Date();
  const d30 = new Date(Date.now() - 30 * 86400000);
  document.getElementById('f-to').value = hoje.toISOString().slice(0,10);
  document.getElementById('f-from').value = d30.toISOString().slice(0,10);
})();

// ── Modais de Cadastro ──
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.getElementById('btn-open-massagistas').addEventListener('click', () => { openModal('overlay-massagistas'); loadMassagistas(); });
document.getElementById('close-massagistas').addEventListener('click', () => closeModal('overlay-massagistas'));
document.getElementById('overlay-massagistas').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal('overlay-massagistas'); });

document.getElementById('btn-open-tipos').addEventListener('click', () => { openModal('overlay-tipos'); loadTipos(); });
document.getElementById('close-tipos').addEventListener('click', () => closeModal('overlay-tipos'));
document.getElementById('overlay-tipos').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal('overlay-tipos'); });

// ── Massagistas ──
async function loadMassagistas() {
  const res = await api('/api/massagistas');
  if (!res) return;
  const d = await res.json();
  const el = document.getElementById('list-massagistas');
  if (!d.items.length) { el.innerHTML = '<div class="mgmt-empty">Nenhuma massagista cadastrada.</div>'; return; }
  el.innerHTML = '<div class="mgmt-list">' + d.items.map(m => `
    <div class="mgmt-item ${m.ativo ? '' : 'mgmt-item-inativo'}">
      <span class="mgmt-item-nome">${m.nome}</span>
      ${m.ativo ? '' : '<span class="mgmt-item-meta">inativa</span>'}
      <button class="btn btn-outline btn-sm" onclick="editMassagista(${m.id},'${m.nome.replace(/'/g,"\\'")}',${m.ativo})">Editar</button>
      <button class="btn btn-danger btn-sm" onclick="delMassagista(${m.id})">✕</button>
    </div>`).join('') + '</div>';
}

document.getElementById('btn-add-massagista').addEventListener('click', async () => {
  const nome = document.getElementById('inp-m-nome').value.trim();
  const err = document.getElementById('err-massagista');
  err.textContent = '';
  if (!nome) { err.textContent = 'Informe o nome.'; return; }
  const res = await api('/api/massagistas', { method: 'POST', body: JSON.stringify({ nome }) });
  if (!res) return;
  const d = await res.json();
  if (!d.ok) { err.textContent = d.error; return; }
  document.getElementById('inp-m-nome').value = '';
  loadMassagistas();
});

window.editMassagista = async (id, nomeAtual, ativoAtual) => {
  const nome = prompt('Nome:', nomeAtual);
  if (nome === null) return;
  const ativo = confirm('Massagista ativa?') ? 1 : 0;
  const res = await api(`/api/massagistas/${id}`, { method: 'PUT', body: JSON.stringify({ nome, ativo }) });
  if (res) loadMassagistas();
};

window.delMassagista = async (id) => {
  if (!confirm('Excluir esta massagista?')) return;
  const res = await api(`/api/massagistas/${id}`, { method: 'DELETE' });
  if (res) loadMassagistas();
};

// ── Tipos de Massagem ──
async function loadTipos() {
  const res = await api('/api/tipos-massagem');
  if (!res) return;
  const d = await res.json();
  const el = document.getElementById('list-tipos');
  if (!d.items.length) { el.innerHTML = '<div class="mgmt-empty">Nenhum tipo cadastrado.</div>'; return; }
  el.innerHTML = '<div class="mgmt-list">' + d.items.map(t => `
    <div class="mgmt-item ${t.ativo ? '' : 'mgmt-item-inativo'}">
      <span class="mgmt-item-nome">${t.nome}</span>
      <span class="mgmt-item-meta">${t.duracao_min ? t.duracao_min + 'min' : '—'}${t.preco ? ' · R$' + Number(t.preco).toFixed(2) : ''}</span>
      ${t.ativo ? '' : '<span class="mgmt-item-meta">inativo</span>'}
      <button class="btn btn-outline btn-sm" onclick="editTipo(${t.id},'${t.nome.replace(/'/g,"\\'")}',${t.duracao_min||'null'},${t.preco||'null'},${t.ativo})">Editar</button>
      <button class="btn btn-danger btn-sm" onclick="delTipo(${t.id})">✕</button>
    </div>`).join('') + '</div>';
}

document.getElementById('btn-add-tipo').addEventListener('click', async () => {
  const nome = document.getElementById('inp-t-nome').value.trim();
  const duracao_min = parseInt(document.getElementById('inp-t-duracao').value) || null;
  const preco = parseFloat(document.getElementById('inp-t-preco').value) || null;
  const err = document.getElementById('err-tipo');
  err.textContent = '';
  if (!nome) { err.textContent = 'Informe o nome.'; return; }
  const res = await api('/api/tipos-massagem', { method: 'POST', body: JSON.stringify({ nome, duracao_min, preco }) });
  if (!res) return;
  const d = await res.json();
  if (!d.ok) { err.textContent = d.error; return; }
  document.getElementById('inp-t-nome').value = '';
  document.getElementById('inp-t-duracao').value = '';
  document.getElementById('inp-t-preco').value = '';
  loadTipos();
});

window.editTipo = async (id, nomeAtual, duracaoAtual, precoAtual, ativoAtual) => {
  const nome = prompt('Nome:', nomeAtual);
  if (nome === null) return;
  const dur = prompt('Duração (min):', duracaoAtual || '');
  const preco = prompt('Preço (R$):', precoAtual || '');
  const ativo = confirm('Tipo ativo?') ? 1 : 0;
  const res = await api(`/api/tipos-massagem/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ nome, duracao_min: parseInt(dur) || null, preco: parseFloat(preco) || null, ativo }),
  });
  if (res) loadTipos();
};

window.delTipo = async (id) => {
  if (!confirm('Excluir este tipo?')) return;
  const res = await api(`/api/tipos-massagem/${id}`, { method: 'DELETE' });
  if (res) loadTipos();
};
