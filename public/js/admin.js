const TOKEN_KEY = 'granspa_token';
const LIMIT = 30;
// Slugs hoisted para o topo — antes ficavam perto dos editores
// (linhas 3874/4408) e a IIFE de init na linha 764 (showApp→showView→
// initAnamneseEditor/initPesquisaEditor) acessava-os em TDZ quando
// o usuario recarregava com a view restaurada no sessionStorage.
const ANAMNESE_SLUG = 'spa-anamnese-v1';
const PESQUISA_SLUG = 'spa-locc-v1';
let _token = null;
let _offset = 0;
let _total = 0;
let _filters = {};
let _calWeekOffset = 0;
let _calDiaSel = null;
let _modalOpen = false;
let _resDetAtual = null;
let _langSelected = 'pt-BR';
let _hcPage = 0;
const _hcLimit = 50;

const LANGS_PRE = [
  { code: 'pt-BR', flag: '🇧🇷', name: 'Português (Brasil)' },
  { code: 'pt-PT', flag: '🇵🇹', name: 'Português (Portugal)' },
  { code: 'en',    flag: '🇺🇸', name: 'Inglês' },
  { code: 'fr',    flag: '🇫🇷', name: 'Francês' },
  { code: 'es',    flag: '🇪🇸', name: 'Espanhol' },
  { code: 'it',    flag: '🇮🇹', name: 'Italiano' },
  { code: 'de',    flag: '🇩🇪', name: 'Alemão' },
];

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

// Cache de quartos e helpers de Gran Class
let _QUARTOS_MAP = null; // { '0501': 'standard', '1401': 'gran_class', ... }
async function _carregarQuartos() {
  if (_QUARTOS_MAP) return _QUARTOS_MAP;
  try {
    const r = await fetch('/api/quartos', { credentials: 'include' });
    if (!r.ok) return (_QUARTOS_MAP = {});
    const d = await r.json();
    const map = {};
    for (const q of d.items || []) map[q.numero] = q.categoria;
    _QUARTOS_MAP = map;
    return map;
  } catch { return (_QUARTOS_MAP = {}); }
}
function _normNumQuarto(v) {
  return String(v || '').trim().replace(/\D/g, '').padStart(4, '0').slice(-4);
}
function quartoCategoria(num) {
  const n = _normNumQuarto(num);
  return _QUARTOS_MAP ? (_QUARTOS_MAP[n] || null) : null;
}
function isGranClassCli(num) {
  return quartoCategoria(num) === 'gran_class';
}
// HTML do badge — sutil, dourado, padronizado.
function badgeGranClassHtml(label = 'GRAN CLASS') {
  return `<button type="button" class="gc-badge" data-action="gc-info" title="Ver benefícios Gran Class" style="display:inline-flex;align-items:center;gap:.25rem;padding:.18rem .55rem;border:1px solid #9C5843;border-radius:9999px;background:linear-gradient(180deg,#F5EFE2,#B8705A);color:#202C28;font-family:var(--serif);font-weight:600;font-size:.74rem;letter-spacing:.08em;text-transform:uppercase;cursor:pointer">★ ${label}</button>`;
}
window.isGranClassCli = isGranClassCli;
window.badgeGranClassHtml = badgeGranClassHtml;

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Converte timestamp UTC (formato SQLite "YYYY-MM-DD HH:MM:SS") para BRT (UTC-3, Fortaleza CE).
// { br: true } retorna DD/MM/AAAA HH:MM; { seconds: true } inclui segundos (formato ISO).
function fmtBRT(utcStr, { seconds = false, br = false } = {}) {
  if (!utcStr) return '—';
  const d = new Date(String(utcStr).replace(' ', 'T') + 'Z');
  if (isNaN(d)) return String(utcStr).slice(0, 16);
  const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const iso = brt.toISOString();
  if (br) {
    const [y, mo, day] = iso.slice(0, 10).split('-');
    return `${day}/${mo}/${y} ${iso.slice(11, 16)}`;
  }
  return seconds ? iso.slice(0, 19).replace('T', ' ') : iso.slice(0, 16).replace('T', ' ');
}
// Formata data pura YYYY-MM-DD (sem timezone) para DD/MM/AAAA.
function fmtDataBR(d) { if (!d) return '—'; const p = String(d).slice(0,10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d; }

async function api(url, opts = {}) {
  try {
    // Sempre inclui cookies (cookie spa_admin_sess setado pelo /sso e' o
    // fallback de auth quando o sessionStorage perdeu o token).
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const t = token();
    if (t) headers['Authorization'] = `Bearer ${t}`;
    const res = await fetch(url, {
      ...opts,
      headers,
      credentials: 'include',
    });
    if (res.status === 401) { logout(); return null; }
    if (res.status === 403) {
      // Mostra a mensagem REAL do servidor (não uma genérica) — ajuda a
      // diferenciar "perfil read-only" de "rota master-only" etc.
      let msg = 'Sem permissão para esta ação.';
      try {
        const clone = res.clone();
        const d = await clone.json();
        if (d && d.error) msg = d.error;
      } catch {}
      showToast(msg, 5000);
      return null;
    }
    return res;
  } catch (e) {
    if (e.name === 'AbortError') return null;
    throw e;
  }
}

function logout() { pararPollingStats?.(); clearToken(); sessionStorage.clear(); localStorage.removeItem('token'); window.location.href = '/acesso-hub.html?next=' + encodeURIComponent(location.origin + '/admin'); }

function showLogin() { window.location.href = '/acesso-hub.html?next=' + encodeURIComponent(location.origin + '/admin'); }
// Roles e quais views/escopos cada um ve. admin = read-only de tudo.
// master ve e edita tudo. spa ve so escopo Spa. satisfacao ve so Relatorios+Historico.
function rolePermissions(role) {
  return {
    podeSpa:        ['master', 'admin', 'spa'].includes(role),
    podeSatisfacao: ['master', 'admin', 'satisfacao'].includes(role),
    podeUsuarios:   ['master', 'admin'].includes(role),
    podeEscrever:   ['master', 'spa', 'satisfacao'].includes(role), // admin = readonly
  };
}
function aplicarRoleNaUI(role) {
  const p = rolePermissions(role);
  // Itens do dropdown SPA
  ['btn-open-massagistas', 'btn-open-tipos'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = p.podeSpa ? '' : 'none';
  });
  // Itens do dropdown Administrativo (Relatórios concentra 3 sub-abas:
  // Avaliações, Visão Mensal e Atendimentos — todas exigem podeSatisfacao).
  const btnRelat = document.getElementById('btn-open-relatorios');
  if (btnRelat) btnRelat.style.display = p.podeSatisfacao ? '' : 'none';
  const btnQL = document.getElementById('btn-open-qualidade');
  if (btnQL) btnQL.style.display = p.podeSatisfacao ? '' : 'none';
  const btnUsr = document.getElementById('btn-open-usuarios');
  if (btnUsr) btnUsr.style.display = p.podeUsuarios ? '' : 'none';
  // Dropdowns inteiros: esconde se nenhum item dentro esta visivel
  const spaDrop = document.getElementById('spa-dropdown');
  if (spaDrop) spaDrop.style.display = p.podeSpa ? '' : 'none';
  // Administrativo: aparece se ve Relatorios/Historico OU Usuarios.
  // spa puro nao ve nada disso -> dropdown some por inteiro.
  const adminDrop = document.getElementById('admin-dropdown');
  if (adminDrop) adminDrop.style.display = (p.podeSatisfacao || p.podeUsuarios) ? '' : 'none';
  // botão "Resetar & Demo" foi removido (apagava todos os dados em produção
  // sem proteção — risco alto). Endpoint /api/dev/seed-demo também removido.
}

function showApp() {
  document.getElementById('app-screen').style.display = 'block';
  // Aplica visibilidade conforme o role gravado no JWT atual.
  try { aplicarRoleNaUI((currentUserPayload() || {}).role); } catch {}
  loadAll(); // sempre carrega dados do painel principal em background
  if (new URLSearchParams(location.search).get('home') === '1') {
    history.replaceState(null, '', '/admin');
    showView('view-reservas');
    loadReservas();
    return;
  }
  const st = JSON.parse(sessionStorage.getItem('_vst') || '{}');
  // view-escala foi removida (escala mensal em /escala-spa.html é a única) —
  // sessões antigas com _vst apontando pra ela caem em reservas.
  const view = (st.view === 'view-escala') ? 'view-reservas' : (st.view || 'view-reservas');
  showView(view);
  if (view === 'view-massagistas') { loadMassagistas(); }
  else if (view === 'view-tipos') { loadTipos(); }
  else if (view === 'view-historico') {
    if (st.histId) showHistoricoMassagista(st.histId, st.histNome);
    else { showView('view-massagistas'); loadMassagistas(); }
  }
  else if (view === 'view-historico-clientes') { _hcCarregarMassagistas(); loadHistoricoClientes(); }
  else if (view === 'view-qualidade') { loadQualidade(); }
  else if (view === 'view-clientes') { initClienteView(); }
  else if (view === 'view-auditoria') { initAuditoriaView(); }
  else if (view === 'view-salas') { loadSalas(); }
  // view-anamnese-editor e view-pesquisa-editor: ja sao carregadas
  // pelo showView(view) acima — evita fetch duplicado no boot.
  else if (view === 'view-reservas') {
    if (st.calOff != null) _calWeekOffset = st.calOff;
    if (st.calDay) { const [y,m,d]=st.calDay.split('-').map(Number); _calDiaSel=new Date(y,m-1,d); }
    loadReservas();
  }
  // FIX: view-usuarios restaurada via sessionStorage tambem precisa
  // disparar loadUsuarios. Antes ficava em 'Carregando...' eterno na F5.
  else if (view === 'view-usuarios') { loadUsuarios(); }
}


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
  const seg = (k) => { const p = pct(k); return p > 0 ? `<div class="dist-seg seg-${k}" style="width:${p}%;min-width:4px">${p >= 9 ? p + '%' : ''}</div>` : ''; };
  const leg = (k, lbl) => `<span class="dist-leg"><span class="dist-leg-dot ${k}"></span><strong>${pct(k)}%</strong> ${lbl} (${dist[k]})</span>`;
  return `<div class="dist-bar">${seg('otimo')}${seg('bom')}${seg('regular')}${seg('ruim')}</div>
    <div class="dist-legend">${leg('otimo','Ótimo')}${leg('bom','Bom')}${leg('regular','Regular')}${leg('ruim','À Melhorar')}<span class="dist-leg" style="margin-left:auto">${dist.total} resp.</span></div>`;
}

function _scoreColor(media) {
  if (media == null) return 'var(--muted)';
  if (media >= 7) return 'var(--success)';
  if (media >= 4) return 'var(--gold-dark)';
  if (media >= 2) return 'var(--gold)';
  return 'var(--danger)';
}

// Converte media (0..NOTA_MAX) para string de porcentagem "XX%" ou "—".
function _mediaPct(media) {
  if (media == null || isNaN(media)) return '—';
  const num = typeof media === 'number' ? media : parseFloat(media);
  if (isNaN(num)) return '—';
  return Math.round((num / NOTA_MAX) * 100) + '%';
}

function renderMediaBadge(media) {
  if (media == null) return `<span class="q-media-badge empty">—</span>`;
  const cor = _scoreColor(media);
  return `<span class="q-media-badge" style="background:${cor}1A;color:${cor};border-color:${cor}40"><strong>${_mediaPct(media)}</strong></span>`;
}

function renderTextoGroup(titulo, items) {
  if (!items || !items.length) return '';
  const vistos = new Set();
  const unicos = items.filter(t => { const k = t.texto?.trim(); if (!k || vistos.has(k)) return false; vistos.add(k); return true; });
  if (!unicos.length) return '';
  return `<div class="textos-sub">${titulo}</div><div class="texto-list">${unicos.map(t =>
    `<div class="texto-item"><div class="ti-text">"${escHtml(t.texto)}"</div><div class="ti-meta">${escHtml(t.nome)} · ${fmtDate(t.data)}</div></div>`
  ).join('')}</div>`;
}

function renderAnalysis(d) {
  const grid = document.getElementById('analysis-grid');
  if (!d.distribuicoes) { grid.style.display = 'none'; return; }
  grid.style.display = 'grid';
  const m = d.medias || {};
  document.getElementById('dist-servicos').innerHTML = SERVICOS_LABELS.map(({ campo, label }) =>
    `<div class="q-row"><div class="q-label-row"><div class="q-label">${label}</div>${renderMediaBadge(m[campo])}</div>${renderDistBar(d.distribuicoes[campo])}</div>`).join('');
  document.getElementById('dist-instalacoes').innerHTML = INSTALACOES_LABELS.map(({ campo, label }) =>
    `<div class="q-row"><div class="q-label-row"><div class="q-label">${label}</div>${renderMediaBadge(m[campo])}</div>${renderDistBar(d.distribuicoes[campo])}</div>`).join('');
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
  let res, d;
  try {
    res = await api(`/api/feedback/stats?${params}`);
    if (!res) return;
    d = await res.json();
  } catch { return; }
  if (!d.ok) return;
  document.getElementById('kpi-total').textContent = d.total;
  document.getElementById('kpi-media').textContent = _mediaPct(d.mediaGeral);
  document.getElementById('kpi-recomenda').textContent = d.pctRecomenda != null ? d.pctRecomenda + '%' : '—';
  const h = d.porOrigem.find(r => r.origem === 'hospede')?.t || 0;
  const c = d.porOrigem.find(r => r.origem === 'colaborador')?.t || 0;
  document.getElementById('kpi-origem').innerHTML = `<span style="color:var(--gold)">${h}</span> / <span style="color:var(--indigo)">${c}</span>`;
  renderAnalysis(d);
  _atualizarUltimoSync();
  loadSessoesSemPesquisa();
}

async function loadSessoesSemPesquisa() {
  const res = await api('/api/reservas/sem-pesquisa');
  if (!res) return;
  const d = await res.json();
  if (!d.ok) return;
  const el = document.getElementById('kpi-sem-pesquisa');
  const card = document.getElementById('kpi-sem-pesquisa-card');
  if (el) el.textContent = d.total;
  if (card) card.classList.toggle('alert', d.total > 0);
}

let _statsPoller = null;
function _atualizarUltimoSync() {
  const el = document.getElementById('stats-last-sync');
  if (el) {
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.textContent = `Atualizado às ${hora}`;
  }
}
function iniciarPollingStats() {
  pararPollingStats();
  _statsPoller = setInterval(() => {
    if (document.getElementById('view-main')?.style.display !== 'none' && !document.hidden && !_modalOpen) {
      loadStats();
      loadAll();
    }
  }, 60000);
}
function pararPollingStats() {
  if (_statsPoller) { clearInterval(_statsPoller); _statsPoller = null; }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && document.getElementById('view-main')?.style.display !== 'none' && tokenValido()) {
    loadStats();
  }
});

// ── Table ──
let _tableAbort = null;
const NOTA_MAP = { otimo: 9, bom: 6, regular: 3, ruim: 0 };
const NOTA_MAX = Math.max(...Object.values(NOTA_MAP));
function avgRow(r) {
  const campos = ['servicos_expectativa','servicos_explicacao','servicos_atitude','servicos_tecnica','instalacoes_conforto','instalacoes_organizacao','instalacoes_conveniencia'];
  const vals = campos.map(c => NOTA_MAP[r[c]]).filter(v => v !== undefined && v !== null);
  if (!vals.length) return null;
  return (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2);
}
// Média exclusiva da massoterapeuta — exclui servicos_explicacao para hóspedes não-PT
// quando a profissional não é bilíngue (campo bilingue = 0)
function ehIdiomaPortugues(idioma) { return !idioma || idioma.startsWith('pt'); }
function avgRowMass(r, ehBilingue) {
  const idiomaOk = ehBilingue || ehIdiomaPortugues(r.idioma_detectado);
  const campos = ['servicos_expectativa', 'servicos_atitude', 'servicos_tecnica'];
  if (idiomaOk) campos.splice(1, 0, 'servicos_explicacao');
  const vals = campos.map(c => NOTA_MAP[r[c]]).filter(v => v !== undefined && v !== null);
  if (!vals.length) return null;
  return (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2);
}
function avgCampo(items, campo) {
  const vals = items.map(r => NOTA_MAP[r[campo]]).filter(v => v !== undefined && v !== null);
  if (!vals.length) return null;
  return +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2);
}
function scoreClass(v) { if (v == null) return ''; return v >= 7 ? 'score-green' : v >= 4 ? 'score-yellow' : 'score-red'; }
function fmtDate(s) { if (!s) return '—'; return s.slice(0,10).split('-').reverse().join('/'); }
function fmtDataHoraBR(s) {
  if (!s) return null;
  // SQLite armazena em UTC: '2026-06-03 16:44:29' → trata como UTC
  const iso = s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d)) return s;
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = t => partes.find(p => p.type === t)?.value || '';
  return `${get('day')}/${get('month')}/${get('year')} às ${get('hour')}:${get('minute')}`;
}

async function loadTable() {
  if (_tableAbort) _tableAbort.abort();
  _tableAbort = new AbortController();
  const signal = _tableAbort.signal;

  const params = new URLSearchParams({ limit: LIMIT, offset: _offset });
  if (_filters.from) params.set('from', _filters.from);
  if (_filters.to) params.set('to', _filters.to);
  if (_filters.origem) params.set('origem', _filters.origem);
  if (_filters.tipo) params.set('tipo_cliente', _filters.tipo);
  if (_filters.massoterapeuta) params.set('massoterapeuta', _filters.massoterapeuta);
  let res, d;
  try {
    res = await api(`/api/feedback?${params}`, { signal });
    if (signal.aborted) return;
    if (!res) return;
    d = await res.json();
  } catch (e) {
    if (e?.name === 'AbortError') return;
    document.getElementById('tbl-body').innerHTML = '';
    document.getElementById('tbl-empty').style.display = '';
    document.getElementById('tbl-empty').textContent = 'Erro ao carregar dados.';
    return;
  }
  if (!d.ok) return;
  _total = d.total;

  const tbody = document.getElementById('tbl-body');
  const empty = document.getElementById('tbl-empty');

  // client-side busca por nome/email
  const busca = (document.getElementById('f-busca').value || '').toLowerCase();
  let items = d.items;
  if (busca) items = items.filter(r => r.nome?.toLowerCase().includes(busca) || r.email?.toLowerCase().includes(busca));

  // Contador reflete o subset realmente exibido: usa d.total quando nao ha
  // busca, ou items.length quando a busca client-side filtrou linhas.
  const totalExibido = busca ? items.length : d.total;
  const totalLabel = busca && items.length !== d.total
    ? `${items.length} de ${d.total} resultado${d.total !== 1 ? 's' : ''}`
    : `${totalExibido} resultado${totalExibido !== 1 ? 's' : ''}`;
  document.getElementById('tbl-count').textContent = totalLabel;

  if (!items.length) { tbody.innerHTML = ''; empty.style.display = ''; }
  else {
    empty.style.display = 'none';
    tbody.innerHTML = items.map(r => {
      const avg = avgRow(r);
      return `<tr>
        <td>${fmtDate(r.submitted_at)}</td>
        <td style="font-weight:500">${escHtml(r.nome)}</td>
        <td style="color:var(--muted)">${escHtml(r.email)}</td>
        <td style="color:var(--muted)">${escHtml(r.tipo_cliente || '—')}</td>
        <td><span class="badge ${r.origem === 'hospede' ? 'badge-hospede' : 'badge-colab'}">${r.origem === 'hospede' ? 'Hóspede' : 'Colaborador'}</span></td>
        <td class="${scoreClass(avg)}">${_mediaPct(avg)}</td>
        <td><button class="btn btn-outline btn-sm" data-action="open-drawer" data-id="${r.id}">Ver</button></td>
      </tr>`;
    }).join('');
  }

  // Paginação
  const pages = Math.ceil(_total / LIMIT);
  const cur = Math.floor(_offset / LIMIT) + 1;
  const pag = document.getElementById('pagination');
  if (pages <= 1) { pag.innerHTML = ''; return; }
  pag.innerHTML = `
    <button class="btn btn-outline btn-sm" ${_offset === 0 ? 'disabled' : ''} data-action="page" data-off="${_offset - LIMIT}">←</button>
    <span>Página ${cur} de ${pages}</span>
    <button class="btn btn-outline btn-sm" ${_offset + LIMIT >= _total ? 'disabled' : ''} data-action="page" data-off="${_offset + LIMIT}">→</button>`;
}

window.goPage = (o) => { _offset = o; loadTable(); };

// ── Drawer ──
const _FB_RATINGS = [
  { key: 'otimo', pt: 'Ótimo', en: 'Excellent' },
  { key: 'bom',   pt: 'Bom',   en: 'Good' },
  { key: 'regular', pt: 'Regular', en: 'Fair' },
  { key: 'ruim',  pt: 'Ruim',  en: 'Poor' },
];
const _FB_SERVICES = [
  { field: 'servicos_expectativa', pt: 'A expectativa do tratamento',                                               en: 'Your expectations.' },
  { field: 'servicos_explicacao',  pt: 'A explicação da massoterapeuta sobre os benefícios e procedimentos',         en: "The massage therapist's explanation about the benefits and procedures." },
  { field: 'servicos_atitude',     pt: 'A atitude e a qualidade dos serviços prestados pela massoterapeuta',         en: 'The attitude and the quality of the services provided by the massage therapist.' },
  { field: 'servicos_tecnica',     pt: 'A técnica e a habilidade da massoterapeuta',                                en: "The massage therapist's technique and ability." },
];
const _FB_FACILITIES = [
  { field: 'instalacoes_conforto',     pt: 'Conforto e conservação da estrutura do SPA',                                                        en: 'SPA comfort and cleanliness.' },
  { field: 'instalacoes_organizacao',  pt: 'Organização da sala, equipamentos e a atmosfera do ambiente',                                        en: 'Room organization, equipment and atmosphere.' },
  { field: 'instalacoes_conveniencia', pt: 'Os itens de conveniência (roupões, toalhas, etc) fornecidos durante o tratamento foram suficientes', en: 'Were the convenience items (bathrobes, towels, etc.) provided during treatment sufficient?' },
];

function _fbScaleBar() {
  return `<div class="fb-scale-bar">${_FB_RATINGS.map(r => `<div class="fb-scale-lbl">${r.pt}<br><span style="font-weight:400;text-transform:none;letter-spacing:0">${r.en}</span></div>`).join('')}</div>`;
}
function _fbRatingRow(q, val) {
  const dots = _FB_RATINGS.map(r => `<div class="fb-dot${val===r.key?' sel-'+r.key:''}"><div class="fb-dot-circle"></div></div>`).join('');
  return `<div class="fb-rating-row"><div class="fb-q-text">${escHtml(q.pt)}<span class="en">${escHtml(q.en)}</span></div><div class="fb-dots">${dots}</div></div>`;
}
function _fbField(pt, en, val, full) {
  const v = val ? escHtml(val) : '';
  return `<div class="fb-field${full?' fb-meta-full':''}"><div class="fb-field-lbl">${pt}${en?`<span class="en">/ ${en}</span>`:''}</div><div class="fb-field-val${!val?' empty':''}">${v||'—'}</div></div>`;
}
function _fbComment(label, text) {
  if (!text) return '';
  return `<div class="fb-comment"><div class="fb-comment-lbl">${label}</div><div class="fb-comment-text">${escHtml(text)}</div></div>`;
}
function _fbRadio(ptLabel, enLabel, checked, sub) {
  return `<div class="fb-radio-row"><div class="fb-radio-circle${checked?' sel':''}"></div><div class="fb-radio-text">${ptLabel}<span class="en">${enLabel}</span>${sub?`<div class="fb-radio-sub">"${escHtml(sub)}"</div>`:''}</div></div>`;
}

// Renderiza secao de perguntas EXTRAS adicionadas pelo admin no editor.
// Recebe array de itens vindos de /api/feedback/item/:id (.extras).
// Agrupa por chave (multipla pode ter N itens com a mesma chave).
function _renderExtrasFb(extras) {
  if (!Array.isArray(extras) || !extras.length) return '';
  const byChave = {};
  for (const it of extras) {
    const k = it.pergunta_chave;
    if (!byChave[k]) byChave[k] = { rotulo: it.rotulo, valores: [] };
    if (it.valor_texto != null && it.valor_texto !== '') byChave[k].valores.push(escHtml(it.valor_texto));
    else if (it.escala_opcao_rotulo) byChave[k].valores.push(escHtml(it.escala_opcao_rotulo));
    else if (it.escala_opcao_chave) byChave[k].valores.push(escHtml(it.escala_opcao_chave));
    else if (it.valor_numerico != null) byChave[k].valores.push(String(it.valor_numerico));
  }
  const linhas = Object.entries(byChave).map(([_k, info]) => `
    <div style="margin-bottom:.85rem">
      <div class="fb-field-lbl" style="margin-bottom:.25rem">${escHtml(info.rotulo)}</div>
      <div style="font-size:.92rem;color:var(--text)">${info.valores.length ? info.valores.join(', ') : '<span style="color:var(--muted);font-style:italic">— sem resposta</span>'}</div>
    </div>
  `).join('');
  return `
    <div class="fb-section">
      <div class="fb-sec-head">
        <span class="fb-sec-num">5</span>
        <span class="fb-sec-title">Perguntas adicionais <span class="fb-sec-en">Additional questions</span></span>
      </div>
      ${linhas}
    </div>
  `;
}

async function openDrawer(id) {
  const drawerEl = document.getElementById('drawer');
  const content  = document.getElementById('drawer-content');
  content.innerHTML = '<div class="detail-section"><div class="skeleton-line" style="width:60%"></div><div class="skeleton-line" style="width:40%"></div><div class="skeleton-line" style="width:75%"></div></div>';
  drawerEl.classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
  _modalOpen = true;

  const res = await api(`/api/feedback/item/${id}`);
  if (!res) { content.innerHTML = '<div class="detail-section" style="color:var(--danger)">Erro ao carregar detalhes. Tente novamente.</div>'; return; }
  const d = await res.json();
  const r = d.item;
  if (!r) { content.innerHTML = '<div class="detail-section" style="color:var(--danger)">Avaliação não encontrada.</div>'; return; }

  const tipoCli = { hospede: 'Hóspede / Guest', passante: 'Passante / Walk-in', lazer: 'Lazer / Leisure', negocios: 'Negócios / Business', evento: 'Evento / Event' }[r.tipo_cliente] || r.tipo_cliente || '';

  content.innerHTML = `
    <div class="fb-view">
      <div class="fb-view-hd">
        <div class="fb-view-title">Formulário de Feedback de Serviço</div>
        <div class="fb-view-intro">
          Para que possamos continuar nos aperfeiçoando, gostaríamos que você respondesse as perguntas abaixo assinalando a opção apropriada.
          <span class="en">Share your experience with us. In order to continue improving our services, we would like you to answer the following questions by selecting the appropriate checkbox.</span>
        </div>
      </div>

      <div class="fb-meta-grid">
        ${_fbField('Nome', 'Name', r.nome)}
        ${_fbField('Nº do Apto', 'Room number', r.apto)}
        ${_fbField('E-mail', 'E-mail', r.email)}
        ${_fbField('Tel / WhatsApp', 'Phone', r.telefone)}
        ${_fbField('Data', 'Date', r.data_tratamento ? new Date(r.data_tratamento + 'T12:00:00').toLocaleDateString('pt-BR') : null)}
        ${_fbField('Tratamento realizado', 'Spa treatment provided', r.tratamento_realizado)}
        ${_fbField('Nome da massoterapeuta', "Massage therapist's name", r.nome_massoterapeuta, true)}
        ${r.idioma_detectado ? `<div class="fb-meta-full" style="margin-top:.25rem"><div class="fb-field-lbl">Idioma detectado <span class="en">/ Detected language</span></div><div style="margin-top:3px"><span class="badge ${ehIdiomaPortugues(r.idioma_detectado) ? 'badge-hospede' : ''}" style="${ehIdiomaPortugues(r.idioma_detectado) ? '' : 'background:var(--warn-dim,#FEF3CD);color:var(--warn,#C49A2D)'}">${r.idioma_detectado.toUpperCase()}</span>${!ehIdiomaPortugues(r.idioma_detectado) ? ' <span style="font-size:.75rem;color:var(--muted)">— Explicação desconsiderada para profissionais não bilíngues</span>' : ''}</div></div>` : ''}
      </div>

      <div class="fb-section">
        <div class="fb-sec-head">
          <span class="fb-sec-num">1</span>
          <span class="fb-sec-title">Serviços <span class="fb-sec-en">Services</span></span>
        </div>
        ${_fbScaleBar()}
        ${_FB_SERVICES.map(q => _fbRatingRow(q, r[q.field])).join('')}
        ${_fbComment('Comentários e sugestões / Additional comments', r.servicos_comentario)}
      </div>

      <div class="fb-section">
        <div class="fb-sec-head">
          <span class="fb-sec-num">2</span>
          <span class="fb-sec-title">Instalações <span class="fb-sec-en">Facilities</span></span>
        </div>
        ${_fbScaleBar()}
        ${_FB_FACILITIES.map(q => _fbRatingRow(q, r[q.field])).join('')}
        ${_fbComment('Comentários e sugestões / Additional comments', r.instalacoes_comentario)}
      </div>

      <div class="fb-section">
        <div class="fb-sec-head">
          <span class="fb-sec-num">3</span>
          <span class="fb-sec-title">Recomendação <span class="fb-sec-en">Recommendation</span></span>
        </div>
        <div style="font-size:.8rem;color:var(--muted);margin-bottom:.6rem">Você recomendaria algum tratamento em particular? / Would you recommend any particular treatment?</div>
        <div class="fb-radio-list">
          ${_fbRadio('Sim', 'Yes', r.recomenda === 'sim', r.recomenda_qual)}
          ${_fbRadio('Não', 'No', r.recomenda === 'nao', r.recomenda_porque)}
        </div>
      </div>

      <div class="fb-section">
        <div class="fb-sec-head">
          <span class="fb-sec-num">4</span>
          <span class="fb-sec-title">Tipo de cliente <span class="fb-sec-en">Type of guest</span></span>
        </div>
        <div class="fb-radio-list">
          ${_fbRadio('Lazer', 'Leisure', r.tipo_cliente === 'lazer')}
          ${_fbRadio('Negócios', 'Business', r.tipo_cliente === 'negocios')}
          ${_fbRadio('Evento', 'Event', r.tipo_cliente === 'evento')}
        </div>
      </div>

      ${_renderExtrasFb(d.extras)}

      <div class="fb-view-footer">
        <div class="fb-view-footer-sig">Atenciosamente,</div>
        <div class="fb-view-footer-brand">Equipe do Gran SPA by L'Occitane</div>
        <div class="fb-submitted">Enviado em ${fmtDate(r.submitted_at)} · <span class="badge ${r.origem==='hospede'?'badge-hospede':'badge-colab'}">${r.origem==='hospede'?'Hóspede':'Colaborador'}</span></div>
      </div>
    </div>`;
}
window.openDrawer = openDrawer;

document.getElementById('btn-close-drawer').addEventListener('click', closeDrawer);
document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);
// Tecla ESC fecha o drawer (atalho de teclado pareando outros modais).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!document.getElementById('drawer').classList.contains('open')) return;
  closeDrawer();
});
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
  _modalOpen = false;
}

// ── Filtros ──
document.getElementById('btn-filtrar').addEventListener('click', () => {
  _filters = {
    from: document.getElementById('f-from').value,
    to: document.getElementById('f-to').value,
    origem: document.getElementById('f-origem').value,
    tipo: document.getElementById('f-tipo').value,
    massoterapeuta: document.getElementById('f-massoterapeuta')?.value || '',
  };
  _offset = 0;
  loadAll();
});

function loadAll() { loadStats(); loadTable(); _popularSelectMassoterapeutas(); }

// Popula o select #f-massoterapeuta com massagistas ativas. Idempotente —
// so' carrega uma vez por sessao (a lista nao muda durante a sessao do admin).
let _massoterapeutasSelectCache = null;
async function _popularSelectMassoterapeutas() {
  const sel = document.getElementById('f-massoterapeuta');
  if (!sel || sel.dataset.loaded === '1') return;
  if (!_massoterapeutasSelectCache) {
    try {
      const r = await api('/api/massagistas-ativas');
      if (!r) return;
      const d = await r.json();
      _massoterapeutasSelectCache = (d?.items || d?.nomes || []).map(x =>
        typeof x === 'string' ? x : (x.nome || x)
      ).filter(Boolean);
    } catch { return; }
  }
  // Preserva o option "Geral (todas)" do HTML
  const atual = sel.value;
  const opts = ['<option value="">Geral (todas)</option>']
    .concat(_massoterapeutasSelectCache.map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`));
  sel.innerHTML = opts.join('');
  sel.value = atual; // mantem selecao se ja havia
  sel.dataset.loaded = '1';
}

// ── Navegação entre views ──
function showView(id) {
  if (document.getElementById('drawer')?.classList.contains('open')) closeDrawer();
  // Lista completa de views.
  ['view-main', 'view-massagistas', 'view-tipos', 'view-historico', 'view-reservas', 'view-historico-clientes', 'view-usuarios', 'view-qualidade', 'view-clientes', 'view-auditoria', 'view-anamnese-editor', 'view-pesquisa-editor', 'view-salas'].forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = v === id ? 'block' : 'none';
  });
  if (id === 'view-massagistas') {
    const s = document.getElementById('search-massagistas');
    if (s) { s.value = ''; renderMassagistas(); }
  }
  if (id === 'view-tipos') {
    const s = document.getElementById('search-tipos');
    if (s) s.value = '';
  }
  window.scrollTo(0, 0);
  const cur = JSON.parse(sessionStorage.getItem('_vst') || '{}');
  sessionStorage.setItem('_vst', JSON.stringify({ ...cur, view: id }));
  if (id === 'view-main') iniciarPollingStats(); else pararPollingStats();
  // Mostra/esconde botão "Início" no header
  const homeBtn = document.getElementById('btn-header-home');
  if (homeBtn) homeBtn.style.display = (id === 'view-reservas') ? 'none' : '';
  // Renderiza a barra de sub-abas de Relatórios quando uma das 3 views está
  // ativa. Carrega os dados da view que acabou de ser ativada também.
  renderTabsRelatorios(id);
  if (id === 'view-historico-clientes') { _hcCarregarMassagistas(); loadHistoricoClientes(); }
  if (id === 'view-anamnese-editor') initAnamneseEditor();
  if (id === 'view-pesquisa-editor') initPesquisaEditor();
}

// ── Sub-abas de Relatórios ──
// Visão Mensal foi unificada no Histórico de Clientes (KPIs do periodo
// + coluna 'Pesquisa' + filtro de status). Restam 2 abas.
const REL_TABS = [
  { view: 'view-main',                 label: 'Avaliações' },
  { view: 'view-historico-clientes',   label: 'Atendimentos' },
];

function renderTabsRelatorios(viewAtual) {
  // Remove barras antigas em todas as views
  document.querySelectorAll('[data-rel-tabs]').forEach(el => el.remove());
  const ehRel = REL_TABS.some(t => t.view === viewAtual);
  if (!ehRel) return;
  const host = document.getElementById(viewAtual);
  if (!host) return;
  const nav = document.createElement('nav');
  nav.setAttribute('data-rel-tabs', '');
  nav.style.cssText = 'display:flex;gap:0;margin:0 0 1.4rem 0;border-bottom:1px solid var(--border)';
  nav.innerHTML = REL_TABS.map(t => {
    const ativo = t.view === viewAtual;
    return `<button class="rel-tab${ativo ? ' is-active' : ''}" data-rel-view="${t.view}" style="
      padding:.7rem 1.3rem;background:none;border:none;cursor:pointer;
      border-bottom:2px solid ${ativo ? 'var(--gold,#9C5843)' : 'transparent'};
      color:${ativo ? 'var(--text)' : 'var(--muted)'};
      font-family:var(--serif);font-size:1.08rem;
      font-weight:${ativo ? '600' : '500'};letter-spacing:.015em;
      transition:color .15s, border-color .15s;
    ">${t.label}</button>`;
  }).join('');
  host.insertBefore(nav, host.firstChild);
  nav.querySelectorAll('button[data-rel-view]').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.relView));
  });
}

// ── Toast ──
function showToast(msg, duration = 4000) {
  let el = document.getElementById('_admin-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '_admin-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), duration);
}

function _showRecepAlertPopup() {
  const existing = document.getElementById('_recep-alert-popup');
  if (existing) return;
  const overlay = document.createElement('div');
  overlay.id = '_recep-alert-popup';
  const isDark = document.documentElement.dataset.theme === 'dark' || document.body.dataset.theme === 'dark' || document.body.classList.contains('dark');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(3px)';
  overlay.innerHTML = `
    <div style="background:var(--surface);border:1.5px solid var(--gold);border-radius:14px;max-width:380px;width:90%;padding:1.4rem 1.5rem 1.25rem;position:relative;box-shadow:0 8px 40px rgba(0,0,0,.38)">
      <button id="_recep-alert-x" style="position:absolute;top:.65rem;right:.8rem;background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--muted);line-height:1;padding:.2rem .3rem;border-radius:4px;transition:background .15s" aria-label="Fechar">✕</button>
      <div style="display:flex;align-items:center;gap:.65rem;margin-bottom:.9rem">
        <span style="font-size:1.5rem;line-height:1">🛎</span>
        <span style="font-family:var(--serif);font-size:1rem;font-weight:700;color:var(--text);letter-spacing:.01em">Recepção descoberta</span>
      </div>
      <p style="margin:0 0 .5rem;font-size:.85rem;color:var(--muted2);line-height:1.6">Não há recepcionista em escala neste horário. Selecionar todas as massoterapeutas disponíveis deixaria a recepção do SPA descoberta.</p>
      <p style="margin:0;font-size:.8rem;color:var(--muted);line-height:1.5">Ajuste a escala ou escolha um horário em que haja recepcionista disponível.</p>
    </div>`;
  document.body.appendChild(overlay);
  // Fecha SOMENTE no ✕ (pedido explícito): clique fora não dispensa o alerta.
  document.getElementById('_recep-alert-x').addEventListener('click', () => overlay.remove());
}

// ── Liberar Pesquisa de Satisfação ──
const _pesquisasLiberadas = new Set();

const _fichasEnviadas = new Set();

function _estadoBtnFicha(r) {
  // Janela de envio: anamnese pode ser enviada ate' 10min APOS o hora_inicio.
  // O estado 'enviada' (rastreado em _fichasEnviadas) NAO bloqueia mais reenvio
  // — modo-temp manteve o reenvio livre. A trava real de uso unico do CLIENTE
  // que preenche o link e' no backend (gate em reservas.documento_perfil_id);
  // aqui no admin a unica regra ativa e' a janela de tempo.
  //
  // TZ: usa -03:00 fixo (Fortaleza) pra bater EXATAMENTE com o gate backend
  // em src/routes/reservas.js (sem isso, divergencia se admin estiver em
  // outro fuso). slice(0,5) defende contra dados sujos no banco (HH:MM:SS).
  if (!r || !r.data || !r.hora_inicio) return 'ok';
  // Normaliza "9:30" -> "09:30" e "13:00:00" -> "13:00". Bate com a logica
  // do backend (_normalizarHHMM em src/routes/reservas.js).
  const raw = String(r.hora_inicio);
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 'ok';
  const h = String(+m[1]).padStart(2, '0');
  if (+h > 23 || +m[2] > 59) return 'ok';
  const inicio = new Date(`${r.data}T${h}:${m[2]}:00-03:00`).getTime();
  if (!Number.isFinite(inicio)) return 'ok';
  // ⚠️ MODO TEMPORARIO: gate de 15min desativado. Reverter quando user disser "volte o tempo como era antes".
  // if (Date.now() > inicio + 15 * 60 * 1000) return 'fora_prazo';
  return 'ok';
}

// Combina estado da anamnese (respondida/enviada/expirada/nao_enviada) com a
// janela de tempo. Prioridade: respondida > enviada > fora_prazo > expirada >
// nao_enviada. Razao: se ja foi respondida ou enviada, NAO interessa o relogio
// — admin sempre acessa anamnese antiga / nao reenvia em cima do token vivo.
// So' bloqueia "fora_prazo" quando nao_enviada (incluindo expirada — 48h
// permite reenvio segundo o modo-temp, mas a janela de 10min nao).
function _estadoFinalBtnFicha(r, pessoa = 1) {
  const estAna = _estadoAnamnese(r, pessoa);
  if (estAna === 'respondida' || estAna === 'enviada') return estAna;
  if (_estadoBtnFicha(r) === 'fora_prazo') return 'fora_prazo';
  return estAna;
}

// Estado real da anamnese por pessoa, derivado dos campos do backend.
// Independente das janelas de tempo do MODO TEMP — usa o vinculo do perfil
// (respondida) e a presenca/expiry do token (enviada/expirada).
function _estadoAnamnese(r, pessoa = 1) {
  if (!r) return 'nao_enviada';
  const perfilField = pessoa === 2 ? 'documento_perfil_id2' : 'documento_perfil_id';
  const tokenField  = pessoa === 2 ? 'documento_token2'      : 'documento_token';
  const expiryField = pessoa === 2 ? 'documento_token_expiry2' : 'documento_token_expiry';
  if (r[perfilField]) return 'respondida';
  if (r[tokenField]) {
    if (r[expiryField]) {
      const exp = new Date(r[expiryField]).getTime();
      if (Number.isFinite(exp) && Date.now() > exp) return 'expirada';
    }
    return 'enviada';
  }
  return 'nao_enviada';
}

// Subtexto de status exibido abaixo do botao ANAMNESE no rodape do modal.
function _setFichaStatus(texto, tom) {
  const el = document.getElementById('resdet-ficha-status');
  if (!el) return;
  if (!texto) { el.style.display = 'none'; el.textContent = ''; el.style.color = ''; return; }
  el.style.display = '';
  el.textContent = texto;
  el.style.color = tom === 'ok' ? 'var(--forest, #2e7d32)' : '';
}

// O botao mantem SEMPRE o rotulo padrao "ANAMNESE" (pedido do cliente).
// O status vive no subtexto: "Link gerado" apos gerar, "Anamnese respondida"
// quando preenchida. Com link ja gerado o botao PERMANECE habilitado para
// reenvio (regenera o token dentro da janela). Respondida: clique abre a
// anamnese preenchida (readonly).
function _aplicarEstadoBtnFicha(btn, estado) {
  if (!btn) return;
  btn.dataset.estadoFicha = estado;
  btn.onclick = null;
  btn.textContent = estado === 'respondida' ? 'Anamnese respondida' : 'ANAMNESE';
  if (estado === 'respondida') {
    btn.disabled = false;
    btn.dataset.action = 'ver-anamnese-pessoa';
    btn.dataset.pessoa = '1';
    _setFichaStatus('');
  } else if (estado === 'enviada') {
    // Reenvio permitido enquanto a janela de envio estiver aberta; depois
    // dela o backend recusa (409 tempo_expirado), entao desabilita aqui.
    btn.disabled = _resDetAtual ? _estadoBtnFicha(_resDetAtual) !== 'ok' : false;
    btn.dataset.action = 'enviar-pre-massagem';
    delete btn.dataset.pessoa;
    _setFichaStatus('Link gerado');
  } else if (estado === 'fora_prazo') {
    btn.disabled = true;
    btn.dataset.action = 'enviar-pre-massagem';
    delete btn.dataset.pessoa;
    _setFichaStatus('Tempo para enviar anamnese expirado');
  } else {
    // nao_enviada, expirada, ok (legado modo-temp): permite envio.
    btn.disabled = false;
    btn.dataset.action = 'enviar-pre-massagem';
    delete btn.dataset.pessoa;
    _setFichaStatus('');
  }
}

// estado: 'ok' | 'liberada' | 'fora_prazo' | 'antes_fim'
function _aplicarEstadoLiberada(btn, estado) {
  if (!btn) return;
  if (estado === true) estado = 'liberada';
  if (estado === false) estado = 'ok';
  btn.disabled = estado !== 'ok';
  btn.dataset.estado = estado;
  if (estado === 'liberada') {
    btn.textContent = 'PESQUISA JÁ LIBERADA';
  } else if (estado === 'fora_prazo') {
    btn.textContent = 'Prazo encerrado';
  } else if (estado === 'antes_fim') {
    btn.textContent = 'Pesquisa de satisfação ficará disponível ao fim do tratamento';
  } else {
    btn.textContent = 'Liberar Pesquisa';
  }
  btn.style.opacity = '';
  btn.style.cursor = '';
  btn.style.fontSize   = estado === 'antes_fim' ? '.68rem' : '';
  btn.style.whiteSpace = estado === 'antes_fim' ? 'normal'  : '';
  btn.style.lineHeight = estado === 'antes_fim' ? '1.25'    : '';
}

function _estadoBtnLiberar(r) {
  // ⚠️ MODO TEMPORARIO: sem _pesquisasLiberadas (permite reenvio).
  // Janela: disponivel ao fim do tratamento, admin tem 40min para liberar.
  // Reverter quando user disser "volte o tempo como era antes".
  if (!r || !r.data || !r.hora_fim) return 'ok';
  const raw = String(r.hora_fim);
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 'ok';
  const h = match[1].padStart(2, '0');
  const fim = new Date(`${r.data}T${h}:${match[2]}:00-03:00`).getTime();
  if (!Number.isFinite(fim)) return 'ok';
  // ⚠️ MODO TEMPORARIO: gates antes_fim e fora_prazo desativados. Reverter quando user disser "volte o tempo como era antes".
  // const now = Date.now();
  // if (now < fim) return 'antes_fim';
  // if (now > fim + 40 * 60 * 1000) return 'fora_prazo';
  return 'ok';
  /* VERSAO ORIGINAL (com janela de fim+30min):
  if (_pesquisasLiberadas.has(r.id)) return 'liberada';
  const now = Date.now();
  const fim = new Date(`${r.data}T${r.hora_fim}:00`).getTime();
  if (now < fim) return 'antes_fim';
  if (now > fim + 30 * 60 * 1000) return 'fora_prazo';
  return 'ok';
  */
}

async function liberarPesquisaReserva(id) {
  const btn = document.getElementById('resdet-liberar');
  // ⚠️ MODO TEMPORARIO: gate de estados removido (permite reenvio).
  // Reverter quando user disser "volte o tempo como era antes".
  // if (btn?.dataset.estado === 'fora_prazo' || btn?.dataset.estado === 'liberada' || btn?.dataset.estado === 'antes_fim') return;
  if (btn) { btn.disabled = true; btn.textContent = 'Liberando…'; }
  try {
    const res = await api(`/api/reservas/${id}/liberar-pesquisa`, { method: 'POST', body: '{}' });
    if (!res) { _aplicarEstadoLiberada(btn, false); return; }
    const d = await res.json();
    if (!d.ok) { alert('Erro ao liberar pesquisa: ' + (d.error || '')); _aplicarEstadoLiberada(btn, false); return; }
    // ⚠️ MODO TEMPORARIO: nao adiciona ao Set para permitir reenvio.
    // _pesquisasLiberadas.add(id);
    _aplicarEstadoLiberada(btn, 'ok');

    // Reserva CASAL: mostra modal com botao "Liberar Pesquisa" por hospede.
    // Pesquisa e respondida AO VIVO no tablet aberto em /, nao por WhatsApp —
    // por isso URL/copy/WhatsApp foram removidos. Cada botao re-bumpa
    // liberada_em do token daquela pessoa para que o tablet (polling 1s)
    // pegue ESPECIFICAMENTE aquele hospede no proximo tick.
    if (d.casal) {
      _modalLiberarPesquisaCasal({ reservaId: id, h1: d.hospede1, h2: d.hospede2 });
    } else {
      showToast('✓ Pesquisa liberada — o botão já apareceu na tela do hóspede');
    }
  } catch {
    _aplicarEstadoLiberada(btn, false);
  }
}

// Modal de casal — pesquisa respondida ao vivo no tablet. Cada hospede tem
// seu proprio botao "Liberar Pesquisa" que ativa apenas o token dele em
// survey_tokens.liberada_em via POST /api/reservas/:id/pessoa/:n/ativar-pesquisa.
// O tablet (polling 1s em /api/survey/live) pega esse hospede automaticamente.
function _modalLiberarPesquisaCasal({ reservaId, h1, h2 }) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.72);backdrop-filter:blur(2px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  // Estado mantido em closure pra re-render dinamico via polling.
  // jaLiberado[1/2] = admin clicou pelo menos 1x (texto "Liberar novamente").
  const estado = { 1: h1, 2: h2 };
  const jaLiberado = { 1: false, 2: false };
  // 2 estados visuais distintos, ambos usando tokens do design system:
  // - RESPONDIDA: card com border-left dourado, badge ✓, botao "Ver respostas →"
  //   (admin nao pode mais liberar — pesquisa ja consumida pelo hospede)
  // - PENDENTE: card neutro, CTA gold "Liberar pesquisa" (re-clicavel
  //   quantas vezes quiser — toast confirma cada acionamento)
  const card = ({ idx, h }) => {
    const ja = h.respondida && h.feedback_id;
    const wrapStyle = ja
      ? 'border:1px solid var(--border);border-left:3px solid var(--gold);border-radius:8px;padding:1rem 1.1rem;margin-bottom:.7rem;background:linear-gradient(90deg,rgba(156,88,67,.04),transparent 60%)'
      : 'border:1px solid var(--border);border-radius:8px;padding:1rem 1.1rem;margin-bottom:.7rem';
    const headerLabel = ja
      ? `<span style="font-family:'JetBrains Mono',monospace;font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);padding:.18rem .5rem;border:1px solid var(--gold);border-radius:99px;display:inline-flex;align-items:center;gap:.3rem">✓ Respondida</span>`
      : `<span style="font-family:'JetBrains Mono',monospace;font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)">${jaLiberado[idx] ? 'Aguardando no tablet' : 'Pendente'}</span>`;
    let botao;
    if (ja) {
      botao = `<button class="btn btn-outline" data-ver-fb="${h.feedback_id}" style="width:100%">Ver respostas <span style="margin-left:.35rem;display:inline-block;transition:transform .2s">→</span></button>`;
    } else if (jaLiberado[idx]) {
      botao = `<button class="btn btn-gold" data-ativar="${idx}" style="width:100%">↻ Liberar novamente</button>`;
    } else {
      botao = `<button class="btn btn-gold" data-ativar="${idx}" style="width:100%">Liberar pesquisa</button>`;
    }
    return `
      <div data-card-pessoa="${idx}" style="${wrapStyle}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem;margin-bottom:.8rem">
          <div style="display:flex;flex-direction:column;gap:.2rem;min-width:0">
            <span style="font-family:'JetBrains Mono',monospace;font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)">Hóspede ${idx}</span>
            <span style="font-weight:600;font-size:.98rem;color:var(--text,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(h.nome || '(sem nome)')}</span>
          </div>
          ${headerLabel}
        </div>
        ${botao}
      </div>
    `;
  };
  const renderCards = () => {
    const cardsHtml = card({ idx: 1, h: estado[1] }) + card({ idx: 2, h: estado[2] });
    ov.querySelector('[data-cards-host]').innerHTML = cardsHtml;
  };
  ov.innerHTML = `
    <div role="dialog" aria-modal="true" aria-labelledby="modal-casal-title" style="background:var(--surface);border:1px solid var(--border);border-radius:10px;max-width:520px;width:100%;padding:1.5rem 1.7rem;box-shadow:0 12px 40px rgba(0,0,0,.4)">
      <h3 id="modal-casal-title" style="margin:0 0 .8rem 0;font-family:var(--serif);font-size:1.4rem">Pesquisa do casal — libere por hóspede</h3>
      <p style="color:var(--muted);font-size:.85rem;margin-bottom:1.1rem;line-height:1.5">A pesquisa será respondida ao vivo no tablet do SPA. Clique em <strong>Liberar pesquisa</strong> do hóspede que vai responder agora. Quando ele terminar, clique no outro hóspede.</p>
      <div data-cards-host>
        ${card({ idx: 1, h: estado[1] })}
        ${card({ idx: 2, h: estado[2] })}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:.8rem">
        <button class="btn btn-outline" data-act="close">Fechar</button>
      </div>
    </div>
  `;
  // Polling 3s: detecta quando hospede responde no tablet e atualiza o card
  // automaticamente (sem precisar fechar/reabrir o modal). Para o polling
  // quando ambos respondidos ou modal fechado.
  let pollTimer = null;
  const poll = async () => {
    try {
      const r = await api(`/api/reservas/${reservaId}/status-pesquisa-casal`);
      if (!r) return;
      const d = await r.json();
      if (!d?.ok) return;
      let mudou = false;
      for (const idx of [1, 2]) {
        const k = 'h' + idx;
        const nova = d[k];
        const atual = estado[idx];
        if (nova && (nova.respondida !== !!atual.respondida || nova.feedback_id !== atual.feedback_id)) {
          estado[idx] = { ...atual, respondida: nova.respondida, feedback_id: nova.feedback_id };
          mudou = true;
        }
      }
      if (mudou) renderCards();
      if (estado[1].respondida && estado[2].respondida) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    } catch {}
  };
  pollTimer = setInterval(poll, 3000);
  const fechar = () => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    document.removeEventListener('keydown', onKey);
    ov.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', async e => {
    if (e.target.dataset.act === 'close') { fechar(); return; }
    // Click no card "Pesquisa preenchida" → fecha modal e abre o drawer.
    const verFb = e.target.dataset.verFb;
    if (verFb) {
      fechar();
      openDrawer(+verFb);
      return;
    }
    const pessoa = e.target.dataset.ativar;
    if (!pessoa) return;
    const p = +pessoa;
    // Se outro hospede ja foi liberado e ainda nao respondeu, avisa que
    // substituir vai roubar o tablet do que esta aberto. So bloqueia entre
    // pessoas diferentes — re-liberar a MESMA pessoa e' livre.
    const outro = p === 1 ? 2 : 1;
    const outroLiberadoEnaoRespondido = jaLiberado[outro] && !estado[outro].respondida;
    if (outroLiberadoEnaoRespondido && !confirm(
      'O outro hóspede já foi liberado e pode estar respondendo agora.\n\n' +
      'Continuar vai SUBSTITUIR a pesquisa que está aberta no tablet — o outro hóspede perde o progresso.\n\n' +
      'Deseja continuar?'
    )) return;
    const btn = e.target;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Liberando…';
    try {
      const res = await api(`/api/reservas/${reservaId}/pessoa/${pessoa}/ativar-pesquisa`, { method: 'POST', body: '{}' });
      const d = res ? await res.json() : null;
      if (d?.ok) {
        jaLiberado[p] = true;
        renderCards();
        showToast(`✓ Pesquisa do Hóspede ${pessoa} liberada no tablet`);
      } else {
        btn.disabled = false;
        btn.textContent = original;
        showToast('Erro ao liberar: ' + (d?.error || 'tente novamente'));
      }
    } catch {
      btn.disabled = false;
      btn.textContent = original;
      showToast('Erro de rede — tente novamente');
    }
  });
  document.body.appendChild(ov);
  setTimeout(() => ov.querySelector('[data-ativar="1"]')?.focus(), 0);
}

// Pessoa-alvo do fluxo de envio de anamnese. 0 = comportamento legado
// (casal envia ambos; individual envia 1). 1 ou 2 = envia apenas aquela
// pessoa em reserva casal.
let _pessoaAnamneseAlvo = 0;

function _mostrarConfirmacaoAnamnese(onConfirm) {
  const r = _resDetAtual;
  if (!r) return;
  let nomeExib;
  if (_pessoaAnamneseAlvo === 1)      nomeExib = r.cliente;
  else if (_pessoaAnamneseAlvo === 2) nomeExib = r.cliente2 || r.cliente;
  else nomeExib = r.cliente2 ? `${r.cliente} & ${r.cliente2}` : r.cliente;
  const langInfo = LANGS_PRE.find(l => l.code === _langSelected) || { flag: '🌐', name: _langSelected };

  document.body.style.overflow = 'hidden';
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.65);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1.25rem;box-sizing:border-box';
  ov.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;max-width:420px;width:100%;padding:2rem 2rem 1.75rem;box-shadow:0 24px 64px rgba(0,0,0,.35);position:relative;box-sizing:border-box">
      <button data-act="close" style="position:absolute;top:1rem;right:1rem;background:none;border:1px solid var(--border-soft);cursor:pointer;color:var(--muted);font-size:.9rem;width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;line-height:1;padding:0">✕</button>
      <div style="font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);font-weight:600;margin-bottom:.5rem">Confirmar envio</div>
      <h3 style="margin:0 0 1.35rem 0;font-family:var(--font);font-size:1.25rem;color:var(--text);line-height:1.25">Enviar Anamnese</h3>
      <div style="background:var(--bg);border:1px solid var(--border-soft);border-radius:10px;padding:.9rem 1.1rem;margin-bottom:1.1rem;display:grid;gap:.55rem">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem">
          <span style="font-size:.78rem;color:var(--muted);flex-shrink:0">Hóspede</span>
          <span style="font-size:.875rem;color:var(--text);font-weight:500;text-align:right;word-break:break-word">${escHtml(nomeExib || '—')}</span>
        </div>
        <div style="height:1px;background:var(--border-soft)"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem">
          <span style="font-size:.78rem;color:var(--muted);flex-shrink:0">Idioma</span>
          <span style="font-size:.875rem;color:var(--text)">${langInfo.flag} ${escHtml(langInfo.name)}</span>
        </div>
      </div>
      <p style="font-size:.8rem;color:var(--muted);margin:0 0 1.4rem 0;line-height:1.55">Um link exclusivo de anamnese será gerado. Você escolhe como enviar: WhatsApp, email ou copiando o link.</p>
      <div style="display:flex;gap:.6rem;justify-content:flex-end">
        <button class="btn btn-outline" data-act="cancel">Cancelar</button>
        <button class="btn btn-forest" data-act="confirm">Gerar link</button>
      </div>
    </div>
  `;
  ov.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'confirm') {
      ov.remove();
      onConfirm(); // scroll continua travado — modal de resultado destravar
    } else if (act === 'cancel' || act === 'close') {
      document.body.style.overflow = '';
      ov.remove();
      _pessoaAnamneseAlvo = 0;
    }
    // backdrop click: nada
  });
  document.body.appendChild(ov);
}

async function enviarPreMassagemReserva() {
  if (!_resDetAtual) return;
  const estado = _estadoBtnFicha(_resDetAtual);
  if (estado !== 'ok') return;
  const r = _resDetAtual;
  const usarPessoa2 = _pessoaAnamneseAlvo === 2;
  const idiomaReserva = (usarPessoa2 ? r.idioma2 : r.idioma) || 'pt-BR';
  _langSelected = LANGS_PRE.some(l => l.code === idiomaReserva) ? idiomaReserva : 'pt-BR';
  _mostrarConfirmacaoAnamnese(() => _executarEnvioAnamnese());
}

function _iniciarEnvioAnamnesePessoa(pessoa) {
  _pessoaAnamneseAlvo = pessoa === 2 ? 2 : 1;
  enviarPreMassagemReserva();
}

// Abre o modal completo de anamnese preenchida — delega para
// _abrirModalAnamnesePreenchida(perfilId) reusado da tela Clientes 360.
// Esse modal renderiza TODOS os campos da anamnese + perguntas extras
// dinamicas + assinatura, com tradução de rotulos e agrupamento por seção.
// Guard contra clique duplo: in-flight flag evita 2 overlays sobrepostos.
let _anamReadonlyAbrindo = false;
async function abrirAnamneseReadonly(reservaId, pessoa) {
  if (!reservaId) return;
  if (_anamReadonlyAbrindo) return; // ja existe uma abertura em curso
  // Detecta tambem overlay ja aberto no DOM (titulo "Anamnese preenchida")
  const jaAberto = Array.from(document.querySelectorAll('h2'))
    .some(h => h.textContent.trim() === 'Anamnese preenchida');
  if (jaAberto) return;
  _anamReadonlyAbrindo = true;
  const p = pessoa === 2 ? 2 : 1;
  try {
    const res = await api(`/api/reservas/${reservaId}/detalhe`);
    if (!res) return;
    const d = await res.json();
    if (!d.ok) { showToast('Não foi possível carregar a anamnese.'); return; }
    const pdata = p === 2 ? d.pessoa2 : d.pessoa1;
    if (!pdata || !pdata.anamnese) { showToast('Anamnese ainda não foi preenchida.'); return; }
    const perfilId = pdata.anamnese.id;
    if (!perfilId) { showToast('Anamnese sem id de perfil.'); return; }
    await _abrirModalAnamnesePreenchida(perfilId);
  } catch (e) {
    console.error('[abrirAnamneseReadonly]', e);
    showToast('Erro ao carregar anamnese.');
  } finally {
    _anamReadonlyAbrindo = false;
  }
}

// Popup distribuidor para reserva CASAL. Mostra estado de cada hospede
// (preenchida / aguardando / nao enviada / expirada) e oferece a acao
// contextual em cada linha.
function abrirAnamneseCasalPopup() {
  const r = _resDetAtual;
  if (!r) return;
  const ov = document.createElement('div');
  ov.className = 'res-modal-overlay';
  ov.style.display = 'flex';
  ov.style.zIndex = '4500';
  const linha = (pessoa) => {
    const nome = pessoa === 2 ? r.cliente2 : r.cliente;
    // _estadoFinalBtnFicha combina anamnese + janela de tempo (10min apos
    // hora_inicio). Casal compartilha a janela porque tem uma sessao so'.
    const estado = _estadoFinalBtnFicha(r, pessoa);
    let chipCls = 'none', chipTxt = 'Não enviada';
    if (estado === 'respondida') { chipCls = 'ok';   chipTxt = 'Anamnese respondida'; }
    else if (estado === 'enviada')  { chipCls = 'pend'; chipTxt = 'Link gerado'; }
    else if (estado === 'expirada') { chipCls = 'exp';  chipTxt = 'Token expirado'; }
    else if (estado === 'fora_prazo') { chipCls = 'exp'; chipTxt = 'Tempo expirado'; }
    let btn;
    if (estado === 'respondida') {
      btn = `<button class="btn btn-outline btn-sm" data-anam-cas-ver="${pessoa}">Ver anamnese</button>`;
    } else if (estado === 'enviada') {
      // Reenvio habilitado enquanto a janela de envio estiver aberta.
      btn = _estadoBtnFicha(r) === 'ok'
        ? `<button class="btn btn-forest btn-sm" data-anam-cas-enviar="${pessoa}">Reenviar link</button>`
        : `<button class="btn btn-outline btn-sm" disabled>Link gerado</button>`;
    } else if (estado === 'fora_prazo') {
      btn = `<button class="btn btn-outline btn-sm" disabled>Tempo para enviar anamnese expirado</button>`;
    } else {
      btn = `<button class="btn btn-forest btn-sm" data-anam-cas-enviar="${pessoa}">Enviar anamnese</button>`;
    }
    return `
      <div class="anam-cas-card">
        <div class="anam-cas-hd">
          <div class="anam-cas-nome">Hóspede ${pessoa}: ${escHtml(nome || '—')}</div>
          <span class="anam-cas-chip ${chipCls}">${chipTxt}</span>
        </div>
        <div class="anam-cas-actions">${btn}</div>
      </div>
    `;
  };
  ov.innerHTML = `
    <div class="res-modal" style="max-width:560px">
      <div class="res-modal-hd">
        <div>
          <div class="res-modal-title">Anamnese — Reserva Casal</div>
          <div class="res-modal-sub">Cada hóspede tem sua própria anamnese</div>
        </div>
        <button class="res-modal-x" data-anam-cas-close="1">✕</button>
      </div>
      <div class="res-modal-body">
        ${linha(1)}
        ${linha(2)}
      </div>
      <div class="res-modal-ft" style="justify-content:flex-end">
        <button class="btn btn-outline" data-anam-cas-close="1">Fechar</button>
      </div>
    </div>
  `;
  ov.addEventListener('click', e => {
    const t = e.target;
    if (t.dataset.anamCasClose) { ov.remove(); return; }
    const ver = t.dataset.anamCasVer;
    if (ver) { ov.remove(); abrirAnamneseReadonly(r.id, +ver); return; }
    const env = t.dataset.anamCasEnviar;
    if (env) { ov.remove(); _iniciarEnvioAnamnesePessoa(+env); }
  });
  document.body.appendChild(ov);
}

// ── Event delegation ──
function setupDelegation() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'open-drawer')   { openDrawer(+el.dataset.id); }
    else if (action === 'ver-hist') { showHistoricoMassagista(+el.dataset.id, el.dataset.nome); }
    else if (action === 'set-pin')  { openPinModal(+el.dataset.id, el.dataset.nome); }
    else if (action === 'copiar-link-terapeuta') {
      const url = `${location.origin}/terapeuta?nome=${encodeURIComponent(el.dataset.nome)}`;
      navigator.clipboard.writeText(url).then(() => showToast(`Link copiado: ${el.dataset.nome}`)).catch(() => prompt('Copie o link:', url));
    }
    else if (action === 'edit-mass'){ openEditMassagista(+el.dataset.id, el.dataset.nome); }
    else if (action === 'edit-tipo') {
      const { id, nome, dur, preco, ativo, desc, espacoBeleza, tipo } = el.dataset;
      openEditTipo(+id, nome, dur ? +dur : null, preco ? +preco : null, +ativo, desc, +espacoBeleza, tipo || 'individual');
    }
    else if (action === 'cal-day')     { calSelectDay(el.dataset.ds); }
    else if (action === 'cal-ver')     { calVerDetalhes(+el.dataset.id); }
    else if (action === 'cal-cancelar'){ e.stopPropagation(); calCancelar(+el.dataset.id); }
    else if (action === 'dp-select')   { e.stopPropagation(); dpSelectDate(el.dataset.ds); }
    else if (action === 'dp-prev')     { e.stopPropagation(); _dpMonth--; if (_dpMonth < 0) { _dpMonth=11; _dpYear--; } dpRender(); }
    else if (action === 'dp-next')     { e.stopPropagation(); _dpMonth++; if (_dpMonth > 11) { _dpMonth=0; _dpYear++; } dpRender(); }
    else if (action === 'gc-info')     { e.stopPropagation(); _abrirModalGranClass(); }
    else if (action === 'cal-open')    { if (el.dataset.bloqueada) { showToast('⛔ Sala bloqueada — agendamentos suspensos neste período'); return; } calOpenModal(+el.dataset.sala, el.dataset.ds, el.dataset.hora); }
    else if (action === 'page')        { goPage(+el.dataset.off); }
    else if (action === 'hc-page')     { loadHistoricoClientes(+el.dataset.p); }
    else if (action === 'hc-row-detalhe') { abrirDetalheSessao(+el.dataset.id); }
    else if (action === 'edit-user')         { editarUsuario(+el.dataset.id); }
    else if (action === 'del-user')          { deletarUsuario(+el.dataset.id, el.dataset.nome); }
    else if (action === 'liberar-pesquisa')  { liberarPesquisaReserva(+el.dataset.id); }
    else if (action === 'enviar-pre-massagem'){ enviarPreMassagemReserva(); }
    else if (action === 'abrir-anamnese-casal'){ abrirAnamneseCasalPopup(); }
    else if (action === 'ver-anamnese-pessoa'){ abrirAnamneseReadonly(_resDetAtual?.id, +el.dataset.pessoa || 1); }
    else if (action === 'toggle-more') {
      e.stopPropagation();
      const menu = el.closest('.mgmt-item-more')?.querySelector('.mgmt-more-menu');
      if (!menu) return;
      const wasOpen = menu.classList.contains('open');
      _fecharMoreMenus();
      if (!wasOpen) {
        menu.classList.add('open');
        el.setAttribute('aria-expanded', 'true');
        // Eleva o card enquanto o menu está aberto: o z-index do menu só compete
        // dentro do próprio card; sem isso o card seguinte no DOM cobre o menu.
        el.closest('.mgmt-item')?.classList.add('menu-open');
      }
    }
  });
  // Fecha ao clicar fora. Nao pode reagir ao proprio clique do botao "···":
  // stopPropagation nao impede outro listener no MESMO no (document), entao o
  // menu abria e fechava no mesmo clique.
  document.addEventListener('click', e => {
    if (e.target.closest('[data-action="toggle-more"]')) return;
    _fecharMoreMenus();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') _fecharMoreMenus();
  });
}

function _fecharMoreMenus() {
  document.querySelectorAll('.mgmt-more-menu.open').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.mgmt-item.menu-open').forEach(c => c.classList.remove('menu-open'));
  document.querySelectorAll('[data-action="toggle-more"][aria-expanded="true"]')
    .forEach(b => b.setAttribute('aria-expanded', 'false'));
}

// Estado de massagistas: declarado ANTES do IIFE init() porque
// showApp()->showView('view-massagistas')->renderMassagistas() roda
// sincrono e le _massagistas. Como sessionStorage._vst.view pode
// restaurar a view de massagistas em F5, declarar como let abaixo do
// IIFE colocava a leitura na Temporal Dead Zone -> ReferenceError.
let _massagistas = [];
// Distingue "ainda não tentei carregar" (mostra Carregando…) de
// "carreguei e veio vazio" (mostra Nenhuma…). Evita mensagem enganosa
// no boot/F5 enquanto a API ainda não respondeu.
let _massagistasLoaded = false;
let _editMId = null;
let _editTId = null;
let _feriasList = [];
let _editFeriaId = null;

// ── Init ──
(function init() {
  setupDelegation();
  if (tokenValido()) { showApp(); }
  else { clearToken(); sessionStorage.removeItem('_vst'); showLogin(); }

  const hoje = new Date();
  const d30 = new Date(Date.now() - 30 * 86400000);
  document.getElementById('f-to').value = hoje.toISOString().slice(0,10);
  document.getElementById('f-from').value = d30.toISOString().slice(0,10);
})();

document.getElementById('btn-open-massagistas').addEventListener('click', () => { showView('view-massagistas'); loadMassagistas(); });
document.getElementById('btn-back-historico').addEventListener('click', () => { showView('view-massagistas'); loadMassagistas(); });

document.getElementById('btn-open-tipos').addEventListener('click', () => { showView('view-tipos'); loadTipos(); });
document.getElementById('btn-back-tipos')?.addEventListener('click', () => showView('view-main'));

document.getElementById('btn-open-salas')?.addEventListener('click', () => { showView('view-salas'); loadSalas(); });

// Botão "Início" no header — atalho direto pra view-main, fica visível só em subpáginas
document.getElementById('btn-header-home')?.addEventListener('click', () => { showView('view-reservas'); loadReservas(); });

// "Resetar & Demo" foi removido. Para popular dados de teste, use os
// scripts em /scripts ou as telas de cadastro convencionais.

// ── Massagistas ──

document.getElementById('search-massagistas').addEventListener('input', renderMassagistas);

async function loadMassagistas() {
  let res, d;
  try {
    res = await api('/api/massagistas');
    if (!res) {
      // 401/403 — api() já tratou (logout/toast). Marca como tentado pra
      // sair do "Carregando…" e mostrar empty state coerente.
      _massagistasLoaded = true;
      renderMassagistas();
      return;
    }
    d = await res.json();
  } catch {
    document.getElementById('list-massagistas').innerHTML = '<div class="mgmt-empty">Erro ao carregar profissionais.</div>';
    _massagistasLoaded = true;
    return;
  }
  _massagistas = d.items || [];
  _massagistasLoaded = true;
  renderMassagistas();
}

function renderMassagistas() {
  const el = document.getElementById('list-massagistas');
  const busca = (document.getElementById('search-massagistas').value || '').toLowerCase().trim();

  // Antes da primeira carga concluir, evita exibir "Nenhuma…" (enganoso) —
  // mostra Carregando… e dispara a carga caso ainda não tenha sido feita.
  if (!_massagistasLoaded && _massagistas.length === 0) {
    el.innerHTML = '<div class="mgmt-empty">Carregando…</div>';
    return;
  }

  let filtered = _massagistas.filter(m => m.ativo);
  if (busca) filtered = filtered.filter(m => m.nome.toLowerCase().includes(busca));

  if (!filtered.length) {
    el.innerHTML = `<div class="mgmt-empty">${busca ? 'Nenhum resultado encontrado.' : 'Nenhuma massoterapeuta ativa.'}</div>`;
    return;
  }

  let _ci = 0;
  function renderCardItem(m) {
    const idx = _ci++;
    const tot = m.total_avaliacoes || 0;
    const respondentes = (m.rec_sim || 0) + (m.rec_nao || 0);
    const pctRec = respondentes > 0 ? Math.round((m.rec_sim || 0) / respondentes * 100) : null;
    const ratingCls = pctRec == null ? '' : pctRec >= 75 ? 'mgmt-rating-high' : pctRec >= 50 ? 'mgmt-rating-mid' : 'mgmt-rating-low';
    const ratingBadge = pctRec != null ? `<span class="mgmt-rating-badge ${ratingCls}">${pctRec}<small>%</small></span>` : '';
    const statLine = tot > 0 ? `${tot} ${tot !== 1 ? 'avaliações' : 'avaliação'}` : 'Sem avaliações';
    const badges = [];
    if (m.funcao) badges.push(`<span class="mgmt-badge mgmt-badge-funcao">${escHtml(m.funcao)}</span>`);
    if (m.matricula) badges.push(`<span class="mgmt-badge mgmt-badge-mat">Mat. ${escHtml(m.matricula)}</span>`);
    if (m.vinculo) badges.push(`<span class="mgmt-badge mgmt-badge-vinculo">${escHtml(m.vinculo)}</span>`);
    if (m.bilingue) badges.push(`<span class="mgmt-badge mgmt-badge-bilingue">Bilíngue</span>`);
    const words = m.nome.trim().split(/\s+/);
    const initials = (words[0]?.[0] || '') + (words.length > 1 ? (words[words.length - 1]?.[0] || '') : '');
    return `
      <div class="mgmt-item${m.ativo ? '' : ' mgmt-item-inativo'}" style="animation-delay:${idx * 0.04}s">
        <div class="mgmt-card-head">
          <div class="mgmt-avatar">${escHtml(initials.toUpperCase())}</div>
          <div class="mgmt-card-ident">
            <span class="mgmt-item-nome">${escHtml(m.nome)}</span>
            ${badges.length ? `<div class="mgmt-item-badges">${badges.join('')}</div>` : ''}
          </div>
          ${ratingBadge ? `<div class="mgmt-card-rating">${ratingBadge}</div>` : ''}
        </div>
        ${m.especialidade_original ? `<div class="mgmt-item-esp">${escHtml(m.especialidade_original)}</div>` : ''}
        <div class="mgmt-card-foot">
          <span class="mgmt-item-stat${tot === 0 ? ' sem-aval' : ''}">${statLine}</span>
          <div class="mgmt-card-acts">
            <div class="mgmt-item-more">
              <button class="mgmt-btn-more" data-action="toggle-more" title="Mais ações" aria-haspopup="menu" aria-expanded="false">···</button>
              <div class="mgmt-more-menu">
                <button class="mgmt-more-item" data-action="ver-hist" data-id="${m.id}" data-nome="${escHtml(m.nome)}">Histórico</button>
                <button class="mgmt-more-item" data-action="set-pin" data-id="${m.id}" data-nome="${escHtml(m.nome)}">PIN</button>
                <button class="mgmt-more-item" data-action="copiar-link-terapeuta" data-nome="${escHtml(m.nome)}">Link</button>
              </div>
            </div>
            <button class="btn btn-sm mgmt-btn-edit" data-action="edit-mass" data-id="${m.id}" data-nome="${escHtml(m.nome)}">Editar</button>
          </div>
        </div>
      </div>`;
  }

  const receps = filtered.filter(m => m.funcao && m.funcao.toLowerCase().includes('recep'));
  const massos = filtered.filter(m => !m.funcao || !m.funcao.toLowerCase().includes('recep'));
  const grupos = [];
  if (receps.length) grupos.push({ label: 'Recepcionistas',  profs: receps });
  if (massos.length) grupos.push({ label: 'Massoterapeutas', profs: massos });

  const sepHtml = label => count =>
    `<div class="mgmt-group-sep"><span class="mgmt-group-label">${label}</span><span class="mgmt-group-count">&nbsp;·&nbsp;${count}</span></div>`;

  el.innerHTML = '<div class="mgmt-list">' +
    grupos.map(g => sepHtml(g.label)(g.profs.length) + g.profs.map(renderCardItem).join('')).join('') +
    '</div>';
}


window.openEditMassagista = (id, nome) => {
  _editMId = id;
  document.getElementById('mgmt-m-sub').textContent = nome;
  document.getElementById('mgmt-m-err').textContent = '';
  const m = _massagistas.find(x => x.id === id);
  document.getElementById('mgmt-m-nome-display').textContent    = nome || '—';
  document.getElementById('mgmt-m-cargo-display').textContent   = m?.funcao  || '—';
  document.getElementById('mgmt-m-vinculo-display').textContent = m?.vinculo || '—';
  const biEl = document.getElementById('mgmt-m-bilingue-display');
  if (m?.bilingue) {
    biEl.innerHTML = '<span class="hub-bilingue-badge">🌐 Bilíngue</span>';
  } else {
    biEl.innerHTML = '<span class="hub-bilingue-none">—</span>';
  }
  // Reset e carrega férias
  _editFeriaId = null;
  document.getElementById('mgmt-m-ferias-form').style.display = 'none';
  document.getElementById('mgmt-m-ferias-add-btn').style.display = '';
  document.getElementById('mgmt-m-ferias-form-err').style.display = 'none';
  document.getElementById('mgmt-m-ferias-list').innerHTML = '<div style="font-size:.8rem;color:var(--muted)">Carregando…</div>';
  _loadFerias(id);
  _modalOpen = true;
  document.getElementById('mgmt-m-overlay').style.display = 'flex';
};

function _fmtDataFerias(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

async function _loadFerias(massagistaId) {
  try {
    const res = await api(`/api/massagistas/${massagistaId}/ferias`);
    if (!res) return;
    const d = await res.json();
    _feriasList = d.ok ? (d.ferias || []) : [];
  } catch { _feriasList = []; }
  _renderFeriasList();
}

function _renderFeriasList() {
  const el = document.getElementById('mgmt-m-ferias-list');
  if (!el) return;
  if (_feriasList.length === 0) {
    el.innerHTML = '<div style="font-size:.8rem;color:var(--muted);font-style:italic;padding:.25rem 0 .5rem">Nenhum período programado.</div>';
    return;
  }
  el.innerHTML = _feriasList.map(f => `
    <div style="display:flex;align-items:flex-start;gap:.5rem;padding:.45rem 0;border-bottom:1px solid var(--border-soft)" data-fid="${f.id}">
      <div style="flex:1;min-width:0">
        <div style="font-size:.85rem;font-weight:600;color:var(--text)">${_fmtDataFerias(f.data_inicio)} → ${_fmtDataFerias(f.data_fim)}</div>
        ${f.observacao ? `<div style="font-size:.75rem;color:var(--muted);margin-top:2px">${f.observacao}</div>` : ''}
      </div>
      <button class="btn btn-outline ferias-edit-btn" data-fid="${f.id}" type="button" style="padding:.2rem .6rem;font-size:.72rem;flex-shrink:0">Editar</button>
      <button class="btn ferias-del-btn" data-fid="${f.id}" type="button" style="padding:.2rem .6rem;font-size:.72rem;flex-shrink:0;background:transparent;color:var(--danger);border:1px solid var(--danger)">✕</button>
    </div>
  `).join('');
  el.querySelectorAll('.ferias-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const fid = parseInt(btn.dataset.fid);
      const f = _feriasList.find(x => x.id === fid);
      if (!f) return;
      _editFeriaId = fid;
      document.getElementById('mgmt-m-ferias-inicio').value = f.data_inicio;
      document.getElementById('mgmt-m-ferias-fim').value = f.data_fim;
      document.getElementById('mgmt-m-ferias-obs').value = f.observacao || '';
      document.getElementById('mgmt-m-ferias-form-err').style.display = 'none';
      document.getElementById('mgmt-m-ferias-form').style.display = '';
      document.getElementById('mgmt-m-ferias-add-btn').style.display = 'none';
    });
  });
  el.querySelectorAll('.ferias-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fid = parseInt(btn.dataset.fid);
      if (!await confirmarAcao({ titulo: 'Excluir período de férias?', mensagem: 'Este período será removido permanentemente.', btnConfirmar: 'Excluir', perigoso: true })) return;
      const res = await api(`/api/massagistas/${_editMId}/ferias/${fid}`, { method: 'DELETE' });
      if (!res) return;
      const d = await res.json();
      if (!d.ok) { showToast(d.error || 'Erro ao excluir'); return; }
      try { localStorage.setItem('granspa_ferias_ts', Date.now().toString()); } catch(_) {}
      await _loadFerias(_editMId);
    });
  });
}

document.getElementById('mgmt-m-ferias-add-btn').addEventListener('click', () => {
  _editFeriaId = null;
  document.getElementById('mgmt-m-ferias-inicio').value = '';
  document.getElementById('mgmt-m-ferias-fim').value = '';
  document.getElementById('mgmt-m-ferias-obs').value = '';
  document.getElementById('mgmt-m-ferias-form-err').style.display = 'none';
  document.getElementById('mgmt-m-ferias-form').style.display = '';
  document.getElementById('mgmt-m-ferias-add-btn').style.display = 'none';
});

document.getElementById('mgmt-m-ferias-form-cancel').addEventListener('click', () => {
  document.getElementById('mgmt-m-ferias-form').style.display = 'none';
  document.getElementById('mgmt-m-ferias-add-btn').style.display = '';
  _editFeriaId = null;
});

document.getElementById('mgmt-m-ferias-form-save').addEventListener('click', async () => {
  const inicio = document.getElementById('mgmt-m-ferias-inicio').value;
  const fim = document.getElementById('mgmt-m-ferias-fim').value;
  const obs = document.getElementById('mgmt-m-ferias-obs').value.trim();
  const errEl = document.getElementById('mgmt-m-ferias-form-err');
  errEl.style.display = 'none';
  if (!inicio || !fim) { errEl.textContent = 'Preencha as datas de início e fim.'; errEl.style.display = ''; return; }
  if (inicio > fim) { errEl.textContent = 'Início deve ser anterior ao fim.'; errEl.style.display = ''; return; }
  const btn = document.getElementById('mgmt-m-ferias-form-save');
  btn.disabled = true;
  try {
    const url = _editFeriaId
      ? `/api/massagistas/${_editMId}/ferias/${_editFeriaId}`
      : `/api/massagistas/${_editMId}/ferias`;
    const method = _editFeriaId ? 'PUT' : 'POST';
    const res = await api(url, { method, body: JSON.stringify({ data_inicio: inicio, data_fim: fim, observacao: obs || null }) });
    if (!res) return;
    const d = await res.json();
    if (!d.ok) { errEl.textContent = d.error || 'Erro ao salvar.'; errEl.style.display = ''; return; }
    try { localStorage.setItem('granspa_ferias_ts', Date.now().toString()); } catch(_) {}
    document.getElementById('mgmt-m-ferias-form').style.display = 'none';
    document.getElementById('mgmt-m-ferias-add-btn').style.display = '';
    _editFeriaId = null;
    await _loadFerias(_editMId);
  } finally { btn.disabled = false; }
});

function closeMgmtM() { _modalOpen = false; document.getElementById('mgmt-m-overlay').style.display = 'none'; _editMId = null; }
document.getElementById('mgmt-m-x').addEventListener('click', closeMgmtM);
document.getElementById('mgmt-m-cancelar').addEventListener('click', closeMgmtM);

// ── PIN de acesso mobile ──
let _pinMId = null;
function openPinModal(id, nome) {
  _pinMId = id;
  document.getElementById('mgmt-pin-sub').textContent = nome;
  document.getElementById('mgmt-pin-input').value = '';
  document.getElementById('mgmt-pin-confirm').value = '';
  document.getElementById('mgmt-pin-err').textContent = '';
  _modalOpen = true;
  document.getElementById('mgmt-pin-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('mgmt-pin-input').focus(), 50);
}
function closePinModal() { _modalOpen = false; document.getElementById('mgmt-pin-overlay').style.display = 'none'; _pinMId = null; }
document.getElementById('mgmt-pin-x').addEventListener('click', closePinModal);
document.getElementById('mgmt-pin-cancelar').addEventListener('click', closePinModal);
document.getElementById('mgmt-pin-salvar').addEventListener('click', async () => {
  const err = document.getElementById('mgmt-pin-err');
  err.textContent = '';
  const pin = document.getElementById('mgmt-pin-input').value;
  const confirm = document.getElementById('mgmt-pin-confirm').value;
  if (!pin || pin.length < 4 || pin.length > 12) { err.textContent = 'PIN deve ter 4 a 12 caracteres.'; return; }
  if (pin !== confirm) { err.textContent = 'Os PINs não coincidem.'; return; }
  const btn = document.getElementById('mgmt-pin-salvar');
  btn.disabled = true;
  try {
    const res = await api(`/api/massagistas/${_pinMId}/pin`, { method: 'POST', body: JSON.stringify({ pin }) });
    if (!res) return;
    const d = await res.json();
    if (!d.ok) { err.textContent = d.error || 'Erro ao definir PIN.'; return; }
    closePinModal();
    showToast('PIN definido com sucesso.');
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
  let res, d;
  try {
    res = await api('/api/tipos-massagem');
    if (!res) return;
    d = await res.json();
  } catch {
    document.getElementById('list-tipos').innerHTML = '<div class="mgmt-empty">Erro ao carregar tratamentos.</div>';
    return;
  }
  _tipos = d.items || [];
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

  const fmtPreco = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v));
  el.innerHTML = '<div class="mgmt-list">' + filtered.map(t => {
    const meta = [t.duracao_min ? t.duracao_min + 'min' : null, t.preco ? fmtPreco(t.preco) : null].filter(Boolean).join(' · ');
    return `
    <div class="mgmt-item ${t.ativo ? '' : 'mgmt-item-inativo'}">
      <div style="flex:1;min-width:0">
        <div class="mgmt-item-nome">${escHtml(t.nome)}</div>
        ${t.descricao ? `<div class="mgmt-item-meta" style="margin-top:2px">${escHtml(t.descricao)}</div>` : ''}
      </div>
      ${meta ? `<span class="mgmt-item-meta">${escHtml(meta)}</span>` : ''}
      <button class="btn btn-outline btn-sm" data-action="edit-tipo" data-id="${t.id}" data-nome="${escHtml(t.nome)}" data-dur="${t.duracao_min||''}" data-preco="${t.preco||''}" data-ativo="${t.ativo?1:0}" data-desc="${escHtml(t.descricao||'')}" data-espaco-beleza="${t.espaco_beleza?1:0}" data-tipo="${escHtml(t.tipo||'individual')}">Editar</button>
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
    document.getElementById('inp-t-tipo').value = 'individual';
    document.querySelectorAll('#form-t-tipo-sel .mgmt-tipo-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
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
  const tipo = document.getElementById('inp-t-tipo').value || 'individual';
  const err = document.getElementById('err-tipo');
  err.textContent = '';
  if (!nome) { err.textContent = 'Informe o nome.'; return; }
  const res = await api('/api/tipos-massagem', { method: 'POST', body: JSON.stringify({ nome, duracao_min, preco, descricao, tipo }) });
  if (!res) return;
  const d = await res.json();
  if (!d.ok) { err.textContent = d.error; return; }
  toggleFormTipo(false);
  loadTipos();
});

window.openEditTipo = (id, nome, dur, preco, ativo, desc, espacoBeleza, tipo) => {
  _editTId = id;
  document.getElementById('mgmt-t-sub').textContent = nome;
  document.getElementById('mgmt-t-nome').value = nome;
  document.getElementById('mgmt-t-desc').value = desc || '';
  document.getElementById('mgmt-t-dur').value = dur != null ? dur : '';
  document.getElementById('mgmt-t-preco').value = preco != null ? preco : '';
  const chk = document.getElementById('mgmt-t-ativo');
  chk.checked = !!ativo;
  document.getElementById('mgmt-t-ativo-txt').textContent = ativo ? 'Ativo' : 'Inativo';
  const chkBeleza = document.getElementById('mgmt-t-espaco-beleza');
  chkBeleza.checked = !!espacoBeleza;
  document.getElementById('mgmt-t-espaco-beleza-txt').textContent = espacoBeleza ? 'Sim' : 'Não';
  const tipoVal = tipo || 'individual';
  document.getElementById('mgmt-t-tipo').value = tipoVal;
  document.querySelectorAll('#mgmt-t-tipo-sel .mgmt-tipo-btn').forEach(b => b.classList.toggle('active', b.dataset.tipoTrat === tipoVal));
  document.getElementById('mgmt-t-err').textContent = '';
  _modalOpen = true;
  document.getElementById('mgmt-t-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('mgmt-t-nome').focus(), 50);
};

document.getElementById('mgmt-t-ativo').addEventListener('change', function() {
  document.getElementById('mgmt-t-ativo-txt').textContent = this.checked ? 'Ativo' : 'Inativo';
});
document.getElementById('mgmt-t-espaco-beleza').addEventListener('change', function() {
  document.getElementById('mgmt-t-espaco-beleza-txt').textContent = this.checked ? 'Sim' : 'Não';
});
document.querySelectorAll('#mgmt-t-tipo-sel .mgmt-tipo-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('mgmt-t-tipo').value = btn.dataset.tipoTrat;
    document.querySelectorAll('#mgmt-t-tipo-sel .mgmt-tipo-btn').forEach(b => b.classList.toggle('active', b === btn));
  });
});
document.querySelectorAll('#form-t-tipo-sel .mgmt-tipo-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('inp-t-tipo').value = btn.dataset.tipoTratForm;
    document.querySelectorAll('#form-t-tipo-sel .mgmt-tipo-btn').forEach(b => b.classList.toggle('active', b === btn));
  });
});
function closeMgmtT() { _modalOpen = false; document.getElementById('mgmt-t-overlay').style.display = 'none'; _editTId = null; }
document.getElementById('mgmt-t-x').addEventListener('click', closeMgmtT);
document.getElementById('mgmt-t-cancelar').addEventListener('click', closeMgmtT);
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
    const espaco_beleza = document.getElementById('mgmt-t-espaco-beleza').checked ? 1 : 0;
    const tipo = document.getElementById('mgmt-t-tipo').value || 'individual';
    const res = await api(`/api/tipos-massagem/${_editTId}`, { method: 'PUT', body: JSON.stringify({ nome, descricao, duracao_min, preco: preco_val, ativo, espaco_beleza, tipo }) });
    if (!res) return;
    const d = await res.json();
    if (!d.ok) { err.textContent = d.error || 'Erro ao salvar.'; return; }
    closeMgmtT(); loadTipos(); _tratamentos = [];
  } finally { btn.disabled = false; }
});

// ── Receita & Comissão (histórico) ─────────────────────────────────────
const MESES_NOME = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
const fmtBRL = v => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtBRLshort = v => {
  const n = Number(v) || 0;
  if (n >= 1000) return 'R$ ' + (n / 1000).toFixed(1).replace('.', ',') + 'k';
  return 'R$ ' + n.toFixed(0);
};
const escHtmlSafe = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderReceitaSection(d) {
  const el = document.getElementById('hist-receita');
  if (!el) return;
  const ano = d.ano;
  const total = d.total || { atendimentos: 0, receita: 0, comissao: 0 };
  const ticket = total.atendimentos > 0 ? total.receita / total.atendimentos : 0;

  if (!d.meses || d.meses.length === 0) {
    el.innerHTML = `
      <section class="receita-section">
        <div class="receita-head">
          <span class="num">02</span>
          <h3>Receita & Comissão</h3>
          <span class="ano-pill">${ano}</span>
          <button class="btn btn-outline btn-sm" id="btn-comissao-regras" style="margin-left:auto">⚙ Regras</button>
        </div>
        <div class="receita-empty">Sem atendimentos registrados para esta profissional em ${ano}.</div>
      </section>`;
    el.querySelector('#btn-comissao-regras')?.addEventListener('click', abrirModalRegrasComissao);
    return;
  }

  const cards = `
    <div class="receita-cards">
      <div class="receita-card">
        <div class="receita-card-label">Receita YTD</div>
        <div class="receita-card-val gold">${fmtBRLshort(total.receita)}</div>
        <div class="receita-card-sub">${fmtBRL(total.receita)}</div>
      </div>
      <div class="receita-card">
        <div class="receita-card-label">Atendimentos YTD</div>
        <div class="receita-card-val">${total.atendimentos}</div>
        <div class="receita-card-sub">em ${d.meses.length} ${d.meses.length === 1 ? 'mês' : 'meses'}</div>
      </div>
      <div class="receita-card">
        <div class="receita-card-label">Ticket médio</div>
        <div class="receita-card-val">${fmtBRLshort(ticket)}</div>
        <div class="receita-card-sub">${fmtBRL(ticket)}</div>
      </div>
      <div class="receita-card">
        <div class="receita-card-label">Comissão YTD</div>
        <div class="receita-card-val gold">${fmtBRLshort(total.comissao)}</div>
        <div class="receita-card-sub">${fmtBRL(total.comissao)}</div>
      </div>
    </div>`;

  // Constroi todas as linhas dos 12 meses (preenche vazios para visao completa)
  const mesesIdx = new Map(d.meses.map(m => [m.mes, m]));
  const rows = [];
  for (let mes = 1; mes <= 12; mes++) {
    const m = mesesIdx.get(mes);
    if (!m) {
      rows.push(`<tr class="empty-month">
        <td class="mes">${MESES_NOME[mes - 1]}</td>
        <td class="num">—</td><td class="num">—</td><td>—</td><td>—</td><td class="num">—</td><td></td>
      </tr>`);
      continue;
    }
    const NOTA_MAX_LOCAL = 9;
    const notaCell = m.nota_media != null
      ? `<span class="receita-nota">${Math.round((m.nota_media / NOTA_MAX_LOCAL) * 100)}%</span>`
      : `<span class="receita-nota dim">s/ nota</span>`;
    const bonusCell = m.bonus_pct > 0
      ? `<span class="receita-bonus" title="${escHtmlSafe(m.bonus_label || '')}">+${(m.bonus_pct * 100).toFixed(0)}%</span>`
      : `<span style="color:var(--muted)">—</span>`;

    const detalhe = (m.por_terapia || []).map(t => {
      const semPreco = t.atendimentos > 0 && (!t.receita || t.receita === 0);
      const warn = semPreco ? ' <span title="Preço não cadastrado neste tipo de massagem — auditar tipos_massagem.preco" style="color:var(--warn,#C49A2D);cursor:help">⚠️</span>' : '';
      return `<tr><td>${escHtmlSafe(t.terapia)}</td><td class="num">${t.atendimentos}</td><td class="num">${fmtBRL(t.receita)}${warn}</td></tr>`;
    }).join('');

    // Mês com atendimento mas receita zero → preço faltando em algum tipo de massagem.
    const mesSemPreco = m.atendimentos > 0 && (!m.receita || m.receita === 0);
    const receitaCell = mesSemPreco
      ? `${fmtBRL(m.receita)} <span title="Há atendimento(s) sem preço cadastrado no tipo de massagem" style="color:var(--warn,#C49A2D);cursor:help">⚠️</span>`
      : fmtBRL(m.receita);

    rows.push(`
      <tr data-mes="${mes}" class="mes-row">
        <td class="mes">${MESES_NOME[mes - 1]}</td>
        <td class="num">${m.atendimentos}</td>
        <td class="num">${receitaCell}</td>
        <td>${notaCell}</td>
        <td>${bonusCell}</td>
        <td class="num comissao">${fmtBRL(m.comissao)}</td>
        <td class="num"><span class="receita-expand-icon">›</span></td>
      </tr>
      <tr class="receita-detail-row" data-detail="${mes}" style="display:none">
        <td colspan="7" style="padding:0">
          <div class="receita-detail">
            <div class="receita-detail-head">Detalhe por terapia · ${MESES_NOME[mes - 1]}/${ano}</div>
            <table>
              <tbody>
                ${detalhe || (m.atendimentos > 0
                  ? `<tr><td colspan="3" style="text-align:center;color:var(--warn,#C49A2D)"><span style="cursor:help" title="A reserva foi cadastrada sem tipo de massagem — agregação não consegue agrupar por terapia">⚠️</span> ${m.atendimentos} atendimento(s) sem tipo de massagem cadastrado na reserva</td></tr>`
                  : '<tr><td colspan="3" style="text-align:center;color:var(--muted)">Sem terapias registradas</td></tr>')}
              </tbody>
            </table>
          </div>
        </td>
      </tr>`);
  }

  const tabela = `
    <div class="receita-table-wrap">
      <table class="receita-table">
        <thead>
          <tr>
            <th>Mês</th>
            <th class="num">Atend.</th>
            <th class="num">Receita</th>
            <th>Nota</th>
            <th>Bônus</th>
            <th class="num">Comissão</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;

  const regras = d.regras || {};
  const tiers = (regras.tiers || []).map(t => `<span class="pill">${escHtmlSafe(t.label)}</span>`).join('');
  const foot = `
    <div class="receita-foot">
      <span class="pill">Base <strong>${((regras.base_rate || 0) * 100).toFixed(0)}%</strong> sobre receita</span>
      ${tiers}
      <span style="margin-left:auto;color:var(--muted);font-style:italic">Fonte: reservas do sistema (data ≤ hoje)</span>
    </div>`;

  el.innerHTML = `
    <section class="receita-section">
      <div class="receita-head">
        <span class="num">02</span>
        <h3>Receita & Comissão</h3>
        <span class="ano-pill">${ano}</span>
        <button class="btn btn-outline btn-sm" id="btn-comissao-regras" style="margin-left:auto">⚙ Regras</button>
      </div>
      ${cards}
      ${tabela}
      ${foot}
    </section>`;

  el.querySelector('#btn-comissao-regras')?.addEventListener('click', abrirModalRegrasComissao);

  // Expand/collapse linhas
  el.querySelectorAll('tr.mes-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const mes = tr.dataset.mes;
      const det = el.querySelector(`tr.receita-detail-row[data-detail="${mes}"]`);
      if (!det) return;
      const opened = det.style.display !== 'none';
      det.style.display = opened ? 'none' : '';
      tr.classList.toggle('expanded', !opened);
    });
  });
}

// ── Modal: editar Regras de Comissão (% base + tiers) ──
async function abrirModalRegrasComissao() {
  let cfg;
  try {
    const r = await api('/api/comissao/regras');
    if (!r) return;
    cfg = await r.json();
    if (!cfg.ok) throw new Error(cfg.error || 'erro');
  } catch (e) {
    alert('Não foi possível carregar as regras: ' + (e?.message || e));
    return;
  }
  let tiers = Array.isArray(cfg.tiers) ? [...cfg.tiers] : [];
  let baseRate = Number(cfg.base_rate) || 0;

  const ov = document.createElement('div');
  ov.className = 'res-modal-overlay show';
  ov.innerHTML = `
    <div class="res-modal" style="max-width:560px">
      <div class="res-modal-hd">
        <div class="res-modal-title">⚙ Regras de Comissão</div>
        <button class="res-modal-x" type="button" data-close>✕</button>
      </div>
      <div class="res-modal-body">
        <div class="res-fg" style="margin-bottom:1rem">
          <label>Comissão base sobre receita (%)</label>
          <input type="number" id="cfg-base" min="0" max="100" step="0.5" value="${(baseRate*100).toFixed(2)}" style="width:140px">
          <small style="color:var(--muted);display:block;margin-top:.25rem">Aplicada sobre a receita mensal antes do bônus.</small>
        </div>
        <div style="margin-bottom:.5rem;font-weight:600;color:var(--gold)">Tiers de bônus por nota</div>
        <small style="color:var(--muted);display:block;margin-bottom:.5rem">Nota em escala 0-9. Maior bônus que satisfaz nota_média ≥ min_nota é aplicado.</small>
        <div id="cfg-tiers"></div>
        <button class="btn btn-outline btn-sm" id="cfg-add-tier" type="button" style="margin-top:.5rem">+ Novo tier</button>
        <div class="res-modal-err" id="cfg-err" style="margin-top:.75rem"></div>
      </div>
      <div class="res-modal-ft">
        <button class="btn btn-outline" type="button" data-close>Cancelar</button>
        <button class="btn btn-gold" id="cfg-save" type="button">Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  function renderTiers() {
    const wrap = ov.querySelector('#cfg-tiers');
    wrap.innerHTML = tiers.map((t, i) => `
      <div class="cfg-tier-row" data-i="${i}" style="display:flex;gap:.5rem;align-items:center;margin-bottom:.5rem;padding:.5rem;background:var(--surface2);border-radius:6px">
        <div style="flex:0 0 auto"><small style="color:var(--muted)">min_nota</small><br>
          <input type="number" class="cfg-min" min="0" max="9" step="0.1" value="${t.min_nota}" style="width:80px"></div>
        <div style="flex:0 0 auto"><small style="color:var(--muted)">bônus %</small><br>
          <input type="number" class="cfg-bonus" min="0" max="100" step="0.5" value="${(t.bonus*100).toFixed(2)}" style="width:80px"></div>
        <div style="flex:1"><small style="color:var(--muted)">rótulo</small><br>
          <input type="text" class="cfg-label" value="${escHtmlSafe(t.label||'')}" style="width:100%" maxlength="80"></div>
        <button class="btn btn-outline btn-sm cfg-del" type="button" title="Remover" style="flex:0 0 auto;align-self:flex-end">×</button>
      </div>`).join('') || '<div style="color:var(--muted);font-style:italic;padding:.5rem">Nenhum tier — comissão será só a % base.</div>';
    wrap.querySelectorAll('.cfg-del').forEach(b => b.addEventListener('click', () => {
      const i = +b.closest('.cfg-tier-row').dataset.i;
      tiers.splice(i, 1); renderTiers();
    }));
  }
  renderTiers();

  ov.querySelector('#cfg-add-tier').addEventListener('click', () => {
    tiers.push({ min_nota: 7.0, bonus: 0.01, label: 'Novo tier' });
    renderTiers();
  });
  ov.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => ov.remove()));
  ov.querySelector('#cfg-save').addEventListener('click', async () => {
    const err = ov.querySelector('#cfg-err');
    err.textContent = '';
    const base = Number(ov.querySelector('#cfg-base').value) / 100;
    const rowEls = ov.querySelectorAll('.cfg-tier-row');
    const payloadTiers = [...rowEls].map(row => ({
      min_nota: Number(row.querySelector('.cfg-min').value),
      bonus:    Number(row.querySelector('.cfg-bonus').value) / 100,
      label:    row.querySelector('.cfg-label').value.trim(),
    }));
    try {
      const r = await api('/api/comissao/regras', {
        method: 'PUT', body: JSON.stringify({ base_rate: base, tiers: payloadTiers })
      });
      if (!r) return;
      const d = await r.json();
      if (!d.ok) { err.textContent = d.error || 'Erro ao salvar.'; return; }
      ov.remove();
      // Recarrega receita pra refletir as novas regras
      const st = JSON.parse(sessionStorage.getItem('_vst') || '{}');
      if (st.histId) carregarReceitaMassagista(st.histId);
    } catch (e) {
      err.textContent = 'Erro de rede: ' + (e?.message || e);
    }
  });
}

async function carregarReceitaMassagista(id) {
  const ano = new Date().getFullYear();
  try {
    const res = await api(`/api/massagistas/${id}/receita?ano=${ano}`);
    if (!res) return;
    const d = await res.json();
    if (!d.ok) {
      document.getElementById('hist-receita').innerHTML = '';
      return;
    }
    renderReceitaSection(d);
  } catch (e) {
    document.getElementById('hist-receita').innerHTML = '';
  }
}

// ── Histórico de Massagista ──
// Function declaration (hoisted) — init() em :1106 chama esta função via
// showApp()->restauração de _vst.view='view-historico' ANTES desta linha ser
// alcançada na avaliação top-to-bottom. Function expression atribuída a window
// causava ReferenceError no F5 com histId valido (auditoria 2026-06-25).
async function showHistoricoMassagista(id, nome) {
  showView('view-historico');
  const st = JSON.parse(sessionStorage.getItem('_vst') || '{}');
  sessionStorage.setItem('_vst', JSON.stringify({ ...st, view: 'view-historico', histId: id, histNome: nome }));
  document.getElementById('hist-title').textContent = nome;
  document.getElementById('hist-kpi-row').innerHTML = '<div class="hist-kpi"><div class="hist-kpi-label">Carregando…</div></div>';
  document.getElementById('hist-list').innerHTML = '';
  const recEl = document.getElementById('hist-receita');
  if (recEl) recEl.innerHTML = '';
  // Carrega receita & comissao em paralelo (nao bloqueia render do historico).
  carregarReceitaMassagista(id);

  let res, d;
  try {
    res = await api(`/api/massagistas/${id}/historico`);
    if (!res) {
      document.getElementById('hist-kpi-row').innerHTML = '<div class="hist-kpi"><div class="hist-kpi-label" style="color:var(--danger)">Sessão expirada. Faça login novamente.</div></div>';
      return;
    }
    d = await res.json();
  } catch (e) {
    document.getElementById('hist-kpi-row').innerHTML = `<div class="hist-kpi"><div class="hist-kpi-label" style="color:var(--danger)">Erro de conexão: ${e.message}</div></div>`;
    return;
  }
  if (!d.ok) {
    document.getElementById('hist-kpi-row').innerHTML = `<div class="hist-kpi"><div class="hist-kpi-label" style="color:var(--danger)">${d.error || 'Erro ao carregar histórico'}</div></div>`;
    return;
  }

  const items = d.items || [];
  const total = items.length;
  // Usa massagista do payload da API direto — _massagistas (cache da lista) pode
  // estar vazio quando o F5/restore cai direto em view-historico antes de
  // loadMassagistas rodar. PII whitelist preserva o campo bilingue.
  const ehBilingue = !!(d?.massagista?.bilingue);
  const avgs = items.map(r => avgRowMass(r, ehBilingue)).filter(v => v !== null).map(Number);
  const mediaGeral = avgs.length ? (avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(2) : null;
  const recSim = items.filter(r => r.recomenda === 'sim').length;
  const recNao = items.filter(r => r.recomenda === 'nao').length;
  const respondentes = recSim + recNao;
  const pctRec = respondentes > 0 ? (recSim / respondentes * 100).toFixed(0) : null;
  const naoPortugues = items.filter(r => !ehIdiomaPortugues(r.idioma_detectado)).length;

  document.getElementById('hist-kpi-row').innerHTML = `
    <div class="hist-kpi">
      <div class="hist-kpi-label">Total de pesquisas</div>
      <div class="hist-kpi-val">${total}</div>
    </div>
    <div class="hist-kpi">
      <div class="hist-kpi-label">Média da profissional</div>
      <div class="hist-kpi-val" style="color:var(--gold)">${_mediaPct(mediaGeral)}</div>
    </div>
    <div class="hist-kpi">
      <div class="hist-kpi-label">Recomendariam</div>
      <div class="hist-kpi-val">${pctRec != null ? pctRec + '%' : '—'}</div>
    </div>
    ${naoPortugues > 0 && !ehBilingue ? `<div class="hist-kpi" title="Explicação desconsiderada para hóspedes não falantes de português">
      <div class="hist-kpi-label">Hóspedes outro idioma</div>
      <div class="hist-kpi-val" style="color:var(--warn,#C49A2D)">${naoPortugues} <span style="font-size:.7rem;font-weight:400">(expl. excluída)</span></div>
    </div>` : ''}
    ${ehBilingue ? `<div class="hist-kpi"><div class="hist-kpi-label">Bilíngue</div><div class="hist-kpi-val" style="color:var(--success)">✓</div></div>` : ''}`;

  if (!total) {
    document.getElementById('hist-list').innerHTML = '<div class="table-wrap"><div class="empty">Nenhuma pesquisa vinculada a esta profissional.</div></div>';
    return;
  }

  function computeDist(campo, lista) {
    const dist = { otimo: 0, bom: 0, regular: 0, ruim: 0, total: 0 };
    for (const r of (lista || items)) {
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
  // Instalações foi removida desta tela: não conta como avaliação da
  // massoterapeuta (avgRowMass já era exclusivo de serviços). Bloco 02 antigo
  // (Instalações) e subseção "Sobre instalações" do bloco de Comentários
  // foram retirados. Drawer da pesquisa e tela de Qualidade continuam
  // exibindo instalações — escopo só do histórico por profissional.

  // Regra de exclusão: quando a profissional NÃO é bilíngue, hóspedes em idioma
  // não-PT NÃO conseguem entender a "explicação dos benefícios" — esse quesito
  // é descontado da média e da distribuição. Os outros quesitos seguem com todos.
  const servicosHtml = HIST_SERVICOS.map(({ campo, label }) => {
    const filtrados = (!ehBilingue && campo === 'servicos_explicacao')
      ? items.filter(r => ehIdiomaPortugues(r.idioma_detectado))
      : items;
    return `<div class="q-row"><div class="q-label-row"><div class="q-label">${label}</div>${renderMediaBadge(avgCampo(filtrados, campo))}</div>${renderDistBar(computeDist(campo, filtrados))}</div>`;
  }).join('');

  const comentariosServicos = items
    .filter(r => r.servicos_comentario)
    .map(r => ({ texto: r.servicos_comentario, nome: r.nome, data: r.submitted_at }));
  const temComentarios = comentariosServicos.length > 0;

  document.getElementById('hist-list').innerHTML = `
    <div class="hist-analysis-grid">
      <div class="analysis-block full">
        <div class="block-head">
          <span class="block-num">01</span>
          <h3 class="block-title">Serviços</h3>
        </div>
        ${servicosHtml}
      </div>
      ${temComentarios ? `
      <div class="analysis-block full">
        <div class="block-head">
          <span class="block-num">02</span>
          <h3 class="block-title">Comentários</h3>
        </div>
        ${renderTextoGroup('Sobre serviços', comentariosServicos)}
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
            <th>Data</th><th>Cliente</th><th>Idioma</th><th>Tratamento</th>
            <th>Expectativa</th><th>Atitude</th><th>Técnica</th>
            <th>Média</th><th>Recomenda</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${items.map(r => {
            const avg = avgRowMass(r, ehBilingue);
            const idiomaBadge = r.idioma_detectado && !ehIdiomaPortugues(r.idioma_detectado)
              ? `<span class="badge" style="background:var(--warn-dim,#FEF3CD);color:var(--warn,#C49A2D);font-size:.68rem" title="${ehBilingue ? 'Profissional bilíngue — explicação INCLUÍDA na média' : 'Explicação excluída da média'}">${r.idioma_detectado.toUpperCase()}</span>`
              : (r.idioma_detectado ? `<span style="color:var(--muted);font-size:.75rem">pt</span>` : '—');
            const recBadge = r.recomenda === 'sim'
              ? '<span class="badge badge-hospede">Sim</span>'
              : r.recomenda === 'nao'
                ? '<span class="badge" style="background:var(--danger-dim);color:var(--danger)">Não</span>'
                : '—';
            return `<tr>
              <td>${fmtDate(r.submitted_at)}</td>
              <td style="font-weight:500">${escHtml(r.nome)}</td>
              <td>${idiomaBadge}</td>
              <td style="color:var(--muted)">${escHtml(r.tratamento_realizado || '—')}</td>
              <td>${notaPill(r.servicos_expectativa)}</td>
              <td>${notaPill(r.servicos_atitude)}</td>
              <td>${notaPill(r.servicos_tecnica)}</td>
              <td class="${scoreClass(avg)}">${_mediaPct(avg)}</td>
              <td>${recBadge}</td>
              <td><button class="btn btn-outline btn-sm" data-action="open-drawer" data-id="${r.id}">Ver</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── Reservas de Salas ────────────────────────────────────────

const CAL_ROOMS = [
  { id: 1, nome: 'Sala 1', tipo: 'Individual', cap: 1, cls: 's1' },
  { id: 2, nome: 'Sala 2', tipo: 'Individual', cap: 1, cls: 's2' },
  { id: 3, nome: 'Sala 3', tipo: 'Dupla', cap: 2, cls: 's3' },
  { id: 4, nome: 'Sala 4', tipo: 'Dupla', cap: 2, cls: 's4' },
  { id: 5, nome: 'Espaço Beleza', tipo: 'Eventos', cap: 1, cls: 's5' },
];
const CAL_H_START = 9;
const CAL_H_END   = 22;
// Lê altura do slot da CSS var --cal-slot-h (definida em :root) — mantem
// JS e CSS sincronizados. Fallback 52 se var nao disponivel.
const CAL_SLOT_PX = (() => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--cal-slot-h').trim();
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 52;
  } catch { return 52; }
})();
const MESES_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

let _reservas  = [];
let _resSala       = null;
let _resTipo       = null;
let _resHoraInicio = null;
let _resHoraFim    = null;
let _resEditandoId  = null; // id da reserva sendo editada; null = nova reserva
let _resOverrideRegra = false; // "Agendar mesmo assim" (escala/recepção) — consumida a cada envio
let _resEditandoObj = null; // objeto r completo salvo por calAbrirEdicao para voltar ao detalhe
let _resMassExtras = []; // combo: massoterapeutas EXTRAS (ids) além da principal (res-inp-massagista)
let _tratamentos = []; // [{nome, duracao_min, ...}]
let _massagistasModal = []; // cache p/ modal de reserva — [{id, nome, bilingue, vinculo, ...}]

// ── Combobox filtável ──
let _cbTrat = null, _cbMass = null;
function _cbInit({ textId, listId, clrId, hiddenId }) {
  const inp = document.getElementById(textId);
  const list = document.getElementById(listId);
  const clr = document.getElementById(clrId);
  const hid = document.getElementById(hiddenId);

  function doFilter() {
    // Texto sincronizado programaticamente (combo: "Ana + Bia") não filtra a
    // lista — senão focar o campo esconderia todas as opções.
    const q = inp.dataset.synced === '1' ? '' : inp.value.trim().toLowerCase();
    list.querySelectorAll('.res-cb-opt').forEach(o => {
      o.style.display = (!q || o.textContent.toLowerCase().includes(q)) ? '' : 'none';
    });
    list.querySelectorAll('.res-cb-grp').forEach(g => {
      let s = g.nextElementSibling, any = false;
      while (s && !s.classList.contains('res-cb-grp')) {
        if (s.style.display !== 'none') { any = true; break; }
        s = s.nextElementSibling;
      }
      g.style.display = any ? '' : 'none';
    });
  }
  function clear() {
    hid.value = ''; inp.value = ''; clr.style.display = 'none';
    doFilter();
    hid.dispatchEvent(new Event('change', { bubbles: true }));
  }
  inp.addEventListener('focus', () => { list.style.display = 'block'; doFilter(); });
  inp.addEventListener('input', () => {
    delete inp.dataset.synced; // usuário digitou: volta a filtrar normalmente
    hid.value = ''; clr.style.display = inp.value ? '' : 'none';
    list.style.display = 'block'; doFilter();
    hid.dispatchEvent(new Event('change', { bubbles: true }));
  });
  inp.addEventListener('blur', () => { setTimeout(() => { list.style.display = 'none'; }, 160); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') { list.style.display = 'none'; inp.blur(); }
    if (e.key === 'Enter') {
      const first = list.querySelector('.res-cb-opt:not(.cb-empty)');
      if (first) { first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }
    }
  });
  clr.addEventListener('mousedown', e => e.preventDefault());
  clr.addEventListener('click', clear);
  list.addEventListener('mousedown', e => {
    e.preventDefault();
    const opt = e.target.closest('.res-cb-opt:not(.cb-empty)');
    if (!opt) return;
    // Combo multi-massoterapeuta: opção com data-multi alterna seleção e
    // mantém a lista aberta para marcar mais de uma.
    if (opt.dataset.multi === '1') {
      _massMultiToggle(+opt.dataset.val);
      return;
    }
    hid.value = opt.dataset.val;
    inp.value = opt.dataset.label;
    clr.style.display = '';
    list.style.display = 'none';
    hid.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return { clear, doFilter };
}
_cbTrat = _cbInit({ textId:'res-cb-trat-inp',  listId:'res-cb-trat-list',  clrId:'res-cb-trat-clr',  hiddenId:'res-inp-tratamento' });
_cbMass = _cbInit({ textId:'res-cb-mass-inp',  listId:'res-cb-mass-list',  clrId:'res-cb-mass-clr',  hiddenId:'res-inp-massagista' });
let _cbTrat2 = _cbInit({ textId:'res-cb-trat2-inp', listId:'res-cb-trat2-list', clrId:'res-cb-trat2-clr', hiddenId:'res-inp-tratamento2' });
let _cbMass2 = _cbInit({ textId:'res-cb-mass2-inp', listId:'res-cb-mass2-list', clrId:'res-cb-mass2-clr', hiddenId:'res-inp-massagista2' });

let _resTipo2 = null;
function calSetTipo2(tipo) {
  _resTipo2 = tipo;
  document.querySelectorAll('[data-tipo2]').forEach(b => b.classList.toggle('active', b.dataset.tipo2 === tipo));
  const isHospede = tipo === 'hospede';
  const quarto2El = document.getElementById('res2-fg-quarto');
  if (quarto2El) {
    quarto2El.style.display = isHospede ? '' : 'none';
    const nome2Fg = quarto2El.parentElement?.querySelector('.res-fg:first-child');
    if (nome2Fg) nome2Fg.style.gridColumn = isHospede ? '' : '1 / -1';
    if (!isHospede) document.getElementById('res2-inp-quarto').value = '';
  }
}
document.querySelectorAll('[data-tipo2]').forEach(btn => btn.addEventListener('click', () => calSetTipo2(btn.dataset.tipo2)));

function _isCasal() { return (_resSala === 3 || _resSala === 4) && !!document.getElementById('res-chk-casal')?.checked; }
// Detecta se uma reserva existente eh CASAL (Sala 3+4 unidas). Prefere o
// campo explicito r.casal quando o backend passar a expor; fallback para
// inferencia por presenca de cliente2 (estado atual do schema).
function isReservaCasal(r) {
  if (!r) return false;
  if (r.casal === true || r.casal === 1) return true;
  return !!(r.cliente2 && String(r.cliente2).trim());
}
function _isEspBeleza() { return _resSala === 5; }
function _aplicarVisibilidadeSala() {
  const espBeleza = _isEspBeleza();
  const fgTrat = document.getElementById('res-fg-tratamento');
  const fgMass = document.getElementById('res-fg-massagista');
  const fgHfManual = document.getElementById('res-fg-hora-fim-manual');
  if (fgTrat) fgTrat.style.display = espBeleza ? 'none' : '';
  if (fgMass) fgMass.style.display = espBeleza ? 'none' : '';
  if (fgHfManual) fgHfManual.style.display = espBeleza ? '' : 'none';
  if (espBeleza) {
    if (_cbTrat) _cbTrat.clear();
    const massInp = document.getElementById('res-inp-massagista');
    if (massInp) massInp.value = '';
    if (_cbMass) _cbMass.clear();
    document.getElementById('res-extra-info').innerHTML = '';
  } else {
    const hfm = document.getElementById('res-inp-hora-fim-manual');
    if (hfm) hfm.value = '';
  }
}

function _syncTratListToSecond() {
  const src = document.getElementById('res-cb-trat-list');
  const dst = document.getElementById('res-cb-trat2-list');
  if (src && dst) dst.innerHTML = src.innerHTML;
}

function _renderMassagistasModal2() {
  const list = document.getElementById('res-cb-mass2-list');
  const hid  = document.getElementById('res-inp-massagista2');
  const inp  = document.getElementById('res-cb-mass2-inp');
  const clr  = document.getElementById('res-cb-mass2-clr');
  if (!list) return;
  const data = document.getElementById('res-inp-data')?.value || null;
  const horaInicio = document.getElementById('res-inp-hora-inicio')?.value || null;
  const prevId = hid?.value;
  const mass1Id = document.getElementById('res-inp-massagista')?.value;
  if (data) _fetchEscalaAval(data, horaInicio, _resHoraFim);
  let lista = _massagistasModal.filter(m => !m.funcao?.toLowerCase().includes('recep'));
  lista = lista.filter(m => _escalaFiltra(m, data, horaInicio, _resHoraFim));
  // Exclui a massagista já selecionada para pessoa 1 e as extras do combo
  if (mass1Id) lista = lista.filter(m => String(m.id) !== String(mass1Id));
  if (_resMassExtras.length) lista = lista.filter(m => !_resMassExtras.includes(m.id));
  const aviso2 = _escalaAvisoHtml(data, horaInicio, _resHoraFim);
  // Regra da recepção no casal: nenhuma massoterapeuta é escondida — o backend
  // recusa ao salvar (409 + "Agendar mesmo assim") se a recepção ficar
  // descoberta. Com recepcionista em turno, tudo liberado.
  if (!lista.length) {
    list.innerHTML = aviso2 + '<div class="res-cb-opt cb-empty">Nenhuma massoterapeuta disponível</div>';
    return;
  }
  list.innerHTML = aviso2 + lista.map(m => {
    const suffix = m.vinculo ? ` · ${m.vinculo}` : '';
    return `<div class="res-cb-opt" data-val="${m.id}" data-label="${escHtml(m.nome)}">${escHtml(m.nome)}${suffix}${m.bilingue ? ' 🌍' : ''}</div>`;
  }).join('');
  if (prevId && !lista.find(m => String(m.id) === String(prevId))) {
    if (hid) hid.value = '';
    if (inp) inp.value = '';
    if (clr) clr.style.display = 'none';
  }
  // Auto-seleciona quando só uma disponível e nada selecionado
  if (lista.length === 1 && !hid?.value) {
    const m = lista[0];
    const suffix = m.vinculo ? ` · ${m.vinculo}` : '';
    if (hid) hid.value = m.id;
    if (inp) inp.value = m.nome + suffix;
    if (clr) clr.style.display = '';
    hid?.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

async function loadMassagistasModal() {
  if (_massagistasModal.length) return;
  let r, d;
  try {
    r = await api('/api/massagistas-ativas');
    if (!r) return;
    d = await r.json();
  } catch {
    const list = document.getElementById('res-cb-mass-list');
    if (list) list.innerHTML = '<div class="res-cb-opt cb-empty">Erro ao carregar profissionais</div>';
    return;
  }
  _massagistasModal = d.items || [];
  _renderMassagistasModal();
}

// ── Disponibilidade por escala MENSAL (fonte da verdade do dia real) ─────────
// Consulta /api/escala-spa/disponibilidade e cacheia por (data, horas). Enquanto
// a resposta não chega (ou se falhar), todas aparecem (fail-open) — a operação
// nunca fica travada e o backend revalida no POST.
let _escalaAvalKey = null;
let _escalaAvalMap = null;
let _escalaAvalLancada = null;
let _escalaAvalLivres = null; // contagem de livres do intervalo (escala ∧ sem conflito) — regra da recepção
let _escalaAvalRecepCoberta = null; // true = recepcionista em escala cobre a recepção → regra desligada

function _escalaAvalKeyFor(data, horaInicio, horaFim) {
  // Inclui a reserva em edição: na edição a própria reserva não conta
  // contra a terapeuta (excluir=id no backend).
  return `${data}|${horaInicio || ''}|${horaFim || ''}|${_resEditandoId || ''}`;
}

async function _fetchEscalaAval(data, horaInicio, horaFim) {
  const key = _escalaAvalKeyFor(data, horaInicio, horaFim);
  if (key === _escalaAvalKey) return;
  _escalaAvalKey = key;
  _escalaAvalMap = null;
  _escalaAvalLancada = null;
  _escalaAvalLivres = null;
  _escalaAvalRecepCoberta = null;
  try {
    const qs = new URLSearchParams({ data });
    if (horaInicio) qs.set('hora_inicio', horaInicio);
    if (horaFim) qs.set('hora_fim', horaFim);
    if (_resEditandoId) qs.set('excluir', _resEditandoId);
    const r = await api(`/api/escala-spa/disponibilidade?${qs.toString()}`);
    if (!r) return;
    const d = await r.json();
    if (_escalaAvalKey !== key) return; // resposta antiga: descarta
    if (!d.ok) { _escalaAvalKey = null; return; } // permite retry na próxima interação
    _escalaAvalMap = new Map((d.items || []).map(it => [it.massagista_id, it]));
    _escalaAvalLancada = !!d.lancada;
    _escalaAvalLivres = Number.isInteger(d.livres) ? d.livres : null;
    _escalaAvalRecepCoberta = d.recepcao_coberta === true;
    _renderMassagistasModal();
    _renderMassagistasModal2();
  } catch { if (_escalaAvalKey === key) _escalaAvalKey = null; /* fail-open + retry */ }
}

function _escalaFiltra(m, data, horaInicio, horaFim) {
  if (data && _escalaAvalMap && _escalaAvalKey === _escalaAvalKeyFor(data, horaInicio, horaFim)) {
    const av = _escalaAvalMap.get(m.id);
    // fora da escala OU já em atendimento no intervalo → fora do seletor
    if (av) return av.disponivel && !av.ocupada;
  }
  return true; // fail-open: sem aval carregada, backend valida no POST
}

// Contagem de livres válida para o intervalo atual (null = ainda não carregada).
// Sem hora_fim o backend usa intervalo-ponto no início — preview já correto.
function _livresIntervalo(data, horaInicio, horaFim) {
  if (data && horaInicio && _escalaAvalKey === _escalaAvalKeyFor(data, horaInicio, horaFim)) {
    return _escalaAvalLivres;
  }
  return null;
}

function _escalaAvisoHtml(data, horaInicio, horaFim) {
  if (!data || _escalaAvalLancada !== false) return '';
  if (_escalaAvalKey !== _escalaAvalKeyFor(data, horaInicio, horaFim)) return '';
  return '<div class="res-cb-opt cb-empty">⚠ Escala mensal não lançada para esta data — usando padrão semanal</div>';
}

// Combo (tipos_massagem.tipo === 'combo'): mais de uma massoterapeuta pode
// participar do mesmo tratamento — o seletor vira multi-seleção (checkboxes).
function _isComboTrat() {
  const t = _tratSelecionado();
  return !!t && t.tipo === 'combo' && !_isEspBeleza();
}

function _massLabel(m) { return m.nome + (m.vinculo ? ` · ${m.vinculo}` : ''); }

// Sincroniza o texto do input com principal + extras ("Ana + Bia")
function _massSyncInput() {
  const hid = document.getElementById('res-inp-massagista');
  const inp = document.getElementById('res-cb-mass-inp');
  const clr = document.getElementById('res-cb-mass-clr');
  const nomes = [];
  const principal = hid?.value ? _massagistasModal.find(m => String(m.id) === String(hid.value)) : null;
  if (principal) nomes.push(_massLabel(principal));
  for (const x of _resMassExtras) {
    const m = _massagistasModal.find(mm => mm.id === x);
    if (m) nomes.push(m.nome);
  }
  if (inp) { inp.value = nomes.join(' + '); inp.dataset.synced = '1'; }
  if (clr) clr.style.display = nomes.length ? '' : 'none';
}

function _massMultiToggle(id) {
  const hid = document.getElementById('res-inp-massagista');
  const principal = hid?.value ? +hid.value : null;
  if (principal === id) {
    // desmarca a principal; promove a primeira extra, se houver
    const promovida = _resMassExtras.shift() || null;
    if (hid) hid.value = promovida ? String(promovida) : '';
  } else if (_resMassExtras.includes(id)) {
    _resMassExtras = _resMassExtras.filter(x => x !== id);
  } else if (!principal) {
    if (hid) hid.value = String(id);
  } else {
    if (_resMassExtras.length >= 4) { showToast('Máximo de 5 massoterapeutas por combo', 4000); return; }
    // Regra da recepção: sem recepcionista em escala, o total selecionado não
    // pode zerar as livres do intervalo (backend revalida; override no salvar).
    const data = document.getElementById('res-inp-data')?.value || null;
    const horaInicio = document.getElementById('res-inp-hora-inicio')?.value || null;
    const livres = _livresIntervalo(data, horaInicio, _resHoraFim);
    const p2Sel = (_isCasal() && document.getElementById('res-inp-massagista2')?.value) ? 1 : 0;
    const selDepois = 2 + _resMassExtras.length + p2Sel; // principal + extras + esta (+ pessoa 2)
    if (_escalaAvalRecepCoberta !== true && livres !== null && selDepois >= livres) {
      _showRecepAlertPopup();
      return;
    }
    _resMassExtras.push(id);
  }
  _massSyncInput();
  _renderMassagistasModal();
  hid?.dispatchEvent(new Event('change', { bubbles: true }));
}

function _renderMassagistasModal() {
  const list = document.getElementById('res-cb-mass-list');
  const hid  = document.getElementById('res-inp-massagista');
  const inp  = document.getElementById('res-cb-mass-inp');
  const clr  = document.getElementById('res-cb-mass-clr');
  if (!list) return;
  const apenasBilingue = document.getElementById('res-flt-bilingue')?.checked;
  const data = document.getElementById('res-inp-data')?.value || null;
  const horaInicio = document.getElementById('res-inp-hora-inicio')?.value || null;
  const prevId = hid?.value;
  if (data) _fetchEscalaAval(data, horaInicio, _resHoraFim);
  // Tratamentos são dados só por massoterapeutas — recepcionistas ficam fora
  // do seletor (mas continuam na grade da escala mensal).
  let lista = _massagistasModal.filter(m => !m.funcao?.toLowerCase().includes('recep'));
  if (apenasBilingue) lista = lista.filter(m => m.bilingue);
  lista = lista.filter(m => _escalaFiltra(m, data, horaInicio, _resHoraFim));
  const aviso = _escalaAvisoHtml(data, horaInicio, _resHoraFim);
  // Regra da recepção: NENHUMA massoterapeuta é escondida do seletor. O alerta
  // acontece no popup (_showRecepAlertPopup) ao tentar selecionar todas, e o
  // gate duro fica no backend (409 + "Agendar mesmo assim" ao salvar).
  const livres = _livresIntervalo(data, horaInicio, _resHoraFim);
  if (!lista.length) {
    const _semNinguem = (livres === 0)
      ? 'Nenhuma massoterapeuta disponível neste horário — todas em atendimento ou fora de escala'
      : (apenasBilingue ? 'Nenhuma bilíngue na escala deste horário' : 'Nenhuma massoterapeuta na escala deste horário');
    list.innerHTML = aviso + `<div class="res-cb-opt cb-empty">${_semNinguem}</div>`;
    return;
  }
  const combo = _isComboTrat();
  // Fora do modo combo, extras não fazem sentido: colapsa para só a principal.
  // Guard: só quando a lista de tratamentos já carregou — senão a edição de um
  // combo apagaria as extras antes de _tratamentos resolver (corrida no prefill).
  if (!combo && _tratamentos.length && _resMassExtras.length) { _resMassExtras = []; _massSyncInput(); }
  // Extras que saíram da lista (escala/conflito mudou) são removidas
  if (combo && _resMassExtras.length) {
    const idsSet = new Set(lista.map(m => m.id));
    const antes = _resMassExtras.length;
    _resMassExtras = _resMassExtras.filter(x => idsSet.has(x));
    if (antes !== _resMassExtras.length) _massSyncInput();
  }
  const hintCombo = combo ? '<div class="res-cb-opt cb-empty">Combo — marque uma ou mais massoterapeutas</div>' : '';
  list.innerHTML = aviso + hintCombo + lista.map(m => {
    const suffix = m.vinculo ? ` · ${m.vinculo}` : '';
    const marcada = combo && (String(hid?.value || '') === String(m.id) || _resMassExtras.includes(m.id));
    const chk = combo ? `<span style="display:inline-block;width:1.1em">${marcada ? '☑' : '☐'}</span> ` : '';
    return `<div class="res-cb-opt" ${combo ? 'data-multi="1"' : ''} data-val="${m.id}" data-label="${escHtml(m.nome)}">${chk}${escHtml(m.nome)}${suffix}${m.bilingue ? ' 🌍' : ''}</div>`;
  }).join('');
  // Se seleção anterior saiu da lista, limpa (no combo: promove uma extra)
  if (prevId && !lista.find(m => String(m.id) === String(prevId))) {
    const promovida = combo ? (_resMassExtras.shift() || null) : null;
    if (hid) hid.value = promovida ? String(promovida) : '';
    if (combo) _massSyncInput();
    else {
      if (inp) { inp.value = ''; }
      if (clr) clr.style.display = 'none';
    }
  }
  // Auto-seleciona quando só uma disponível e nada selecionado
  if (lista.length === 1 && !hid?.value) {
    const m = lista[0];
    if (hid) hid.value = m.id;
    if (inp) inp.value = _massLabel(m);
    if (clr) clr.style.display = '';
    hid?.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

async function loadTratamentosModal() {
  if (_tratamentos.length) return;
  try {
    const r = await api('/api/tipos-massagem-ativos');
    if (!r) return;
    const d = await r.json();
    _tratamentos = d.items || [];
    const list = document.getElementById('res-cb-trat-list');
    if (!list) return;
    const ordem = ['Combo', 'Massagem', 'Tratamento', 'Facial', 'Complementar'];
    const porCat = {};
    for (const t of _tratamentos) {
      const cat = t.categoria || 'Outros';
      (porCat[cat] = porCat[cat] || []).push(t);
    }
    const cats = ordem.filter(c => porCat[c]).concat(Object.keys(porCat).filter(c => !ordem.includes(c)));
    let html = '';
    for (const cat of cats) {
      html += `<div class="res-cb-grp">${cat}</div>`;
      for (const t of porCat[cat]) {
        const precoLbl = t.preco ? ` · R$ ${Number(t.preco).toFixed(0)}` : '';
        const durLbl = t.duracao_min ? ` (${t.duracao_min} min)` : '';
        html += `<div class="res-cb-opt" data-val="${escHtml(t.nome)}" data-label="${escHtml(t.nome)}">${escHtml(t.nome)}${durLbl}${precoLbl}</div>`;
      }
    }
    if (!html) html = '<div class="res-cb-opt cb-empty">Nenhum tratamento disponível</div>';
    list.innerHTML = html;
    // Replica a mesma lista para pessoa 2 (casal)
    const list2 = document.getElementById('res-cb-trat2-list');
    if (list2) list2.innerHTML = html;
  } catch {}
}

// Localiza o tratamento selecionado no modal
function _tratSelecionado() {
  const sel = document.getElementById('res-inp-tratamento');
  if (!sel.value) return null;
  return _tratamentos.find(t => t.nome === sel.value) || null;
}

function _blocoMinutos(durTratamento) {
  return durTratamento || 0;
}

const TAXA_SERVICO = 0.10;
const TAXA_ISS     = 0.05;

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
    if(_calDiaSel) loadUsoAquatico(calDateStr(_calDiaSel));
  }
}

function renderCalWeekPills() {
  const days=calGetWeek(_calWeekOffset);
  const todayStr=calDateStr(new Date());
  if(!_calDiaSel || !days.some(d=>calDateStr(d)===calDateStr(_calDiaSel))) {
    _calDiaSel=days.find(d=>calDateStr(d)===todayStr)||days[0];
  }
  const selStr=calDateStr(_calDiaSel);
  const refDay=_calDiaSel||days[0];
  const ml=document.getElementById('cal-month-label');
  if(ml) ml.innerHTML=`${MESES_FULL[refDay.getMonth()]} <span>${refDay.getFullYear()}</span>`;
  document.getElementById('cal-week-days').innerHTML=days.map(d=>{
    const ds=calDateStr(d);
    const isToday=ds===todayStr;
    const isSel=ds===selStr;
    const cnt=_reservas.filter(r=>r.data===ds).length;
    return `<button class="cal-day-pill${isToday?' today':''}${isSel?' selected':''}"
      data-action="cal-day" data-ds="${ds}">
      <span class="cdp-abbr">${DIAS_PT[d.getDay()]}</span>
      <span class="cdp-num">${d.getDate()}</span>
      ${cnt>0?'<span class="cdp-dot"></span>':''}
    </button>`;
  }).join('');
}

window.calSelectDay=(ds)=>{
  if (!ds || typeof ds !== 'string') return;
  const parts = ds.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return;
  const [y,m,day] = parts;
  _calDiaSel=new Date(y,m-1,day);
  renderCalWeekPills();
  renderCalDia();
  loadUsoAquatico(ds);
};

// ── Date Picker ──────────────────────────────────────────────
let _dpYear = null, _dpMonth = null;
const _MESES_DP = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function dpOpen() {
  const ref = _calDiaSel || new Date();
  _dpYear = ref.getFullYear();
  _dpMonth = ref.getMonth();
  dpRender();
  document.getElementById('cal-datepicker').style.display = 'block';
  document.getElementById('btn-dp-open').classList.add('open');
  setTimeout(() => document.addEventListener('click', _dpOutside), 0);
}

function dpClose() {
  document.getElementById('cal-datepicker').style.display = 'none';
  document.getElementById('btn-dp-open').classList.remove('open');
  document.removeEventListener('click', _dpOutside);
}

function _dpOutside(e) {
  const picker = document.getElementById('cal-datepicker');
  const btn    = document.getElementById('btn-dp-open');
  if (!picker.contains(e.target) && !btn.contains(e.target)) dpClose();
}

function dpToggle(e) {
  e.stopPropagation();
  const isOpen = document.getElementById('cal-datepicker').style.display !== 'none';
  if (isOpen) dpClose(); else dpOpen();
}

function dpRender() {
  const todayStr = calDateStr(new Date());
  const selStr   = _calDiaSel ? calDateStr(_calDiaSel) : null;
  document.getElementById('dp-hd-label').textContent = `${_MESES_DP[_dpMonth]} ${_dpYear}`;

  const first    = new Date(_dpYear, _dpMonth, 1);
  const lastDate = new Date(_dpYear, _dpMonth + 1, 0).getDate();
  const startDow = first.getDay(); // 0=Dom

  const cells = [];
  for (let i = startDow - 1; i >= 0; i--) {
    cells.push({ date: new Date(_dpYear, _dpMonth, -i), dim: true });
  }
  for (let d = 1; d <= lastDate; d++) {
    cells.push({ date: new Date(_dpYear, _dpMonth, d), dim: false });
  }
  const tail = 42 - cells.length;
  for (let d = 1; d <= tail; d++) {
    cells.push({ date: new Date(_dpYear, _dpMonth + 1, d), dim: true });
  }

  document.getElementById('dp-grid').innerHTML = cells.map(({ date, dim }) => {
    const ds = calDateStr(date);
    let cls = 'dp-day';
    if (dim)             cls += ' dp-dim';
    if (ds === todayStr) cls += ' dp-today';
    if (ds === selStr)   cls += ' dp-sel';
    const action = dim ? '' : `data-action="dp-select" data-ds="${ds}"`;
    return `<button class="${cls}" ${action}>${date.getDate()}</button>`;
  }).join('');
}

function dpSelectDate(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tdow = today.getDay();
  const todayMon = new Date(today);
  todayMon.setDate(today.getDate() + (tdow === 0 ? -6 : 1 - tdow));
  const tgt2 = target.getDay();
  const targetMon = new Date(target);
  targetMon.setDate(target.getDate() + (tgt2 === 0 ? -6 : 1 - tgt2));
  _calWeekOffset = Math.round((targetMon - todayMon) / (7 * 24 * 60 * 60 * 1000));
  _calDiaSel = target;
  dpClose();
  loadReservas();
}

function renderCalDia() {
  if(!_calDiaSel)return;
  const ds=calDateStr(_calDiaSel);
  const dayRes=_reservas.filter(r=>r.data===ds);

  const MAX_SLOTS = Math.round(((CAL_H_END - CAL_H_START) * 60) / 30);
  // Mapa de bloqueios ativos para este dia (usa _salasData carregado por loadSalas)
  const _bloqMap = new Map();
  (_salasData || []).forEach(s => {
    const ativo = (s.bloqueios || []).find(b => b.data_inicio <= ds && b.data_fim >= ds);
    if (ativo) _bloqMap.set(s.id, ativo);
  });

  document.getElementById('cal-rooms-header').innerHTML=
    `<div class="cal-time-col-head"><span class="cal-time-col-head-lbl">hora</span></div>`+
    CAL_ROOMS.map(room=>{
      const occ=dayRes.filter(r=>r.sala===room.id).length;
      const isShared=(room.id===3||room.id===4);
      const bloq=_bloqMap.get(room.id);
      return `<div class="cal-room-col-head ${room.cls}${isShared?' cal-room-shared':''}${bloq?' cal-room-bloqueada':''}">
        <div class="cal-room-col-hd-inner">
          <div class="cal-room-col-name ${room.cls}">${room.nome}</div>
          ${occ>0?`<span class="cal-room-col-badge ${room.cls}">${occ}</span>`:''}
        </div>
        <div class="cal-room-col-sub">${room.tipo}</div>
        ${bloq?`<div class="cal-room-bloq-lbl" title="${escHtml(bloq.motivo)}">⛔ Bloqueada</div>`:''}
        ${isShared?`<div class="cal-room-shared-lbl">espaço compartilhado</div>`:''}
      </div>`;
    }).join('');

  const SLOT_MIN = 30;
  let html='';
  for(let m=CAL_H_START*60; m<CAL_H_END*60; m+=SLOT_MIN){
    const slotS=m, slotE=slotS+SLOT_MIN;
    const hh=Math.floor(m/60), mm=m%60;
    const timeStr=String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0');
    const isHour = mm === 0;
    const halfClass = isHour ? ' hour' : ' half';
    html+=`<div class="cal-time-cell${halfClass}">${timeStr}</div>`;
    CAL_ROOMS.forEach(room=>{
      const res=dayRes.find(r=>r.sala===room.id&&calTimeMin(r.hora_inicio)<slotE&&calTimeMin(r.hora_fim)>slotS);
      // Salas 3 e 4 compartilham espaco fisico SOMENTE quando a reserva
      // existente eh CASAL (cliente2 preenchido). Reservas individuais
      // em 3 nao bloqueiam 4 — e vice-versa.
      if (!res && (room.id === 3 || room.id === 4)) {
        const outraSala = room.id === 3 ? 4 : 3;
        const blocker = dayRes.find(r => r.sala === outraSala && isReservaCasal(r) && calTimeMin(r.hora_inicio) < slotE && calTimeMin(r.hora_fim) > slotS);
        if (blocker) {
          const isFirst = calTimeMin(blocker.hora_inicio) >= slotS && calTimeMin(blocker.hora_inicio) < slotE;
          if (isFirst) {
            const rs3 = calTimeMin(blocker.hora_inicio), re3 = calTimeMin(blocker.hora_fim);
            const topPx = ((rs3 - slotS) / SLOT_MIN) * CAL_SLOT_PX + 2;
            const ht = ((re3 - rs3) / SLOT_MIN) * CAL_SLOT_PX - 4;
            const ehGCB = blocker.quarto_categoria === 'gran_class';
            const gcStyleB = ehGCB ? ';box-shadow:inset 0 0 0 2px #9C5843' : '';
            const modoB = ht < 70 ? 'compact' : (ht < 130 ? 'medium' : 'full');
            // S4: metade direita do card casal — Pessoa 2
            const p2Nome = blocker.cliente2 || '';
            const p2Trat = blocker.tratamento2 || '';
            const p2Mass = blocker.massagista_nome2 || '';
            const anamP2ok = !!blocker.documento_perfil_id2;
            const anamP2badge = anamP2ok ? `<span class="cal-anam-badge" title="Anamnese Pessoa 2 preenchida">✓</span>` : '';
            let innerB = '';
            if (modoB === 'compact') {
              innerB = `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.76rem;font-weight:600;display:flex;align-items:center;gap:.2rem">${anamP2badge}<span style="overflow:hidden;text-overflow:ellipsis">${escHtml(p2Nome)}</span></div>`;
            } else if (modoB === 'medium') {
              innerB = `<div class="cal-res-name" style="display:flex;align-items:center;gap:.25rem">${anamP2badge}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p2Nome)}</span></div>${p2Trat?`<div class="cal-res-trat">${escHtml(p2Trat)}</div>`:''}`;
            } else {
              innerB = `<div class="cal-res-name" style="display:flex;align-items:center;gap:.25rem">${anamP2badge}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p2Nome)}</span></div>${p2Trat?`<div class="cal-res-trat">${escHtml(p2Trat)}</div>`:''}<div class="cal-res-time">${blocker.hora_inicio} – ${blocker.hora_fim}</div>${p2Mass?`<div class="cal-res-by">${escHtml(p2Mass)}</div>`:''}`;
            }
            html += `<div class="cal-slot occupied${halfClass}" style="overflow:visible;position:relative">
              <span class="cal-casal-chip" style="position:absolute;left:0;top:${topPx + Math.round(ht / 2)}px;transform:translate(-50%,-50%);z-index:10;pointer-events:none">🤝 Casal</span>
              <div class="cal-res-block s4 casal-right" style="position:absolute;left:0;right:4px;top:${topPx}px;height:${ht}px;padding:.3rem .4rem;display:flex;flex-direction:column;gap:.1rem${gcStyleB}" data-action="cal-ver" data-id="${blocker.id}" title="Casal · Sala 4 · ${escHtml(p2Nome)}">
                ${innerB}
              </div>
            </div>`;
          } else {
            html += `<div class="cal-slot occupied-cont${halfClass}"></div>`;
          }
          return;
        }
      }
      if(res){
        const rs=calTimeMin(res.hora_inicio), re=calTimeMin(res.hora_fim);
        const isFirst=rs>=slotS&&rs<slotE;
        if(isFirst){
          const topPx=((rs-slotS)/SLOT_MIN)*CAL_SLOT_PX+2;
          const ht=((re-rs)/SLOT_MIN)*CAL_SLOT_PX-4;
          const ehGC = res.quarto_categoria === 'gran_class';
          // Layout adaptativo conforme altura disponivel:
          // - compacto (ht < 70): so nome + horario inline + GC dot
          // - medio (ht 70-130): nome + tratamento truncado + horario
          // - completo (ht >= 130): tudo (nome, tratamento, horario, mass, por)
          const modo = ht < 70 ? 'compact' : (ht < 130 ? 'medium' : 'full');
          const titleParts = [
            res.cliente + (res.cliente2 ? ' & ' + res.cliente2 : ''),
            res.tratamento ? res.tratamento + (res.tratamento2 ? ' / ' + res.tratamento2 : '') : null,
            res.hora_inicio + '–' + res.hora_fim,
            res.massagista_nome ? 'Profissional: ' + res.massagista_nome + (res.massagista_nome2 ? ' & ' + res.massagista_nome2 : '') : null,
            res.quarto ? 'Quarto ' + res.quarto : null,
            ehGC ? '★ Gran Class' : null,
            res.criado_por ? 'criado por ' + res.criado_por : null,
          ].filter(Boolean).join(' · ');
          const gcStyle = ehGC ? ';box-shadow:inset 0 0 0 2px #9C5843' : '';
          const cancelBtn = `<button class="cal-res-cancel" data-action="cal-cancelar" data-id="${res.id}" title="Cancelar reserva">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>`;
          const gcBadge = ehGC
            ? `<button type="button" data-action="gc-info" title="Ver benefícios Gran Class" style="background:linear-gradient(180deg,#F5EFE2,#B8705A);color:#202C28;border:1px solid #9C5843;border-radius:9999px;padding:.05rem .4rem;font-size:.6rem;font-weight:700;letter-spacing:.04em;line-height:1.3;cursor:pointer;flex-shrink:0">★ GC</button>`
            : '';
          const casalBadge = res.cliente2
            ? `<span style="background:rgba(139,74,107,.18);color:var(--sala-s4-text,#4a1f38);border-radius:9999px;padding:.05rem .4rem;font-size:.6rem;font-weight:700;letter-spacing:.03em;line-height:1.3;flex-shrink:0">🤝 S3+4</span>`
            : '';
          // Badge anamnese: aparece quando ao menos uma anamnese foi PREENCHIDA
          // (documento_perfil_id vinculado). Em casal mostra contador 1/2 ou 2/2.
          const _anamP1Ok = !!res.documento_perfil_id;
          const _anamP2Ok = !!res.documento_perfil_id2;
          const _anamN = (_anamP1Ok ? 1 : 0) + (res.cliente2 && _anamP2Ok ? 1 : 0);
          const anamBadge = _anamN > 0
            ? `<span class="cal-anam-badge" title="Anamnese preenchida${res.cliente2 ? ' ('+_anamN+'/2)' : ''}">✓${res.cliente2 ? ' '+_anamN+'/2' : ''}</span>`
            : '';
          const cortesiaBadge = res.tipo_pagamento === 'cortesia'
            ? `<span style="background:rgba(153,100,66,.18);color:var(--gold-dark);border-radius:9999px;padding:.05rem .4rem;font-size:.6rem;font-weight:700;letter-spacing:.03em;line-height:1.3;flex-shrink:0" title="Cortesia">🎁</span>`
            : '';
          const isCasalCard = !!res.cliente2;
          let inner = '';
          if (modo === 'compact') {
            // Ultra compacto: nome + GC badge + horario na mesma linha
            inner = `
              <div style="display:flex;align-items:center;gap:.3rem;font-size:.78rem;font-weight:600;line-height:1.15;color:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${gcBadge}${casalBadge}${anamBadge}${cortesiaBadge}
                <span style="overflow:hidden;text-overflow:ellipsis">${escHtml(res.cliente)}${res.cliente2 ? ' &amp; ' + escHtml(res.cliente2) : ''}</span>
              </div>
              <div style="font-size:.7rem;opacity:.85;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${res.hora_inicio}–${res.hora_fim}${res.tratamento ? ' · ' + escHtml(res.tratamento) : ''}</div>
            `;
          } else if (modo === 'medium') {
            inner = `
              <div class="cal-res-name" style="display:flex;align-items:center;gap:.35rem">${gcBadge}${casalBadge}${anamBadge}${cortesiaBadge}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(res.cliente)}${res.cliente2 ? ' &amp; ' + escHtml(res.cliente2) : ''}</span></div>
              ${res.tratamento?`<div class="cal-res-trat">${escHtml(res.tratamento)}${res.tratamento2?' / '+escHtml(res.tratamento2):''}</div>`:''}
              <div class="cal-res-time">${res.hora_inicio} – ${res.hora_fim}${res.quarto ? ' · qto ' + escHtml(res.quarto) : ''}</div>
            `;
          } else {
            inner = `
              <div class="cal-res-name" style="display:flex;align-items:center;gap:.35rem">${gcBadge}${casalBadge}${anamBadge}${cortesiaBadge}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(res.cliente)}${res.cliente2 ? ' &amp; ' + escHtml(res.cliente2) : ''}</span></div>
              ${res.tratamento?`<div class="cal-res-trat">${escHtml(res.tratamento)}${res.tratamento2?' / '+escHtml(res.tratamento2):''}</div>`:''}
              <div class="cal-res-time">${res.hora_inicio} – ${res.hora_fim}${res.quarto ? ' · qto ' + escHtml(res.quarto) : ''}</div>
              ${res.massagista_nome?`<div class="cal-res-by">${escHtml(res.massagista_nome)}${res.massagista_nome2?' &amp; '+escHtml(res.massagista_nome2):''}</div>`:''}
              <div class="cal-res-by">por ${res.criado_por ? escHtml(res.criado_por) : '—'}</div>
            `;
          }
          // Casal: redefine inner para Pessoa 1 apenas (left half); S4 mostra Pessoa 2
          if (isCasalCard) {
            const anamP1badge = _anamP1Ok ? `<span class="cal-anam-badge" title="Anamnese Pessoa 1 preenchida">✓</span>` : '';
            if (modo === 'compact') {
              inner = `
                <div style="display:flex;align-items:center;gap:.25rem;overflow:hidden">
                  ${anamP1badge}
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.76rem;font-weight:600">${escHtml(res.cliente)}</span>
                </div>
                <div style="font-size:.68rem;opacity:.75;white-space:nowrap">${res.hora_inicio}–${res.hora_fim}</div>
              `;
            } else if (modo === 'medium') {
              inner = `
                <div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap">${gcBadge}${anamP1badge}</div>
                <div class="cal-res-name">${escHtml(res.cliente)}</div>
                ${res.tratamento?`<div class="cal-res-trat">${escHtml(res.tratamento)}</div>`:''}
                <div class="cal-res-time">${res.hora_inicio} – ${res.hora_fim}</div>
              `;
            } else {
              inner = `
                <div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap">${gcBadge}${anamP1badge}</div>
                <div class="cal-res-name">${escHtml(res.cliente)}</div>
                ${res.tratamento?`<div class="cal-res-trat">${escHtml(res.tratamento)}</div>`:''}
                <div class="cal-res-time">${res.hora_inicio} – ${res.hora_fim}${res.quarto?' · qto '+escHtml(res.quarto):''}</div>
                ${res.massagista_nome?`<div class="cal-res-by">${escHtml(res.massagista_nome)}</div>`:''}
              `;
            }
          }
          const casalLeftCls = isCasalCard ? ' casal-left' : '';
          const casalRightPx = isCasalCard ? '0' : '4';
          html+=`<div class="cal-slot occupied${halfClass}" style="overflow:visible;position:relative">
            <div class="cal-res-block ${room.cls}${ehGC ? ' is-gran-class' : ''}${casalLeftCls}" style="position:absolute;left:0;right:${casalRightPx}px;top:${topPx}px;height:${ht}px;padding:.3rem .4rem;display:flex;flex-direction:column;gap:.1rem${gcStyle}" data-action="cal-ver" data-id="${res.id}" title="${escHtml(titleParts)}">
              ${inner}
              ${cancelBtn}
            </div>
          </div>`;
        } else {
          html+=`<div class="cal-slot occupied-cont${halfClass}"></div>`;
        }
      } else {
        const _slotBloq = _bloqMap.has(room.id);
        html+=`<div class="cal-slot${halfClass}${_slotBloq ? ' cal-slot-bloq' : ''}" data-action="cal-open" data-sala="${room.id}" data-ds="${ds}" data-hora="${timeStr}"${_slotBloq ? ' data-bloqueada="1"' : ''}></div>`;
      }
    });
  }
  html += `<div class="cal-close-row">
    <div class="cal-close-time">${String(CAL_H_END).padStart(2,'0')}:00</div>
    <div class="cal-close-label">Fechamento do spa</div>
  </div>`;
  document.getElementById('cal-grid').innerHTML=html;

  // Linha de horário atual — scroll automático ao horário atual se for hoje
  calUpdateNowLine(ds, true);
}

window.calCancelar=async(id, overlayEl = null)=>{
  const ok = await confirmarAcao({
    titulo: 'Cancelar reserva?',
    mensagem: 'Esta ação remove a reserva da agenda. Não é possível desfazer.',
    btnConfirmar: 'Sim, cancelar',
    btnCancelar: 'Voltar',
    perigoso: true,
  });
  if (!ok) return;
  if (overlayEl) { overlayEl.style.display = 'none'; _modalOpen = false; }
  const res = await api(`/api/reservas/${id}`, { method: 'DELETE' });
  if (res) { loadReservas(); showToast('Reserva cancelada.'); }
};

// Modal universal de confirmação — visual integrado ao admin Gran Marquise.
// Resolve com true (confirmar) ou false (cancelar/ESC/clicar fora).
function confirmarAcao({ titulo = 'Confirmar?', mensagem = '', btnConfirmar = 'Confirmar', btnCancelar = 'Cancelar', perigoso = false } = {}) {
  return new Promise(resolve => {
    // Remove eventual overlay anterior
    document.querySelectorAll('.confirm-overlay').forEach(n => n.remove());
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.72);backdrop-filter:blur(2px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
    const cor = perigoso ? 'var(--danger,#b85a4a)' : 'var(--gold,#9C5843)';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" style="background:var(--surface);border:1px solid var(--border);border-radius:10px;max-width:440px;width:100%;padding:1.4rem 1.6rem;box-shadow:0 12px 40px rgba(0,0,0,.4)">
        <h3 style="margin:0 0 .5rem 0;font-family:var(--serif);font-size:1.4rem;font-weight:500;color:${cor}">${escHtml(titulo)}</h3>
        <p style="margin:0 0 1.4rem 0;color:var(--text);font-size:.92rem;line-height:1.5">${escHtml(mensagem)}</p>
        <div style="display:flex;gap:.6rem;justify-content:flex-end">
          <button class="btn btn-outline" data-act="cancel">${escHtml(btnCancelar)}</button>
          <button class="btn ${perigoso ? '' : 'btn-gold'}" data-act="ok"
            style="${perigoso ? 'background:'+cor+';border:1px solid '+cor+';color:white' : ''}">${escHtml(btnConfirmar)}</button>
        </div>
      </div>
    `;
    function close(result) {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    }
    overlay.addEventListener('click', e => {
      if (e.target.dataset.act === 'ok') close(true);
      else if (e.target.dataset.act === 'cancel') close(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    // Foco no botão de confirmação para acessibilidade
    setTimeout(() => overlay.querySelector('[data-act="ok"]')?.focus(), 30);
  });
}
window.confirmarAcao = confirmarAcao;

let _nowLineInterval = null;
function calUpdateNowLine(ds, scrollIntoView = false) {
  const grid = document.getElementById('cal-grid');
  if (!grid) return;
  const existing = grid.querySelector('.cal-now-line');
  if (existing) existing.remove();
  const todayStr = calDateStr(new Date());
  if (ds !== todayStr) return;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin < CAL_H_START * 60 || nowMin > CAL_H_END * 60) return;
  const topPx = ((nowMin - CAL_H_START * 60) / 30) * CAL_SLOT_PX;
  const timeStr = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
  const line = document.createElement('div');
  line.className = 'cal-now-line';
  line.style.top = topPx + 'px';
  line.innerHTML = `<span class="cal-now-lbl">${timeStr}</span>`;
  grid.appendChild(line);
  if (scrollIntoView) {
    const scroll = document.querySelector('.cal-scroll');
    if (scroll) {
      const offset = Math.max(0, topPx - scroll.clientHeight / 2 + CAL_SLOT_PX);
      scroll.scrollTo({ top: offset, behavior: 'smooth' });
    }
  }
}
function _startNowLineInterval() {
  if (_nowLineInterval) clearInterval(_nowLineInterval);
  _nowLineInterval = setInterval(() => {
    if (_calDiaSel) calUpdateNowLine(calDateStr(_calDiaSel));
  }, 60000);
}
_startNowLineInterval();

// ── Modal Reserva ──
function calSetTipo(tipo) {
  _resTipo = tipo;
  document.querySelectorAll('[data-tipo]').forEach(b => b.classList.toggle('active', b.dataset.tipo === tipo));
  const isHospede = tipo === 'hospede';
  const aptoEl = document.getElementById('res-fg-apto');
  aptoEl.style.display = isHospede ? '' : 'none';
  const nomeFg = document.getElementById('res-fg-nome');
  if (nomeFg) nomeFg.style.gridColumn = isHospede ? '' : '1 / -1';
  if (!isHospede) {
    document.getElementById('res-inp-apto').value = '';
    const info = document.getElementById('res-quarto-info');
    if (info) info.style.display = 'none';
  }
  // O quarto só é obrigatório para hóspedes
  const req = document.getElementById('res-quarto-req');
  if (req) req.style.display = isHospede ? '' : 'none';
  _atualizarComboLinhaPreco();
}

function calOpenModal(salaId, data, hora) {
  _resSala=salaId||1;
  _resTipo=null;
  _modalOpen = true;
  document.getElementById('res-modal-overlay').style.display='flex';
  document.getElementById('res-modal-err').textContent='';
  document.querySelectorAll('.res-tipo-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('[data-tipo-res]').forEach(b=>b.classList.remove('active'));
  document.getElementById('res-fg-apto').style.display='none';
  const _nomeFg = document.getElementById('res-fg-nome');
  if (_nomeFg) _nomeFg.style.gridColumn = '1 / -1';
  ['res-inp-nome','res-inp-apto','res-inp-email','res-inp-tel','res-inp-cpf','res-inp-nacionalidade'].forEach(id=>{
    const el = document.getElementById(id); if (el) el.value='';
  });
  const _idiomaEl = document.getElementById('res-inp-idioma'); if (_idiomaEl) _idiomaEl.value = 'pt-BR';
  const _tipoDocSel = document.getElementById('res-sel-tipo-doc');
  if (_tipoDocSel) { _tipoDocSel.value = 'cpf'; _tipoDocSel.dispatchEvent(new Event('change')); }
  const _cpfInfo = document.getElementById('res-cpf-info');
  if (_cpfInfo) { _cpfInfo.style.display = 'none'; _cpfInfo.textContent = ''; }
  if (_cbTrat)  _cbTrat.clear();
  if (_cbMass)  _cbMass.clear();
  if (_cbTrat2) _cbTrat2.clear();
  if (_cbMass2) _cbMass2.clear();
  _resTipo2 = null;
  document.querySelectorAll('[data-tipo2]').forEach(b => b.classList.remove('active'));
  const _q2Fg = document.getElementById('res2-fg-quarto');
  if (_q2Fg) _q2Fg.style.display = 'none';
  ['res2-inp-cpf','res2-inp-nome','res2-inp-quarto','res2-inp-email','res2-inp-tel','res2-inp-nacionalidade'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const _idioma2El = document.getElementById('res2-inp-idioma'); if (_idioma2El) _idioma2El.value = 'pt-BR';
  const _tipoDoc2Sel = document.getElementById('res2-sel-tipo-doc');
  if (_tipoDoc2Sel) { _tipoDoc2Sel.value = 'cpf'; _tipoDoc2Sel.dispatchEvent(new Event('change')); }
  const _cpf2Info = document.getElementById('res2-cpf-info');
  if (_cpf2Info) { _cpf2Info.style.display = 'none'; _cpf2Info.textContent = ''; }
  const _quarto2Info = document.getElementById('res2-quarto-info');
  if (_quarto2Info) { _quarto2Info.style.display = 'none'; _quarto2Info.textContent = ''; }
  const _quarto2Fg = document.getElementById('res2-fg-quarto');
  if (_quarto2Fg) _quarto2Fg.style.display = 'none';
  // Casal checkbox: exibe para sala 3/4, sempre desmarcado ao abrir
  const _casalChk = document.getElementById('res-chk-casal');
  const _casalWrap = document.getElementById('res-casal-chk-wrap');
  if (_casalChk) _casalChk.checked = false;
  if (_casalWrap) _casalWrap.style.display = (_resSala === 3 || _resSala === 4) ? '' : 'none';
  const sec2 = document.getElementById('res-sec-pessoa2');
  if (sec2) sec2.style.display = 'none';
  const _sep1 = document.getElementById('res-sep-pessoa1');
  if (_sep1) _sep1.style.display = 'none';
  const _wrap1 = document.getElementById('res-pessoa1-wrap');
  if (_wrap1) _wrap1.classList.remove('casal-ativo');
  // Reset pagamento / cortesia
  const _pagBtnPago = document.getElementById('res-pag-btn-pago');
  const _pagBtnCortesia = document.getElementById('res-pag-btn-cortesia');
  const _pagHid = document.getElementById('res-inp-tipo-pagamento');
  const _pagCampos = document.getElementById('res-sec-cortesia-campos');
  if (_pagBtnPago) _pagBtnPago.classList.add('active');
  if (_pagBtnCortesia) _pagBtnCortesia.classList.remove('active');
  if (_pagHid) _pagHid.value = 'pago';
  if (_pagCampos) _pagCampos.style.display = 'none';
  ['res-inp-cortesia-autorizado-nome','res-inp-cortesia-autorizado-id'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const _selTipo = document.getElementById('res-sel-cortesia-tipo'); if (_selTipo) _selTipo.value = '';
  const _acLr = document.getElementById('res-cortesia-ac-lista'); if (_acLr) _acLr.style.display = 'none';
  _resHoraInicio = hora || '09:00';
  _resHoraFim = null;
  _resMassExtras = [];
  document.getElementById('res-inp-hora-inicio').value = _resHoraInicio;
  document.getElementById('res-tempo-val').textContent = 'selecione um tratamento';
  document.getElementById('res-extra-info').innerHTML = '';
  // Bloqueia agendamento em data passada via attr min do input de data.
  const _agoraFt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
  const _hojeFt = _agoraFt.getFullYear() + '-' + String(_agoraFt.getMonth()+1).padStart(2,'0') + '-' + String(_agoraFt.getDate()).padStart(2,'0');
  const dataInp = document.getElementById('res-inp-data');
  if (dataInp) {
    dataInp.min = _hojeFt;
    // Sempre pre-preenche com a data passada OU hoje (nunca em branco).
    // Continua editavel: usuario clica no campo e escolhe qualquer dia futuro.
    dataInp.value = data || _hojeFt;
  }
  // Wire atalhos rapidos "Hoje / Amanha / +7 dias" (idempotente)
  _wireAtalhosData(_hojeFt);
  document.querySelectorAll('.res-room-btn').forEach(b=>b.classList.toggle('active',+b.dataset.sala===_resSala));
  // Marcar salas bloqueadas para a data selecionada
  if (data && _salasData.length > 0) {
    document.querySelectorAll('.res-room-btn').forEach(btn => {
      const sid = +btn.dataset.sala;
      const sData = _salasData.find(s => s.id === sid);
      const isBloq = !!sData && (sData.bloqueios || []).some(b => b.data_inicio <= data && b.data_fim >= data);
      btn.classList.toggle('bloq', isBloq);
      let badge = btn.querySelector('.res-room-btn-bloq-badge');
      if (isBloq && !badge) {
        badge = document.createElement('span');
        badge.className = 'res-room-btn-bloq-badge';
        badge.textContent = '⛔ BLOQUEADA';
        btn.appendChild(badge);
      } else if (!isBloq && badge) {
        badge.remove();
      }
    });
  }
  _ajustarHoraInicioBounds();
  _atualizarDisponibilidadeSalas();
  _aplicarVisibilidadeSala();
  loadTratamentosModal();
  loadMassagistasModal();
  // Escala pode ter mudado desde a última abertura (outro usuário/aba):
  // invalida o cache de disponibilidade e re-renderiza com a data corrente.
  _escalaAvalKey = null;
  _renderMassagistasModal();
  _renderMassagistasModal2();
  const flt = document.getElementById('res-flt-bilingue');
  if (flt) flt.checked = false;
  // CPF é o primeiro campo: foca para que, se já cadastrado, o autofill rode.
  setTimeout(()=>document.getElementById('res-inp-cpf')?.focus(),50);
}
window.calOpenModal=calOpenModal;

// === Wheel picker de Hora de início (scroll wheel + click) =============
//
// UI: dois "wheels" verticais (hora + minuto) com scroll-snap.
// Regras:
//   - Hoje (Fortaleza): hora começa na hora atual, ou na próxima cheia se
//     já passou dos :00. Vai até 21.
//   - Outros dias: 09..21.
//   - Minutos: sempre 00..59 (todos os inteiros).
// Fonte de verdade = input hidden #res-inp-hora-inicio.
// _ajustarHoraInicioBounds() é chamada por calOpenModal (abertura) e pelo
// handler `change` de #res-inp-data. Ela repopula os wheels e sincroniza
// o hidden, disparando `change` só se o valor mudou.

function _rhpStartHourParaData() {
  const dataVal = document.getElementById('res-inp-data')?.value || '';
  const agoraFt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
  const hojeFt = agoraFt.getFullYear() + '-' + String(agoraFt.getMonth()+1).padStart(2,'0') + '-' + String(agoraFt.getDate()).padStart(2,'0');
  let startHour = CAL_H_START; // 9
  if (dataVal === hojeFt) {
    startHour = agoraFt.getHours();
    if (agoraFt.getMinutes() > 0) startHour += 1;
    if (startHour < CAL_H_START) startHour = CAL_H_START;
    if (startHour > 21) startHour = 21;
  }
  return { startHour, endHour: 21 };
}

function _rhpAtualizarDisplay() {
  const hid = document.getElementById('res-inp-hora-inicio');
  const disp = document.getElementById('res-hora-display');
  if (!hid || !disp) return;
  const v = String(hid.value || '').trim();
  disp.textContent = v || '--:--';
}

function _rhpMarcarSelecionado(colEl, val) {
  if (!colEl) return;
  [...colEl.children].forEach(el => el.classList.toggle('selected', el.dataset.val === val));
}

function _rhpCentralizar(colEl, behavior = 'instant') {
  if (!colEl) return;
  const sel = colEl.querySelector('.rhp-item.selected');
  if (!sel) return;
  const target = sel.offsetTop - (colEl.clientHeight / 2) + (sel.offsetHeight / 2);
  colEl.scrollTo({ top: target, behavior });
}

function _rhpSelecionar(col, val) {
  const hid = document.getElementById('res-inp-hora-inicio');
  const [h, m] = String(hid.value || '09:00').split(':');
  const novoH = col === 'h' ? val : (h || '09');
  const novoM = col === 'm' ? val : (m || '00');
  const novo = novoH + ':' + novoM;
  const colEl = document.querySelector(`#res-hora-pop .rhp-col-${col}`);
  _rhpMarcarSelecionado(colEl, val);
  _rhpCentralizar(colEl, 'smooth');
  if (hid.value !== novo) {
    hid.value = novo;
    _resHoraInicio = novo;
    _rhpAtualizarDisplay();
    hid.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function _ajustarHoraInicioBounds() {
  const hid   = document.getElementById('res-inp-hora-inicio');
  const colH  = document.querySelector('#res-hora-pop .rhp-col-h');
  const colM  = document.querySelector('#res-hora-pop .rhp-col-m');
  if (!hid || !colH || !colM) return;
  const { startHour, endHour } = _rhpStartHourParaData();

  // Fonte de verdade = hidden.
  const parts = String(hid.value || '').split(':');
  const wantH = parts[0] || '';
  const wantM = parts[1] || '00';

  // Rebuild hora wheel
  colH.innerHTML = '';
  for (let h = startHour; h <= endHour; h++) {
    const v = String(h).padStart(2,'0');
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'rhp-item';
    item.dataset.val = v;
    item.textContent = v;
    item.setAttribute('role', 'option');
    item.addEventListener('click', () => _rhpSelecionar('h', v));
    colH.appendChild(item);
  }

  // Rebuild minuto wheel só na primeira vez
  if (!colM.children.length) {
    for (let m = 0; m <= 59; m++) {
      const v = String(m).padStart(2,'0');
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'rhp-item';
      item.dataset.val = v;
      item.textContent = v;
      item.setAttribute('role', 'option');
      item.addEventListener('click', () => _rhpSelecionar('m', v));
      colM.appendChild(item);
    }
  }

  // Escolhe hora efetiva: preserva `wantH` se ainda no range, senão
  // usa startHour. Minuto: preserva se 00-59.
  const validaH = [...colH.children].some(el => el.dataset.val === wantH);
  const escolhaH = validaH ? wantH : String(startHour).padStart(2,'0');
  const escolhaM = (/^\d{2}$/.test(wantM) && +wantM >= 0 && +wantM <= 59) ? wantM : '00';
  _rhpMarcarSelecionado(colH, escolhaH);
  _rhpMarcarSelecionado(colM, escolhaM);

  // Defesa em profundidade no submit (validação HTML/backend).
  hid.min = String(startHour).padStart(2,'0') + ':00';
  hid.max = '21:59';

  const novo = escolhaH + ':' + escolhaM;
  if (hid.value !== novo) {
    hid.value = novo;
    _resHoraInicio = novo;
    _rhpAtualizarDisplay();
    hid.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    _rhpAtualizarDisplay();
  }
}

// Abre/fecha popover ao clicar no trigger. Fecha ao clicar fora.
(function _rhpBindTrigger(){
  const trig = document.getElementById('res-hora-trigger');
  const pop  = document.getElementById('res-hora-pop');
  if (!trig || !pop) return;
  trig.addEventListener('click', (e) => {
    e.stopPropagation();
    const aberto = pop.classList.toggle('aberto');
    trig.classList.toggle('aberto', aberto);
    trig.setAttribute('aria-expanded', aberto ? 'true' : 'false');
    if (aberto) {
      const colH = pop.querySelector('.rhp-col-h');
      const colM = pop.querySelector('.rhp-col-m');
      requestAnimationFrame(() => {
        _rhpCentralizar(colH, 'instant');
        _rhpCentralizar(colM, 'instant');
      });
    }
  });
  document.addEventListener('click', (e) => {
    if (!pop.classList.contains('aberto')) return;
    if (pop.contains(e.target) || trig.contains(e.target)) return;
    pop.classList.remove('aberto');
    trig.classList.remove('aberto');
    trig.setAttribute('aria-expanded', 'false');
  });
})();

// Mantém o display sincronizado sempre que o hidden muda (calOpenModal,
// snap defensivo, etc.).
document.getElementById('res-inp-hora-inicio')?.addEventListener('change', _rhpAtualizarDisplay);

async function _atualizarDisponibilidadeSalas() {
  const dataVal = document.getElementById('res-inp-data')?.value;
  const hiVal   = document.getElementById('res-inp-hora-inicio')?.value;
  // Limpa estado ocupada independentemente de ter dados suficientes:
  // sem tratamento escolhido, não temos hora_fim real, então nenhuma sala fica
  // marcada como "Em uso" (evita falso positivo quando probe de +30min caía em
  // reserva alheia). Volta a marcar assim que hora_fim real for definida.
  document.querySelectorAll('.res-room-btn').forEach(btn => {
    btn.classList.remove('ocupada', 'propria');
    btn.querySelector('.res-room-btn-ocp-badge')?.remove();
    btn.querySelector('.res-room-btn-propria-badge')?.remove();
  });
  if (!dataVal || !hiVal) return;
  // Só consulta disponibilidade quando temos hora_fim REAL (derivada do
  // tratamento em calAtualizarHoraFim, ou informada manual no Espaço Beleza).
  const hfVal = _resHoraFim;
  if (!hfVal) return;
  try {
    const res = await api(`/api/admin/salas/disponiveis?data=${encodeURIComponent(dataVal)}&hora_inicio=${encodeURIComponent(hiVal)}&hora_fim=${encodeURIComponent(hfVal)}`);
    if (!res?.ok) return;
    let payload;
    try { payload = await res.json(); } catch { return; }
    if (!payload?.ok) return;
    const livresIds = new Set((payload.salas || []).map(s => s.id));
    const _salaOriginal = _resEditandoObj ? +_resEditandoObj.sala : null;
    document.querySelectorAll('.res-room-btn').forEach(btn => {
      const sid = +btn.dataset.sala;
      if (btn.classList.contains('bloq')) return;
      if (livresIds.has(sid)) return;
      // Em edição: sala original da reserva recebe badge próprio e mantém clicabilidade
      if (_salaOriginal !== null && sid === _salaOriginal) {
        btn.classList.add('propria');
        if (!btn.querySelector('.res-room-btn-propria-badge')) {
          const badge = document.createElement('span');
          badge.className = 'res-room-btn-propria-badge';
          badge.textContent = '📌 Sala da reserva';
          btn.appendChild(badge);
        }
        return;
      }
      btn.classList.add('ocupada');
      if (!btn.querySelector('.res-room-btn-ocp-badge')) {
        const badge = document.createElement('span');
        badge.className = 'res-room-btn-ocp-badge';
        badge.textContent = '⏱ Em uso';
        btn.appendChild(badge);
      }
    });
  } catch (_) { /* silencia erros de rede */ }
}

function _selecionarSalaAutomatica(tipo) {
  // Se ainda não há tratamento + horário definidos, a disponibilidade real das
  // salas não foi consultada — avisa listando SÓ o que está faltando (para
  // não pedir dados que o admin já preencheu).
  const dataVal = document.getElementById('res-inp-data')?.value;
  const hiVal   = document.getElementById('res-inp-hora-inicio')?.value;
  const tratVal = document.getElementById('res-inp-tratamento')?.value;
  const faltando = [];
  if (!dataVal) faltando.push('data');
  if (!hiVal)   faltando.push('horário');
  if (!tratVal) faltando.push('tratamento');
  // hora_fim pode ficar nulo mesmo com tratamento (ex: extrapola fechamento);
  // nesse caso pede pra revisar o horário.
  if (!faltando.length && !_resHoraFim) faltando.push('horário válido');
  if (faltando.length) {
    const lista = faltando.length === 1
      ? faltando[0]
      : faltando.length === 2
        ? faltando.join(' e ')
        : faltando.slice(0, -1).join(', ') + ' e ' + faltando[faltando.length - 1];
    showToast(`Escolha ${lista} antes de definir a sala.`);
    return;
  }
  if (tipo === 'dupla') {
    for (const sid of [3, 4]) {
      const btn = document.querySelector(`.res-room-btn[data-sala="${sid}"]`);
      if (btn && !btn.classList.contains('bloq') && !btn.classList.contains('ocupada')) {
        btn.click();
        const casalChk = document.getElementById('res-chk-casal');
        if (casalChk && !casalChk.checked) {
          casalChk.checked = true;
          casalChk.dispatchEvent(new Event('change'));
        }
        return;
      }
    }
    _abrirModalSalasLotadas('dupla');
  } else {
    for (const sid of [1, 2, 3, 4]) {
      const btn = document.querySelector(`.res-room-btn[data-sala="${sid}"]`);
      if (btn && !btn.classList.contains('bloq') && !btn.classList.contains('ocupada')) {
        btn.click();
        return;
      }
    }
    _abrirModalSalasLotadas('individual');
  }
}

function _abrirModalSalasLotadas(tipo) {
  const ov = document.getElementById('modal-salas-lotadas');
  if (!ov) return;
  const subtitleEl = ov.querySelector('[data-slot="subtitle"]');
  if (subtitleEl) {
    subtitleEl.textContent = (tipo === 'dupla')
      ? 'Não há Sala 3 nem Sala 4 disponíveis para o horário e duração escolhidos.'
      : 'Nenhuma das quatro salas de massagem está livre no horário e duração escolhidos.';
  }
  ov.style.display = 'flex';
  requestAnimationFrame(() => {
    ov.classList.add('aberto');
    ov.querySelector('.sl-btn-primary')?.focus();
  });
}

function _fecharModalSalasLotadas() {
  const ov = document.getElementById('modal-salas-lotadas');
  if (!ov) return;
  ov.classList.remove('aberto');
  setTimeout(() => { ov.style.display = 'none'; }, 180);
}
window._fecharModalSalasLotadas = _fecharModalSalasLotadas;

// Bind único (modal é estático no DOM) para os controles do popup de salas
// lotadas. Não usar onclick inline: helmet CSP inclui `script-src-attr 'none'`
// por padrão, o que bloqueia handlers inline mesmo com script-src 'unsafe-inline'.
(function _bindSalasLotadasControles(){
  const ov = document.getElementById('modal-salas-lotadas');
  if (!ov) return;
  // Backdrop (clique fora do card)
  ov.addEventListener('click', (e) => {
    if (e.target.id === 'modal-salas-lotadas') _fecharModalSalasLotadas();
  });
  // Botão Fechar
  document.getElementById('sl-btn-fechar')?.addEventListener('click', _fecharModalSalasLotadas);
  // Botão Alterar horário — fecha e devolve foco ao trigger da hora
  document.getElementById('sl-btn-alterar')?.addEventListener('click', () => {
    _fecharModalSalasLotadas();
    (document.getElementById('res-hora-trigger') || document.getElementById('res-inp-hora-inicio'))?.focus();
  });
  // Escape fecha o popup quando aberto
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!ov.classList.contains('aberto')) return;
    _fecharModalSalasLotadas();
  });
})();

// Atalhos rapidos pra escolher dia da nova reserva (Hoje / Amanha / +7).
// Insere chips logo abaixo do input data, atualiza o value e dispara change
// (pra _renderMassagistasModal* recalcular disponibilidade).
let _atalhosDataWired = false;
function _wireAtalhosData(hojeStr) {
  const dataInp = document.getElementById('res-inp-data');
  if (!dataInp) return;
  let host = document.getElementById('res-atalhos-data');
  if (!host) {
    host = document.createElement('div');
    host.id = 'res-atalhos-data';
    host.style.cssText = 'display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.45rem';
    dataInp.parentNode.appendChild(host);
  }
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  const hoje = new Date(hojeStr + 'T12:00:00');
  const amanha = new Date(hoje); amanha.setDate(amanha.getDate() + 1);
  const dep = new Date(hoje); dep.setDate(dep.getDate() + 2);
  const semana = new Date(hoje); semana.setDate(semana.getDate() + 7);
  const opts = [
    { label: 'Hoje', val: ymd(hoje) },
    { label: 'Amanhã', val: ymd(amanha) },
    { label: 'Depois de amanhã', val: ymd(dep) },
    { label: '+7 dias', val: ymd(semana) },
  ];
  host.innerHTML = '';
  // Listener (idempotente via flag)
  if (!_atalhosDataWired) {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-atalho-data]');
      if (!b) return;
      const inp = document.getElementById('res-inp-data');
      if (!inp) return;
      inp.value = b.dataset.atalhoData;
      inp.dispatchEvent(new Event('change'));
    });
    _atalhosDataWired = true;
  }
}

// Recalcula hora_fim sempre que hora_inicio ou tratamento mudam.
// Wrapper: após QUALQUER recálculo (inclusive early-returns do core), re-renderiza
// os seletores de massoterapeuta — o filtro de conflito/recepção depende do
// intervalo completo, e o listener de hora-inicio renderiza ANTES do recálculo.
function calAtualizarHoraFim() {
  _calAtualizarHoraFimCore();
  _renderMassagistasModal();
  _renderMassagistasModal2();
}
function _calAtualizarHoraFimCore() {
  const inicio = document.getElementById('res-inp-hora-inicio').value;
  const trat = document.getElementById('res-inp-tratamento');
  const tratObj  = _tratSelecionado();
  const tratObj2 = _isCasal() ? (_tratamentos.find(t => t.nome === document.getElementById('res-inp-tratamento2')?.value) || null) : null;
  const dur = Math.max(tratObj?.duracao_min || 0, tratObj2?.duracao_min || 0);
  const tempoEl = document.getElementById('res-tempo-val');
  const stripEl = document.getElementById('res-tempo-info');
  stripEl.style.borderColor = '';
  stripEl.style.background = '';

  // Renderiza box de combo + linha + preço
  _atualizarComboLinhaPreco();

  if (!inicio) { _resHoraInicio = null; _resHoraFim = null; tempoEl.textContent = '—'; return; }

  const iniMin = calTimeMin(inicio);
  if (iniMin < CAL_H_START * 60 || iniMin >= CAL_H_END * 60) {
    _resHoraInicio = inicio;
    _resHoraFim = null;
    tempoEl.innerHTML = `<span style="color:var(--danger);font-weight:600">⚠ ${inicio} fora do horário do spa (09:00–22:00)</span>`;
    stripEl.style.borderColor = 'var(--danger)';
    stripEl.style.background = 'var(--danger-dim)';
    return;
  }

  _resHoraInicio = inicio;

  if (_isEspBeleza()) {
    const hfManual = document.getElementById('res-inp-hora-fim-manual')?.value || '';
    if (!hfManual) {
      _resHoraFim = null;
      tempoEl.textContent = `início ${inicio} · informe a hora final`;
      return;
    }
    const fimMinM = calTimeMin(hfManual);
    if (fimMinM <= iniMin) {
      _resHoraFim = null;
      tempoEl.innerHTML = `<span style="color:var(--danger);font-weight:600">⚠ hora final deve ser maior que ${inicio}</span>`;
      stripEl.style.borderColor = 'var(--danger)';
      stripEl.style.background = 'var(--danger-dim)';
      return;
    }
    if (fimMinM > CAL_H_END * 60) {
      _resHoraFim = null;
      tempoEl.innerHTML = `<span style="color:var(--danger);font-weight:600">⚠ ${hfManual} ultrapassa fechamento do spa (${String(CAL_H_END).padStart(2,'0')}:00)</span>`;
      stripEl.style.borderColor = 'var(--danger)';
      stripEl.style.background = 'var(--danger-dim)';
      return;
    }
    _resHoraFim = hfManual;
    const durMin = fimMinM - iniMin;
    tempoEl.innerHTML = `${inicio} – ${_resHoraFim} <span style="color:var(--muted);font-weight:400;margin-left:.4rem">· ${durMin} min</span>`;
    _atualizarDisponibilidadeSalas();
    return;
  }

  if (!trat.value || !dur) {
    _resHoraFim = null;
    tempoEl.textContent = trat.value ? `${inicio} (tratamento sem duração)` : `início ${inicio} · selecione um tratamento`;
    _atualizarDisponibilidadeSalas();
    return;
  }

  const bloco = _blocoMinutos(dur);
  const fimMin = iniMin + bloco;
  if (fimMin > CAL_H_END * 60) {
    _resHoraFim = null;
    const horaFimExced = calMinTime(fimMin);
    tempoEl.innerHTML = `<span style="color:var(--danger);font-weight:600">⚠ Terminaria às ${horaFimExced} — spa fecha às ${String(CAL_H_END).padStart(2,'0')}:00</span>`;
    stripEl.style.borderColor = 'var(--danger)';
    stripEl.style.background = 'var(--danger-dim)';
    _atualizarDisponibilidadeSalas();
    return;
  }

  _resHoraFim = calMinTime(fimMin);
  tempoEl.innerHTML = `${inicio} – ${_resHoraFim} <span style="color:var(--muted);font-weight:400;margin-left:.4rem">· tratamento ${dur} min</span>`;
  _atualizarDisponibilidadeSalas();
}

// Atualiza UI auxiliar: combo (componentes), linha facial, preview de preço
function _atualizarComboLinhaPreco() {
  const t = _tratSelecionado();
  const wrap = document.getElementById('res-extra-info');
  if (!t) { wrap.innerHTML = ''; return; }

  let html = '';

  // Combo: exibir componentes inclusos
  if (t.tipo === 'combo' && t.componentes_nomes?.length) {
    html += `<div class="res-combo-box">
      <div class="res-combo-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        Combo · inclui automaticamente
      </div>
      <ul class="res-combo-list">
        ${t.componentes_nomes.map(n => `<li>${n}</li>`).join('')}
      </ul>
    </div>`;
  }

  // Linha facial: seletor
  if (t.linhas?.length) {
    html += `<div class="res-fg" style="margin-top:.6rem">
      <label>Linha do tratamento facial <span style="color:var(--danger)">*</span></label>
      <select id="res-inp-linha">
        <option value="">— Selecione a linha —</option>
        ${t.linhas.map(l => `<option value="${l}">${l}</option>`).join('')}
      </select>
    </div>`;
  }

  // Preço: subtotal + desconto GC + taxa serviço 10% + ISS 5% + total
  if (t.preco) {
    const sub = Number(t.preco);
    const aptoVal = document.getElementById('res-inp-apto')?.value?.replace(/\D/g,'') || '';
    const ehGC = _resTipo === 'hospede' && aptoVal.length === 4 && quartoCategoria(aptoVal) === 'gran_class' && t?.tipo !== 'combo';
    const desconto = ehGC ? sub * 0.10 : 0;
    const subDesc = sub - desconto;
    const taxaServ = subDesc * TAXA_SERVICO;
    const taxaIss  = subDesc * TAXA_ISS;
    const total = subDesc + taxaServ + taxaIss;
    const fmt = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    html += `<div class="res-preco-box">
      <div class="res-preco-row"><span>Subtotal</span><span>R$ ${fmt(sub)}</span></div>
      ${ehGC ? `<div class="res-preco-row" style="color:#9C5843"><span>★ Gran Class (−10%)</span><span>−R$ ${fmt(desconto)}</span></div>` : ''}
      <div class="res-preco-row"><span>Taxa de serviço (10%)</span><span>R$ ${fmt(taxaServ)}</span></div>
      <div class="res-preco-row"><span>ISS (5%)</span><span>R$ ${fmt(taxaIss)}</span></div>
      <div class="res-preco-row total"><span>Total</span><span>R$ ${fmt(total)}</span></div>
    </div>`;
  }

  wrap.innerHTML = html;
}

// Detecta conflito local (sala ou profissional).
// novaCasal: indica se a NOVA reserva sendo criada/editada eh casal.
// Regra de cruzamento entre salas 3 e 4: ha conflito se a nova reserva
// for casal OU a reserva existente for casal. Duas individuais em 3 e 4
// no mesmo horario sao permitidas (espacos independentes).
function calDetectarConflito(sala, massagistaId, data, horaInicio, horaFim, excluirId, novaCasal) {
  const conflitoSala = _reservas.find(r => {
    if (r.id === excluirId) return false;
    if (r.data !== data) return false;
    if (r.hora_fim <= horaInicio || r.hora_inicio >= horaFim) return false;
    if (r.sala === sala) return true;
    if ((sala === 3 || sala === 4) && (r.sala === 3 || r.sala === 4)) {
      return !!novaCasal || isReservaCasal(r);
    }
    return false;
  });
  if (conflitoSala) return { tipo: 'sala', reserva: conflitoSala };
  // Profissional
  if (massagistaId) {
    const conflitoProf = _reservas.find(r =>
      r.massagista_id === massagistaId &&
      r.data === data &&
      r.id !== excluirId &&
      !(r.hora_fim <= horaInicio || r.hora_inicio >= horaFim)
    );
    if (conflitoProf) return { tipo: 'massagista', reserva: conflitoProf };
  }
  return null;
}

function calMostrarConflito(info) {
  const tipo = info.tipo;
  const c = info.reserva;
  const sala = CAL_ROOMS.find(r => r.id === c.sala);
  const prof = _massagistasModal.find(m => m.id === c.massagista_id);
  const tituloEl = document.querySelector('.conflito-title');
  const msgEl = document.querySelector('.conflito-msg');
  if (tipo === 'massagista') {
    tituloEl.textContent = 'Massoterapeuta ocupada';
    msgEl.textContent = 'Esta profissional já está em outro atendimento neste horário. Escolha outro horário ou outra profissional.';
  } else {
    tituloEl.textContent = 'Sala indisponível';
    msgEl.textContent = 'Esta sala já está reservada neste horário. Não é possível ter duas sessões na mesma sala ao mesmo tempo.';
  }
  document.getElementById('conflito-info').innerHTML = `
    ${tipo === 'massagista' && prof ? `<div class="conflito-card-row"><span class="conflito-card-label">Profissional</span><span class="conflito-card-val" style="font-family:inherit">${escHtml(prof.nome)}</span></div>` : ''}
    <div class="conflito-card-row"><span class="conflito-card-label">Sala</span><span class="conflito-card-val">${sala ? escHtml(sala.nome) : 'Sala ' + c.sala}</span></div>
    <div class="conflito-card-row"><span class="conflito-card-label">Data</span><span class="conflito-card-val">${calFmtData(c.data)}</span></div>
    <div class="conflito-card-row"><span class="conflito-card-label">Horário ocupado</span><span class="conflito-card-val">${c.hora_inicio} – ${c.hora_fim}</span></div>
    <div class="conflito-card-row"><span class="conflito-card-label">Cliente</span><span class="conflito-card-val" style="font-family:inherit">${escHtml(c.cliente)}</span></div>
  `;
  _modalOpen = true;
  document.getElementById('conflito-overlay').classList.add('aberto');
}

function _iniciais(nome) {
  if (!nome?.trim()) return '?';
  const p = nome.trim().split(/\s+/);
  return (p[0][0] + (p[1]?.[0] || '')).toUpperCase();
}

function _massagistaDetHtml(r) {
  if (!r.massagista_id) return '<span class="resdet-kv-val empty">não informada</span>';
  const m = _massagistasModal.find(x => x.id === r.massagista_id);
  if (!m) {
    const nome = r.massagista_nome || null;
    return nome
      ? `<span class="resdet-kv-val">${escHtml(nome)}</span>`
      : `<span class="resdet-kv-val" style="color:var(--muted)">#${r.massagista_id}</span>`;
  }
  const badges = [];
  if (m.bilingue) badges.push('<span style="background:rgba(91,103,150,.12);color:var(--indigo);padding:.1rem .45rem;border-radius:999px;font-size:.67rem;font-weight:600;margin-left:.35rem">Bilíngue</span>');
  if (m.vinculo)  badges.push(`<span style="background:var(--gold-dim);color:var(--gold-dark);padding:.1rem .45rem;border-radius:999px;font-size:.67rem;font-weight:600;margin-left:.3rem">${escHtml(m.vinculo)}</span>`);
  return `<span class="resdet-kv-val">${escHtml(m.nome)}${badges.join('')}</span>`;
}

function _massagistaDetHtml2(r) {
  if (!r.massagista_id2) return '<span class="resdet-kv-val empty">não informada</span>';
  const m = _massagistasModal.find(x => x.id === r.massagista_id2);
  if (!m) {
    const nome = r.massagista_nome2 || null;
    return nome
      ? `<span class="resdet-kv-val">${escHtml(nome)}</span>`
      : `<span class="resdet-kv-val" style="color:var(--muted)">#${r.massagista_id2}</span>`;
  }
  const badges = [];
  if (m.bilingue) badges.push('<span style="background:rgba(91,103,150,.12);color:var(--indigo);padding:.1rem .45rem;border-radius:999px;font-size:.67rem;font-weight:600;margin-left:.35rem">Bilíngue</span>');
  if (m.vinculo)  badges.push(`<span style="background:var(--gold-dim);color:var(--gold-dark);padding:.1rem .45rem;border-radius:999px;font-size:.67rem;font-weight:600;margin-left:.3rem">${escHtml(m.vinculo)}</span>`);
  return `<span class="resdet-kv-val">${escHtml(m.nome)}${badges.join('')}</span>`;
}

// Helper: bloco de preco com taxa serviço 10% + ISS 5% e, se gran_class,
// aplica 10% de desconto antes das taxas. Compartilhado pessoa 1 e pessoa 2.
function _precoBloco(tm, ehGC) {
  if (!tm?.preco) return '';
  const sub = Number(tm.preco);
  const desconto = ehGC ? sub * 0.10 : 0;
  const subDescontado = sub - desconto;
  const taxaServ = subDescontado * TAXA_SERVICO;
  const taxaIss  = subDescontado * TAXA_ISS;
  const total = subDescontado + taxaServ + taxaIss;
  const fmt = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let h = `<div style="border-top:1px dashed var(--border);margin-top:.5rem;padding-top:.6rem">`;
  h += `<div class="resdet-kv"><div class="resdet-kv-label">Subtotal</div><div class="resdet-kv-val mono">R$ ${fmt(sub)}</div></div>`;
  if (ehGC) {
    h += `<div class="resdet-kv"><div class="resdet-kv-label" style="color:#9C5843">★ Gran Class (−10%)</div><div class="resdet-kv-val mono" style="color:#9C5843">−R$ ${fmt(desconto)}</div></div>`;
  }
  h += `<div class="resdet-kv"><div class="resdet-kv-label">Taxa de serviço (10%)</div><div class="resdet-kv-val mono">R$ ${fmt(taxaServ)}</div></div>`;
  h += `<div class="resdet-kv"><div class="resdet-kv-label">ISS (5%)</div><div class="resdet-kv-val mono">R$ ${fmt(taxaIss)}</div></div>`;
  h += `<div class="resdet-kv" style="border-bottom:none"><div class="resdet-kv-label" style="font-weight:700;color:var(--text)">Total</div><div class="resdet-kv-val mono gold" style="font-size:1rem">R$ ${fmt(total)}</div></div>`;
  h += `</div>`;
  return h;
}

function _precoDetHtml(r) {
  const tm = _tratamentos.find(t => t.id === r.tipo_massagem_id || t.nome === r.tratamento);
  const ehGC = r.quarto_categoria === 'gran_class' && tm?.tipo !== 'combo';
  let out = '';
  if (tm?.tipo === 'combo' && tm.componentes_nomes?.length) {
    out += `<div class="resdet-kv"><div class="resdet-kv-label">Inclusos</div><div class="resdet-kv-val">${tm.componentes_nomes.map(n => `<span style="display:inline-block;background:var(--gold-dim);color:var(--gold-dark);padding:.12rem .5rem;border-radius:999px;font-size:.75rem;font-weight:500;margin:.1rem .2rem .1rem 0">${n}</span>`).join('')}</div></div>`;
  }
  out += _precoBloco(tm, ehGC);
  return out;
}

function _precoDetHtml2(r) {
  const tm = _tratamentos.find(t => t.id === r.tipo_massagem_id2 || t.nome === r.tratamento2);
  // GC vale tanto pra pessoa 1 quanto 2 (quarto e' do casal)
  const ehGC = r.quarto_categoria === 'gran_class' && tm?.tipo !== 'combo';
  return _precoBloco(tm, ehGC);
}

function _precoV2(tm, ehGC) {
  if (!tm?.preco) return '';
  const sub = Number(tm.preco);
  const desconto = ehGC ? sub * 0.10 : 0;
  const sd = sub - desconto;
  const taxaServ = sd * TAXA_SERVICO;
  const taxaIss = sd * TAXA_ISS;
  const total = sd + taxaServ + taxaIss;
  const fmt = v => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  let h = '<div class="rd2-fin">';
  h += `<div class="rd2-fin-row"><span class="rd2-fin-lbl">Subtotal</span><span class="rd2-fin-val">${fmt(sub)}</span></div>`;
  if (ehGC) h += `<div class="rd2-fin-row desconto"><span class="rd2-fin-lbl">★ Gran Class (−10%)</span><span class="rd2-fin-val">−${fmt(desconto)}</span></div>`;
  h += `<div class="rd2-fin-row"><span class="rd2-fin-lbl">Taxa de serviço (10%)</span><span class="rd2-fin-val">${fmt(taxaServ)}</span></div>`;
  h += `<div class="rd2-fin-row"><span class="rd2-fin-lbl">ISS (5%)</span><span class="rd2-fin-val">${fmt(taxaIss)}</span></div>`;
  h += `<div class="rd2-fin-row total"><span class="rd2-fin-lbl">Total</span><span class="rd2-fin-val">${fmt(total)}</span></div>`;
  h += '</div>';
  return h;
}

function _comboPillsV2(tm) {
  if (!tm || tm.tipo !== 'combo' || !tm.componentes_nomes?.length) return '';
  return '<div class="rd2-pills">' + tm.componentes_nomes.map(n => `<span class="rd2-pill">${escHtml(n)}</span>`).join('') + '</div>';
}

// Modal de beneficios Gran Class — popup ao clicar no badge na agenda
// ou nos detalhes da reserva.
function _abrirModalGranClass() {
  if (document.getElementById('_gc-modal')) return;
  const ov = document.createElement('div');
  ov.id = '_gc-modal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.72);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  const card = [
    { icon: '🏆', title: '10% de desconto em todas as massagens', desc: 'Aplicado automaticamente sobre o subtotal antes da taxa de serviço.' },
    { icon: '🔥', title: 'Sauna liberada gratuitamente',         desc: 'Acesso livre durante toda a estadia, sem custo adicional.' },
    { icon: '💧', title: 'Jacuzzi liberada gratuitamente',       desc: 'Acesso livre durante toda a estadia, sem custo adicional.' },
  ].map(b => `
    <li style="display:flex;gap:.85rem;align-items:flex-start;padding:.75rem 1rem;background:#F5EEE2;border-radius:10px">
      <span style="font-size:1.35rem;line-height:1.1;flex-shrink:0">${b.icon}</span>
      <div>
        <div style="font-weight:700;color:#202C28;font-size:.92rem;line-height:1.3">${b.title}</div>
        <div style="font-size:.76rem;color:#5A4A3A;margin-top:.22rem;line-height:1.45">${b.desc}</div>
      </div>
    </li>`).join('');
  ov.innerHTML = `
    <div style="background:#ECE4D2;border-radius:14px;max-width:440px;width:100%;padding:1.8rem 1.75rem 1.4rem;box-shadow:0 28px 70px rgba(0,0,0,.45);position:relative">
      <button data-act="close" style="position:absolute;top:.75rem;right:.85rem;background:none;border:none;color:#7A6A5A;font-size:1.1rem;cursor:pointer;line-height:1;padding:.25rem .4rem;border-radius:6px" aria-label="Fechar">✕</button>
      <div style="text-align:center;margin-bottom:1.35rem">
        <div style="font-size:1.9rem;color:#7A4334;margin-bottom:.3rem">★</div>
        <h2 style="margin:0;font-family:'Cormorant Garamond',Georgia,serif;font-weight:600;font-size:1.75rem;color:#202C28;letter-spacing:-.01em">Benefícios Gran Class</h2>
        <p style="margin:.35rem 0 0;color:#7A6A5A;font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;font-weight:600">Cortesia exclusiva para hóspedes Gran Class</p>
      </div>
      <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.6rem">
        ${card}
      </ul>
      <div style="display:flex;justify-content:flex-end;margin-top:1.35rem">
        <button data-act="close" style="background:none;border:1.5px solid #9C5843;color:#7A4334;border-radius:7px;padding:.42rem 1.2rem;font-size:.78rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer">Fechar</button>
      </div>
    </div>
  `;
  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
  ov.addEventListener('click', e => { const t = e.target.closest('[data-act="close"]'); if (t || e.target === ov) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}
window._abrirModalGranClass = _abrirModalGranClass;

function calFmtData(ymd) {
  if (!ymd) return '—';
  const [y,m,d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

document.getElementById('conflito-ok').addEventListener('click', () => {
  _modalOpen = false;
  document.getElementById('conflito-overlay').classList.remove('aberto');
});
document.getElementById('conflito-overlay').addEventListener('click', e => {
  if (e.target.id === 'conflito-overlay') { _modalOpen = false; e.target.classList.remove('aberto'); }
});

// Snap defensivo: alguns browsers deixam o picker escolher valores fora do
// min/max declarado. Corrige o valor antes de qualquer outro handler.
function _snapHoraInicioAoRange(e) {
  const inp = e.target;
  if (!inp.value) return;
  const minStr = inp.min || '09:00';
  const maxStr = inp.max || '21:30';
  const toMin = s => { const [h,m] = String(s).split(':').map(Number); return (h||0)*60 + (m||0); };
  const v = toMin(inp.value);
  if (v < toMin(minStr)) {
    inp.value = minStr;
    if (typeof showToast === 'function') showToast(`Horário mínimo para essa data é ${minStr}.`);
  } else if (v > toMin(maxStr)) {
    inp.value = maxStr;
    if (typeof showToast === 'function') showToast(`Horário máximo é ${maxStr}.`);
  }
}
document.getElementById('res-inp-hora-inicio').addEventListener('input', _snapHoraInicioAoRange);
document.getElementById('res-inp-hora-inicio').addEventListener('change', _snapHoraInicioAoRange);
document.getElementById('res-inp-hora-inicio').addEventListener('input', calAtualizarHoraFim);
document.getElementById('res-inp-hora-inicio').addEventListener('change', calAtualizarHoraFim);
document.getElementById('res-inp-hora-fim-manual')?.addEventListener('input', calAtualizarHoraFim);
document.getElementById('res-inp-hora-fim-manual')?.addEventListener('change', calAtualizarHoraFim);
document.getElementById('res-inp-hora-inicio').addEventListener('change', () => { _renderMassagistasModal(); _renderMassagistasModal2(); _atualizarDisponibilidadeSalas(); });
document.getElementById('res-inp-data')?.addEventListener('change', () => { _ajustarHoraInicioBounds(); _renderMassagistasModal(); _renderMassagistasModal2(); _atualizarDisponibilidadeSalas(); });
document.getElementById('res-flt-bilingue')?.addEventListener('change', () => { _renderMassagistasModal(); _renderMassagistasModal2(); });
document.getElementById('res-inp-massagista').addEventListener('change', _renderMassagistasModal2);
// Botão ✕ do seletor (hid e input vazios) descarta também as extras do combo
document.getElementById('res-inp-massagista').addEventListener('change', () => {
  const hid = document.getElementById('res-inp-massagista');
  const inp = document.getElementById('res-cb-mass-inp');
  if (!hid?.value && !inp?.value && _resMassExtras.length) {
    _resMassExtras = [];
    _renderMassagistasModal();
  }
});
document.getElementById('res-inp-tratamento2').addEventListener('change', calAtualizarHoraFim);

// Modal de detalhes da reserva
async function calVerDetalhes(id) {
  // Refetch leve: garante que o estado de anamnese (enviada/respondida)
  // reflete o backend agora — captura mudancas feitas entre o ultimo
  // loadReservas() e este clique (ex: hospede preencheu).
  try {
    const r0 = await api(`/api/reservas/${id}/detalhe`);
    if (r0) {
      const d0 = await r0.json();
      if (d0?.ok && d0.reserva) {
        const idx = _reservas.findIndex(x => x.id === id);
        if (idx >= 0) Object.assign(_reservas[idx], d0.reserva);
        else _reservas.push(d0.reserva); // reserva criada apos ultimo loadReservas
      }
    }
  } catch {}
  const r = _reservas.find(x => x.id === id);
  if (!r) return;
  _resDetAtual = r;
  // Espaco Beleza (sala 5) nao tem anamnese nem pesquisa de satisfacao —
  // esconde os dois botoes no modal de detalhes. Salas 1-4 inalteradas.
  const ehEspBeleza = +r.sala === 5;
  const btnLib = document.getElementById('resdet-liberar');
  if (btnLib) {
    btnLib.style.display = ehEspBeleza ? 'none' : '';
    if (!ehEspBeleza) { btnLib.dataset.id = r.id; _aplicarEstadoLiberada(btnLib, _estadoBtnLiberar(r)); }
  }
  const btnFicha = document.getElementById('resdet-ficha');
  if (btnFicha) {
    btnFicha.style.display = ehEspBeleza ? 'none' : '';
    if (ehEspBeleza) _setFichaStatus('');
    if (!ehEspBeleza) {
      btnFicha.dataset.id = r.id;
      if (r.cliente2) {
        // Casal: botao unico abre popup distribuidor (estado por pessoa la dentro).
        btnFicha.disabled = false;
        btnFicha.textContent = 'ANAMNESE';
        btnFicha.dataset.action = 'abrir-anamnese-casal';
        btnFicha.dataset.estadoFicha = 'casal';
        delete btnFicha.dataset.pessoa;
        btnFicha.onclick = null;
        const _e1 = _estadoAnamnese(r, 1), _e2 = _estadoAnamnese(r, 2);
        const _nResp = [_e1, _e2].filter(e => e === 'respondida').length;
        if (_nResp === 2)      { btnFicha.textContent = 'Anamnese respondida'; _setFichaStatus(''); }
        else if (_nResp === 1) { btnFicha.textContent = 'Anamnese respondida (1/2)'; _setFichaStatus(''); }
        else if (_e1 === 'enviada' || _e2 === 'enviada') { btnFicha.textContent = 'ANAMNESE'; _setFichaStatus('Link gerado'); }
        else { btnFicha.textContent = 'ANAMNESE'; _setFichaStatus(''); }
      } else {
        _aplicarEstadoBtnFicha(btnFicha, _estadoFinalBtnFicha(r, 1));
      }
    }
  }
  const sala = CAL_ROOMS.find(s => s.id === r.sala);
  const salaName = sala ? sala.nome : `Sala ${r.sala}`;
  const salaCls = sala ? sala.cls : 's1';
  const salaTipo = r.cliente2 ? 'Casal · Sala 3+4' : (sala ? `${sala.tipo} · ${sala.cap} ${sala.cap > 1 ? 'pessoas' : 'pessoa'}` : '');
  const tipoCli = r.tipo_cliente === 'hospede' ? 'Hóspede' : (r.tipo_cliente === 'passante' ? 'Passante' : '—');
  const tipoCliCls = r.tipo_cliente === 'hospede' ? 'hospede' : 'passante';
  const dur = calTimeMin(r.hora_fim) - calTimeMin(r.hora_inicio);
  const _ehGCDet = r.quarto_categoria === 'gran_class' || isGranClassCli(r.quarto);
  document.getElementById('resdet-sub').innerHTML =
    `<span class="resdet-sala-badge ${salaCls}"><span class="resdet-sala-dot ${salaCls}"></span>${salaName}</span>` +
    `<span style="margin-left:.5rem;color:var(--muted);font-size:.76rem">${salaTipo}</span>` +
    (r.quarto ? `<span style="margin-left:.5rem;color:var(--muted);font-size:.76rem">· Quarto ${escHtml(r.quarto)}</span>` : '') +
    (_ehGCDet ? `<span style="margin-left:.5rem">${badgeGranClassHtml()}</span>` : '');

  const isCasal = !!r.cliente2;
  const _tm1 = _tratamentos.find(t => t.id === r.tipo_massagem_id || t.nome === r.tratamento);
  const _tm2 = isCasal ? _tratamentos.find(t => t.id === r.tipo_massagem_id2 || t.nome === r.tratamento2) : null;
  const _ehGC1 = _ehGCDet && _tm1?.tipo !== 'combo';
  const _ehGC2 = _ehGCDet && (_tm2?.tipo !== 'combo');
  const _combo1 = _comboPillsV2(_tm1);
  const _combo2 = _comboPillsV2(_tm2);
  const _fin1 = r.tipo_pagamento !== 'cortesia' ? _precoV2(_tm1, _ehGC1) : '';
  const _fin2 = r.tipo_pagamento !== 'cortesia' && isCasal ? _precoV2(_tm2, _ehGC2) : '';
  document.getElementById('resdet-body').innerHTML = `
    <div class="rd2-tl-wrap">
      <div class="rd2-tb">
        <div class="rd2-tv">${r.hora_inicio}</div>
        <div class="rd2-tl">início</div>
      </div>
      <div class="rd2-bridge">
        <div class="rd2-bridge-line"></div>
        <div class="rd2-bridge-dur">${dur} min</div>
      </div>
      <div class="rd2-tb rd2-tb-r">
        <div class="rd2-tv">${r.hora_fim}</div>
        <div class="rd2-tl">${calFmtData(r.data)}</div>
      </div>
    </div>

    ${isCasal ? '<div class="rd2-casal-div"><span>Pessoa 1</span></div>' : ''}

    <div class="rd2-sec">Cliente${isCasal ? ' 1' : ''}</div>
    <div class="rd2-cli-hd">
      <div class="resdet-avatar">${_iniciais(r.cliente)}</div>
      <div>
        <div class="rd2-cli-nome">${escHtml(r.cliente || '—')}</div>
        <div class="rd2-cli-meta">
          <span class="resdet-pill-tipo ${tipoCliCls}">${tipoCli}</span>
          ${r.apto ? `<span>· Apto ${escHtml(r.apto)}</span>` : ''}
          ${_ehGCDet && r.tipo_cliente === 'hospede' ? `<span style="color:var(--gold-dark);font-weight:600">· ★ Gran Class</span>` : ''}
        </div>
      </div>
    </div>
    ${r.email ? `<div class="rd2-row"><span class="rd2-lbl">E-mail</span><span class="rd2-val">${escHtml(r.email)}</span></div>` : ''}
    ${r.telefone ? `<div class="rd2-row"><span class="rd2-lbl">Telefone</span><span class="rd2-val mono">${escHtml(r.telefone)}</span></div>` : ''}
    ${r.cpf ? `<div class="rd2-row"><span class="rd2-lbl">CPF</span><span class="rd2-val mono">${escHtml(r.cpf)}</span></div>` : ''}
    ${r.passaporte ? `<div class="rd2-row"><span class="rd2-lbl">Passaporte</span><span class="rd2-val mono">${escHtml(r.passaporte)}</span></div>` : ''}
    ${r.nacionalidade ? `<div class="rd2-row"><span class="rd2-lbl">Nacionalidade</span><span class="rd2-val">${escHtml(r.nacionalidade)}</span></div>` : ''}
    ${r.idioma && r.idioma !== 'pt-BR' ? `<div class="rd2-row"><span class="rd2-lbl">Idioma</span><span class="rd2-val">${escHtml(r.idioma)}</span></div>` : ''}
    ${!r.email && !r.telefone ? `<div class="rd2-row"><span class="rd2-val empty">Sem contato informado</span></div>` : ''}

    <div class="rd2-sec">Tratamento${isCasal ? ' 1' : ''}</div>
    <div class="rd2-tx-nome">${r.tratamento ? escHtml(r.tratamento) : '<span style="font-style:italic;color:var(--muted)">não informado</span>'}</div>
    ${_combo1 ? `<div class="rd2-row"><span class="rd2-lbl">Inclusos</span><span class="rd2-val">${_combo1}</span></div>` : ''}
    ${r.linha ? `<div class="rd2-row"><span class="rd2-lbl">Linha</span><span class="rd2-val">${escHtml(r.linha)}</span></div>` : ''}
    <div class="rd2-row"><span class="rd2-lbl">Profissional</span>${_massagistaDetHtml(r)}</div>

    ${_fin1 ? `<div class="rd2-sec">Financeiro</div>${_fin1}` : ''}

    ${isCasal ? `
    <div class="rd2-casal-div"><span>Pessoa 2</span></div>
    <div class="rd2-sec">Cliente 2</div>
    <div class="rd2-cli-hd">
      <div class="resdet-avatar">${_iniciais(r.cliente2)}</div>
      <div>
        <div class="rd2-cli-nome">${escHtml(r.cliente2 || '—')}</div>
        <div class="rd2-cli-meta">
          <span class="resdet-pill-tipo ${r.tipo_cliente2 === 'hospede' ? 'hospede' : 'passante'}">${r.tipo_cliente2 === 'hospede' ? 'Hóspede' : 'Passante'}</span>
          ${r.apto2 ? `<span>· Apto ${escHtml(r.apto2)}</span>` : ''}
        </div>
      </div>
    </div>
    ${r.email2 ? `<div class="rd2-row"><span class="rd2-lbl">E-mail</span><span class="rd2-val">${escHtml(r.email2)}</span></div>` : ''}
    ${r.telefone2 ? `<div class="rd2-row"><span class="rd2-lbl">Telefone</span><span class="rd2-val mono">${escHtml(r.telefone2)}</span></div>` : ''}
    ${!r.email2 && !r.telefone2 ? `<div class="rd2-row"><span class="rd2-val empty">Sem contato informado</span></div>` : ''}
    <div class="rd2-sec">Tratamento 2</div>
    <div class="rd2-tx-nome">${r.tratamento2 ? escHtml(r.tratamento2) : '<span style="font-style:italic;color:var(--muted)">não informado</span>'}</div>
    ${_combo2 ? `<div class="rd2-row"><span class="rd2-lbl">Inclusos</span><span class="rd2-val">${_combo2}</span></div>` : ''}
    ${r.linha2 ? `<div class="rd2-row"><span class="rd2-lbl">Linha</span><span class="rd2-val">${escHtml(r.linha2)}</span></div>` : ''}
    <div class="rd2-row"><span class="rd2-lbl">Profissional</span>${_massagistaDetHtml2(r)}</div>
    ${_fin2 ? `<div class="rd2-sec">Financeiro 2</div>${_fin2}` : ''}
    ` : ''}

    ${r.tipo_pagamento === 'cortesia' ? `
    <div class="rd2-sec">Financeiro</div>
    <div class="rd2-cortesia-blk">
      <div class="rd2-cortesia-hd">🎁 Cortesia</div>
      ${r.cortesia_justificativa ? `<div class="rd2-row"><span class="rd2-lbl">Justificativa</span><span class="rd2-val">${escHtml(r.cortesia_justificativa)}</span></div>` : ''}
      ${r.cortesia_autorizado_por_nome ? `<div class="rd2-row" style="border-bottom:none"><span class="rd2-lbl">Autorizado por</span><span class="rd2-val">${escHtml(r.cortesia_autorizado_por_nome)}</span></div>` : ''}
    </div>` : ''}

    <div class="rd2-reg-strip">
      <span class="rd2-reg-item rd2-reg-id">#${r.id}</span>
      <span class="rd2-reg-dot"></span>
      <span class="rd2-reg-item">${r.criado_em ? fmtDataHoraBR(r.criado_em) : '—'}</span>
      <span class="rd2-reg-dot"></span>
      <span class="rd2-reg-item">${r.criado_por ? escHtml(r.criado_por) : '—'}</span>
    </div>
  `;

  const btnCancel = document.getElementById('resdet-cancelar-res');
  const inicioMs = new Date(`${r.data}T${r.hora_inicio}:00`).getTime();
  const cancelBloqueado = Date.now() > inicioMs + 30 * 60 * 1000;
  btnCancel.disabled = false;
  btnCancel.textContent = 'Cancelar Reserva';
  btnCancel.title = '';
  btnCancel.style.opacity = '';
  btnCancel.style.cursor = '';
  btnCancel.style.display = cancelBloqueado ? 'none' : '';
  btnCancel.onclick = cancelBloqueado ? null : () => {
    calCancelar(r.id, document.getElementById('resdet-overlay'));
  };
  const btnEditar = document.getElementById('resdet-editar-res');
  if (btnEditar) btnEditar.onclick = () => calAbrirEdicao(r);
  _modalOpen = true;
  document.getElementById('resdet-overlay').style.display = 'flex';
}
window.calVerDetalhes = calVerDetalhes;

async function calAbrirEdicao(r) {
  _modalOpen = false;
  document.getElementById('resdet-overlay').style.display = 'none';

  calOpenModal(r.sala, r.data, r.hora_inicio);
  _resEditandoId  = r.id;
  _resEditandoObj = r;

  const titleEl = document.getElementById('res-modal-title-txt');
  const subEl   = document.getElementById('res-modal-sub-txt');
  const btnSalvar = document.getElementById('btn-res-salvar');
  if (titleEl)   titleEl.textContent  = 'Editar Reserva';
  if (subEl)     subEl.textContent    = `Reserva #${r.id} — altere os campos desejados`;
  if (btnSalvar) btnSalvar.textContent = 'Salvar Alterações';

  // Editing allows past dates — remove the min restriction set by calOpenModal
  const dataInp = document.getElementById('res-inp-data');
  if (dataInp) { dataInp.min = ''; dataInp.value = r.data; }

  await Promise.all([loadTratamentosModal(), loadMassagistasModal()]);

  // tipo_cliente
  if (r.tipo_cliente) calSetTipo(r.tipo_cliente);

  // documento (CPF ou passaporte)
  const tipoDocSel = document.getElementById('res-sel-tipo-doc');
  if (tipoDocSel) {
    const td = r.passaporte ? 'passaporte' : 'cpf';
    tipoDocSel.value = td;
    tipoDocSel.dispatchEvent(new Event('change'));
    const cpfInp = document.getElementById('res-inp-cpf');
    if (cpfInp) {
      if (td === 'cpf' && r.cpf) {
        const c = r.cpf;
        cpfInp.value = c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') || c;
      } else {
        cpfInp.value = r.passaporte || '';
      }
    }
  }

  const _setV = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  _setV('res-inp-nome',          r.cliente   || '');
  _setV('res-inp-apto',          r.quarto    || r.apto || '');
  _setV('res-inp-email',         r.email     || '');
  _setV('res-inp-tel',           r.telefone  || '');
  _setV('res-inp-idioma',        r.idioma    || 'pt-BR');
  if (r.nacionalidade) _setV('res-inp-nacionalidade', resolverNacionalidade(r.nacionalidade, NACIONALIDADES));

  // hora_inicio já definida por calOpenModal; hora_fim: para Espaço Beleza definir manual
  if (+r.sala === 5 && r.hora_fim) {
    _setV('res-inp-hora-fim-manual', r.hora_fim);
    document.getElementById('res-inp-hora-fim-manual')?.dispatchEvent(new Event('change'));
  }

  // tratamento (combobox: set hidden + text + clear btn, dispatch change para calcular hora_fim)
  if (r.tratamento) {
    const hidTrat = document.getElementById('res-inp-tratamento');
    const txtTrat = document.getElementById('res-cb-trat-inp');
    const clrTrat = document.getElementById('res-cb-trat-clr');
    if (hidTrat) { hidTrat.value = r.tratamento; }
    if (txtTrat) { txtTrat.value = r.tratamento; }
    if (clrTrat) { clrTrat.style.display = ''; }
    if (hidTrat) hidTrat.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // linha (facial)
  if (r.linha) {
    const linhaEl = document.getElementById('res-inp-linha');
    if (linhaEl) linhaEl.value = r.linha;
  }

  // massagista (combobox) + extras do combo
  _resMassExtras = (() => {
    try {
      const a = JSON.parse(r.massagistas_extras || 'null');
      return Array.isArray(a) ? a.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
    } catch { return []; }
  })();
  if (r.massagista_id) {
    const mass = _massagistasModal.find(m => m.id === r.massagista_id);
    if (mass) {
      const hidMass = document.getElementById('res-inp-massagista');
      const txtMass = document.getElementById('res-cb-mass-inp');
      const clrMass = document.getElementById('res-cb-mass-clr');
      if (hidMass) { hidMass.value = mass.id; }
      if (txtMass) { txtMass.value = mass.nome; }
      if (clrMass) { clrMass.style.display = ''; }
      if (_resMassExtras.length) _massSyncInput();
      if (hidMass) hidMass.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // casal
  if (r.cliente2?.trim()) {
    const casalWrap = document.getElementById('res-casal-chk-wrap');
    const casalChk  = document.getElementById('res-chk-casal');
    if (casalWrap) casalWrap.style.display = '';
    if (casalChk) { casalChk.checked = true; casalChk.dispatchEvent(new Event('change')); }

    if (r.tipo_cliente2) calSetTipo2(r.tipo_cliente2);
    _setV('res2-inp-nome',   r.cliente2  || '');
    _setV('res2-inp-quarto', r.apto2     || '');
    _setV('res2-inp-email',  r.email2    || '');
    _setV('res2-inp-tel',    r.telefone2 || '');
    _setV('res2-inp-idioma', r.idioma2   || 'pt-BR');
    if (r.nacionalidade2) _setV('res2-inp-nacionalidade', resolverNacionalidade(r.nacionalidade2, NACIONALIDADES));

    if (r.tratamento2) {
      const hidTrat2 = document.getElementById('res-inp-tratamento2');
      const txtTrat2 = document.getElementById('res-cb-trat2-inp');
      const clrTrat2 = document.getElementById('res-cb-trat2-clr');
      if (hidTrat2) hidTrat2.value = r.tratamento2;
      if (txtTrat2) txtTrat2.value = r.tratamento2;
      if (clrTrat2) clrTrat2.style.display = '';
      if (hidTrat2) hidTrat2.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (r.massagista_id2) {
      const mass2 = _massagistasModal.find(m => m.id === r.massagista_id2);
      if (mass2) {
        const hidMass2 = document.getElementById('res-inp-massagista2');
        const txtMass2 = document.getElementById('res-cb-mass2-inp');
        const clrMass2 = document.getElementById('res-cb-mass2-clr');
        if (hidMass2) hidMass2.value = mass2.id;
        if (txtMass2) txtMass2.value = mass2.nome;
        if (clrMass2) clrMass2.style.display = '';
        if (hidMass2) hidMass2.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }
  // pagamento / cortesia
  if (r.tipo_pagamento === 'cortesia') {
    const _phid = document.getElementById('res-inp-tipo-pagamento');
    const _ppago = document.getElementById('res-pag-btn-pago');
    const _pcort = document.getElementById('res-pag-btn-cortesia');
    const _pcampos = document.getElementById('res-sec-cortesia-campos');
    if (_phid) _phid.value = 'cortesia';
    if (_ppago) _ppago.classList.remove('active');
    if (_pcort) _pcort.classList.add('active');
    if (_pcampos) _pcampos.style.display = 'flex';
    const _selTipoEdit = document.getElementById('res-sel-cortesia-tipo');
    if (_selTipoEdit && r.cortesia_justificativa) _selTipoEdit.value = r.cortesia_justificativa;
    _setV('res-inp-cortesia-autorizado-nome', r.cortesia_autorizado_por_nome || '');
    const _idHid = document.getElementById('res-inp-cortesia-autorizado-id');
    if (_idHid) _idHid.value = r.cortesia_autorizado_por || '';
    _resLoadHubCortesiaData(r.cortesia_justificativa || null);
  }
}

document.getElementById('resdet-x').addEventListener('click', () => { _modalOpen = false; document.getElementById('resdet-overlay').style.display = 'none'; });

// Modal idioma pré-massagem
async function _executarEnvioAnamnese() {
  const r = _resDetAtual;
  if (!r) return;
  try {
    // Envia { pessoa: N } se o fluxo foi disparado pelo popup casal pra
    // uma pessoa especifica. Senao envia {} (legado: casal gera ambos).
    const pessoaAlvo = (r.cliente2 && (_pessoaAnamneseAlvo === 1 || _pessoaAnamneseAlvo === 2)) ? _pessoaAnamneseAlvo : 0;
    const body = pessoaAlvo ? JSON.stringify({ pessoa: pessoaAlvo }) : '{}';
    const res = await api(`/api/reservas/${r.id}/gerar-ficha`, { method: 'POST', body });
    if (!res) { document.body.style.overflow = ''; return; }
    const d = await res.json();
    if (!d.ok) {
      document.body.style.overflow = '';
      if (d.error === 'tempo_expirado') {
        alert(d.message || 'Tempo para enviar anamnese expirado');
        _pessoaAnamneseAlvo = 0;
        return;
      }
      alert('Erro ao gerar ficha: ' + (d.error || ''));
      return;
    }

    const baseMsg = (nome, url) =>
      `Olá, *${nome || 'hóspede'}*! 😊\n\nPara prepararmos sua experiência no *Gran SPA by L'Occitane*, pedimos que preencha a ficha de saúde antes do seu tratamento:\n\n👉 ${url}\n\n*Hotel Gran Marquise* 🌿`;

    // ⚠️ MODO TEMPORARIO: nao marca para permitir reenvio.
    // _fichasEnviadas.add(r.id);

    // Atualiza estado local pra UI refletir sem refetch.
    // Backend setou expiry de 48h; copiamos pro cache.
    const _futExp = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    if (d.casal) {
      _resDetAtual.documento_token  = d.hospede1?.token || _resDetAtual.documento_token;
      _resDetAtual.documento_token2 = d.hospede2?.token || _resDetAtual.documento_token2;
      _resDetAtual.documento_token_expiry  = _futExp;
      _resDetAtual.documento_token_expiry2 = _futExp;
    } else {
      const p = d.pessoa || 1;
      if (p === 2) {
        _resDetAtual.documento_token2 = d.token;
        _resDetAtual.documento_token_expiry2 = _futExp;
      } else {
        _resDetAtual.documento_token = d.token;
        _resDetAtual.documento_token_expiry = _futExp;
      }
    }
    _pessoaAnamneseAlvo = 0;

    const btnFicha = document.getElementById('resdet-ficha');
    if (btnFicha && !_resDetAtual.cliente2) {
      _aplicarEstadoBtnFicha(btnFicha, _estadoFinalBtnFicha(_resDetAtual, 1));
    }

    if (d.casal) {
      // RESERVA CASAL: idioma por pessoa vem do cadastro da sessão.
      const h1 = d.hospede1, h2 = d.hospede2;
      const lang1 = (r.idioma  && LANGS_PRE.some(l => l.code === r.idioma))  ? r.idioma  : 'pt-BR';
      const lang2 = (r.idioma2 && LANGS_PRE.some(l => l.code === r.idioma2)) ? r.idioma2 : lang1;
      const url1 = `${h1.url}&lang=${lang1}`;
      const url2 = `${h2.url}&lang=${lang2}`;
      const msg1 = baseMsg(h1.nome, url1);
      const msg2 = baseMsg(h2.nome, url2);
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.72);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1.25rem;box-sizing:border-box';
      ov.innerHTML = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;max-width:520px;width:100%;padding:1.75rem 2rem;box-shadow:0 24px 64px rgba(0,0,0,.4);box-sizing:border-box">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:1.2rem;gap:.75rem">
            <div>
              <div style="font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);font-weight:600;margin-bottom:.3rem">Link gerado</div>
              <h3 style="margin:0;font-size:1.2rem;color:var(--text);line-height:1.25">Reserva CASAL — 2 links</h3>
            </div>
            <button data-act="close" style="background:none;border:1px solid var(--border-soft);cursor:pointer;color:var(--muted);font-size:.9rem;width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0">✕</button>
          </div>
          <p style="color:var(--muted);font-size:.82rem;margin:0 0 1.1rem 0;line-height:1.55">Cada hóspede tem seu próprio link. Envie separadamente por WhatsApp, e-mail ou copie o link.</p>
          ${[
            { idx: 1, h: h1, url: url1, msg: msg1, tel: h1.telefone },
            { idx: 2, h: h2, url: url2, msg: msg2, tel: h2.telefone },
          ].map(({ idx, h, url, msg, tel }) => {
            const tRaw = (tel || '').replace(/\\D/g, '');
            const tPhone = tRaw.startsWith('55') ? tRaw : '55' + tRaw;
            return `
              <div style="border:1px solid var(--border);border-radius:10px;padding:1rem 1.1rem;margin-bottom:.75rem">
                <div style="font-weight:600;font-size:.9rem;margin-bottom:.5rem;color:var(--text)">Hóspede ${idx}: ${escHtml(h.nome || '(sem nome)')}</div>
                <div style="font-size:.73rem;color:var(--muted);word-break:break-all;background:var(--bg);padding:.5rem .7rem;border-radius:7px;margin-bottom:.6rem;line-height:1.5;border:1px solid var(--border-soft)">${escHtml(url)}</div>
                <div style="display:flex;gap:.4rem;flex-wrap:wrap">
                  ${tRaw ? `<button class="btn btn-gold btn-sm" data-zap="${tPhone}" data-msg="${escHtml(msg)}">📱 WhatsApp</button>` : ''}
                  <button class="btn btn-outline btn-sm" data-copy="${escHtml(url)}">📋 Copiar link</button>
                </div>
              </div>
            `;
          }).join('')}
          <div style="display:flex;justify-content:flex-end;margin-top:.9rem">
            <button class="btn btn-outline" data-act="close">Fechar</button>
          </div>
        </div>
      `;
      const _confirmarFecharCasal = () => {
        const cf = document.createElement('div');
        cf.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.78);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:10001;display:flex;align-items:center;justify-content:center;padding:1.25rem;box-sizing:border-box';
        cf.innerHTML = `
          <div style="background:var(--surface);border:1px solid var(--gold);border-radius:14px;max-width:400px;width:100%;padding:1.75rem 2rem;box-shadow:0 24px 64px rgba(0,0,0,.5);box-sizing:border-box">
            <h4 style="margin:0 0 .6rem 0;font-family:var(--font);font-size:1.15rem;color:var(--text);text-align:center">Fechar sem enviar os dois?</h4>
            <p style="color:var(--muted);font-size:.82rem;line-height:1.55;margin:0 0 1.3rem 0;text-align:center">Os links já foram gerados. Se fechar agora sem enviar para os dois hóspedes, você pode perder o acesso rápido a eles.</p>
            <div style="display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap">
              <button class="btn btn-outline" data-cf="cancel">Continuar enviando</button>
              <button class="btn btn-danger" data-cf="ok">Fechar mesmo assim</button>
            </div>
          </div>
        `;
        cf.addEventListener('click', e => {
          const val = e.target.closest('[data-cf]')?.dataset.cf;
          if (val === 'cancel') cf.remove();
          else if (val === 'ok') { document.body.style.overflow = ''; cf.remove(); ov.remove(); }
        });
        document.body.appendChild(cf);
      };
      ov.addEventListener('click', e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        const zapEl = e.target.closest('[data-zap]');
        const copyEl = e.target.closest('[data-copy]');
        if (act === 'close') _confirmarFecharCasal();
        else if (zapEl) window.open(`https://wa.me/${zapEl.dataset.zap}?text=${encodeURIComponent(zapEl.dataset.msg)}`, '_blank');
        else if (copyEl) { try { navigator.clipboard.writeText(copyEl.dataset.copy); showToast('Link copiado!'); } catch {} }
      });
      document.body.appendChild(ov);
    } else {
      // RESERVA INDIVIDUAL: modal com WhatsApp + Copiar link.
      const p = d.pessoa || 1;
      const nomeHosp = p === 2 ? (r.cliente2 || r.cliente) : r.cliente;
      const telHosp  = p === 2 ? (r.telefone2 || r.telefone) : r.telefone;
      const langInd  = (() => {
        const raw = p === 2 ? (r.idioma2 || r.idioma) : r.idioma;
        return (raw && LANGS_PRE.some(l => l.code === raw)) ? raw : 'pt-BR';
      })();
      const url     = `${d.baseUrl}?t=${d.token}&lang=${langInd}`;
      const rawTel  = (telHosp || '').replace(/\D/g, '');
      const phone   = rawTel.startsWith('55') ? rawTel : '55' + rawTel;
      const msg     = baseMsg(nomeHosp, url);
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.65);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1.25rem;box-sizing:border-box';
      ov.innerHTML = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;max-width:460px;width:100%;padding:1.75rem 2rem;box-shadow:0 24px 64px rgba(0,0,0,.38);box-sizing:border-box">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:1.25rem;gap:.75rem">
            <div>
              <div style="font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);font-weight:600;margin-bottom:.3rem">Link gerado</div>
              <h3 style="margin:0;font-size:1.2rem;color:var(--text);line-height:1.25">${escHtml(nomeHosp || 'Hóspede')}</h3>
            </div>
            <button data-act="close" style="background:none;border:1px solid var(--border-soft);cursor:pointer;color:var(--muted);font-size:.9rem;width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0">✕</button>
          </div>
          <div style="font-size:.73rem;color:var(--muted);word-break:break-all;background:var(--bg);padding:.6rem .8rem;border-radius:8px;margin-bottom:1.2rem;line-height:1.5;border:1px solid var(--border-soft)">${escHtml(url)}</div>
          <p style="font-size:.8rem;color:var(--muted);margin:0 0 1.1rem 0;line-height:1.55">Escolha como enviar o link ao hóspede:</p>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1.25rem">
            ${rawTel ? `<button class="btn btn-gold" data-zap="${escHtml(phone)}" data-msg="${escHtml(msg)}">📱 WhatsApp</button>` : ''}
            <button class="btn btn-outline" data-copy="${escHtml(url)}">📋 Copiar link</button>
          </div>
          <div style="display:flex;justify-content:flex-end">
            <button class="btn btn-outline btn-sm" data-act="close">Fechar</button>
          </div>
        </div>
      `;
      ov.addEventListener('click', e => {
        const act    = e.target.closest('[data-act]')?.dataset.act;
        const zapEl  = e.target.closest('[data-zap]');
        const copyEl = e.target.closest('[data-copy]');
        if (act === 'close') { document.body.style.overflow = ''; ov.remove(); }
        else if (zapEl)  window.open(`https://wa.me/${zapEl.dataset.zap}?text=${encodeURIComponent(zapEl.dataset.msg)}`, '_blank');
        else if (copyEl) { try { navigator.clipboard.writeText(copyEl.dataset.copy); showToast('Link copiado!'); } catch {} }
        // backdrop click: nada
      });
      document.body.appendChild(ov);
    }
  } catch (err) {
    document.body.style.overflow = '';
    console.error('[_executarEnvioAnamnese]', err);
    alert('Erro inesperado ao gerar ficha. Tente novamente.');
  }
}

function calCloseModal(){
  _modalOpen = false;
  document.getElementById('res-modal-overlay').style.display='none';
  _resSala=null;
  if (_resEditandoId !== null) {
    const _objDetalhe = _resEditandoObj;
    _resEditandoId  = null;
    _resEditandoObj = null;
    const titleEl = document.getElementById('res-modal-title-txt');
    const subEl   = document.getElementById('res-modal-sub-txt');
    const btnSalvar = document.getElementById('btn-res-salvar');
    if (titleEl)   titleEl.textContent  = 'Novo Atendimento';
    if (subEl)     subEl.textContent    = 'Preencha os dados para confirmar o atendimento';
    if (btnSalvar) btnSalvar.textContent = 'Confirmar Atendimento';
    const dataInp = document.getElementById('res-inp-data');
    if (dataInp) {
      const _ft = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
      dataInp.min = _ft.getFullYear() + '-' + String(_ft.getMonth()+1).padStart(2,'0') + '-' + String(_ft.getDate()).padStart(2,'0');
    }
    // Volta ao modal de detalhes em vez de fechar para o painel
    if (_objDetalhe) calVerDetalhes(_objDetalhe);
    return;
  }
}

document.getElementById('btn-nova-reserva').addEventListener('click',()=>calOpenModal(1,_calDiaSel?calDateStr(_calDiaSel):null,'09:00'));
document.getElementById('btn-res-x').addEventListener('click',calCloseModal);
document.getElementById('btn-res-cancelar').addEventListener('click',calCloseModal);

function _syncCasalUI() {
  const casal = _isCasal();
  const sec2  = document.getElementById('res-sec-pessoa2');
  const sep1  = document.getElementById('res-sep-pessoa1');
  const wrap1 = document.getElementById('res-pessoa1-wrap');
  if (sec2)  sec2.style.display  = casal ? '' : 'none';
  if (sep1)  sep1.style.display  = casal ? '' : 'none';
  if (wrap1) wrap1.classList.toggle('casal-ativo', casal);
}

document.querySelectorAll('[data-tipo-res]').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('[data-tipo-res]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _selecionarSalaAutomatica(btn.dataset.tipoRes);
}));

document.querySelectorAll('.res-room-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    _resSala=+btn.dataset.sala;
    document.querySelectorAll('.res-room-btn').forEach(b=>b.classList.toggle('active',b===btn));
    const casalWrap = document.getElementById('res-casal-chk-wrap');
    const casalChk  = document.getElementById('res-chk-casal');
    const isSalaCasal = (_resSala === 3 || _resSala === 4);
    if (casalWrap) casalWrap.style.display = isSalaCasal ? '' : 'none';
    if (!isSalaCasal && casalChk) {
      casalChk.checked = false;
      // limpa pessoa 2 se estava ativa
      if (_cbTrat2) _cbTrat2.clear();
      if (_cbMass2) _cbMass2.clear();
      _resTipo2 = null;
      document.querySelectorAll('[data-tipo2]').forEach(b => b.classList.remove('active'));
      ['res2-inp-cpf','res2-inp-nome','res2-inp-quarto','res2-inp-email','res2-inp-tel'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      const _s2 = document.getElementById('res2-sel-tipo-doc'); if (_s2) { _s2.value='cpf'; _s2.dispatchEvent(new Event('change')); }
    }
    _aplicarVisibilidadeSala();
    _syncCasalUI();
    calAtualizarHoraFim();
  });
});

document.getElementById('res-chk-casal')?.addEventListener('change', () => {
  if (!_isCasal()) {
    // Desmarcou: limpa pessoa 2
    if (_cbTrat2) _cbTrat2.clear();
    if (_cbMass2) _cbMass2.clear();
    _resTipo2 = null;
    document.querySelectorAll('[data-tipo2]').forEach(b => b.classList.remove('active'));
    ['res2-inp-cpf','res2-inp-nome','res2-inp-quarto','res2-inp-email','res2-inp-tel'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const _s2 = document.getElementById('res2-sel-tipo-doc'); if (_s2) { _s2.value='cpf'; _s2.dispatchEvent(new Event('change')); }
    const _cpf2Info = document.getElementById('res2-cpf-info');
    if (_cpf2Info) { _cpf2Info.style.display = 'none'; _cpf2Info.textContent = ''; }
  }
  _syncCasalUI();
});

document.querySelectorAll('.res-tipo-btn[data-tipo]').forEach(btn=>{
  btn.addEventListener('click',()=>calSetTipo(btn.dataset.tipo));
});

// ── Cortesia Hub integration ──────────────────────────────────────────────────
let _resHubTipos = null, _resHubAutorizados = null;

async function _resLoadHubCortesiaData(currentJust) {
  if (_resHubTipos === null) {
    try {
      const HUB = 'https://hub-granmarquise.fly.dev';
      const [rT, rA] = await Promise.all([
        fetch(`${HUB}/api/pub/tipos-cortesia`).then(r => r.json()),
        fetch(`${HUB}/api/pub/cortesia-autorizados`).then(r => r.json())
      ]);
      _resHubTipos = rT.ok ? rT.tipos : [];
      _resHubAutorizados = rA.ok ? rA.autorizados : [];
    } catch { _resHubTipos = null; _resHubAutorizados = null; }
  }
  _resRenderCortesiaChips(currentJust);
}

function _resRenderCortesiaChips(currentJust) {
  const sel = document.getElementById('res-sel-cortesia-tipo');
  if (!sel) return;
  if (!_resHubTipos || !_resHubTipos.length) {
    sel.innerHTML = '<option value="">Nenhum tipo cadastrado no Hub</option>';
    return;
  }
  sel.innerHTML = '<option value="">Selecione o tipo de cortesia…</option>' +
    _resHubTipos.map(t => `<option value="${t.nome}"${currentJust === t.nome ? ' selected' : ''}>${t.nome}</option>`).join('');
}

function _resInitCortesiaAC() {
  const inp = document.getElementById('res-inp-cortesia-autorizado-nome');
  const hid = document.getElementById('res-inp-cortesia-autorizado-id');
  const lista = document.getElementById('res-cortesia-ac-lista');
  if (!inp || !lista) return;
  inp.addEventListener('input', () => {
    if (hid) hid.value = '';
    const q = inp.value.toLowerCase().trim();
    if (!q || !_resHubAutorizados?.length) { lista.style.display = 'none'; return; }
    const hits = _resHubAutorizados.filter(a => (a.nome || '').toLowerCase().includes(q) || (a.email || '').toLowerCase().includes(q)).slice(0, 7);
    if (!hits.length) { lista.style.display = 'none'; return; }
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-card').trim() || '#1e2d29';
    lista.style.background = bg;
    lista.innerHTML = hits.map(a => `<div class="res-ac-item" data-email="${a.email}" data-nome="${a.nome || a.email}" style="padding:.45rem .75rem;cursor:pointer;font-size:.82rem;color:#ECE4D2;border-bottom:1px solid rgba(153,100,66,.15)"><b>${a.nome || a.email}</b> <span style="opacity:.5;font-size:.73rem">${a.email}</span></div>`).join('');
    lista.querySelectorAll('.res-ac-item').forEach(el => {
      el.addEventListener('mouseenter', () => el.style.background = 'rgba(153,100,66,.2)');
      el.addEventListener('mouseleave', () => el.style.background = '');
      el.addEventListener('click', () => { inp.value = el.dataset.nome; if (hid) hid.value = el.dataset.email; lista.style.display = 'none'; });
    });
    lista.style.display = 'block';
  });
  document.addEventListener('click', e => { if (e.target !== inp && !lista.contains(e.target)) lista.style.display = 'none'; }, true);
}

// Pagamento / Cortesia toggle
document.querySelectorAll('.res-tipo-btn[data-pag]').forEach(btn => {
  btn.addEventListener('click', () => {
    const pag = btn.dataset.pag;
    document.querySelectorAll('.res-tipo-btn[data-pag]').forEach(b => b.classList.toggle('active', b.dataset.pag === pag));
    const hid = document.getElementById('res-inp-tipo-pagamento');
    if (hid) hid.value = pag;
    const campos = document.getElementById('res-sec-cortesia-campos');
    if (campos) campos.style.display = pag === 'cortesia' ? 'flex' : 'none';
    if (pag === 'cortesia') _resLoadHubCortesiaData(null);
    if (pag === 'pago') {
      ['res-inp-cortesia-autorizado-nome','res-inp-cortesia-autorizado-id'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      const _selT = document.getElementById('res-sel-cortesia-tipo'); if (_selT) _selT.value = '';
      const _acL = document.getElementById('res-cortesia-ac-lista'); if (_acL) _acL.style.display = 'none';
    }
  });
});
_resInitCortesiaAC();

document.getElementById('res-inp-tratamento').addEventListener('change', calAtualizarHoraFim);

document.getElementById('btn-res-salvar').addEventListener('click',async()=>{
  const err=document.getElementById('res-modal-err');
  // Consome a flag de override JÁ NO INÍCIO: se qualquer validação abaixo
  // retornar cedo, a flag não vaza para um envio futuro não autorizado.
  const _overrideEnvio = _resOverrideRegra;
  _resOverrideRegra = false;
  err.textContent='';
  // Casal sempre grava na sala 3 (espaço unificado 3+4); individual usa sala escolhida
  const sala = _isCasal() ? 3 : _resSala;
  const tipo=_resTipo;
  const tipoDoc = document.getElementById('res-sel-tipo-doc')?.value || 'cpf';
  const _docRaw = document.getElementById('res-inp-cpf')?.value || '';
  const cpfInpVal = tipoDoc === 'cpf' ? _docRaw.replace(/\D/g, '') : _docRaw.trim().toUpperCase();
  const nome=document.getElementById('res-inp-nome').value.trim();
  const apto=document.getElementById('res-inp-apto').value.trim();
  const email=document.getElementById('res-inp-email').value.trim();
  const telefone=document.getElementById('res-inp-tel').value.trim();
  const tratamento=document.getElementById('res-inp-tratamento').value.trim();
  const data=document.getElementById('res-inp-data').value;
  const horaInicio=document.getElementById('res-inp-hora-inicio').value;
  if(!sala){err.textContent='Selecione uma sala.';return;}
  if(!cpfInpVal){err.textContent='Informe o documento do cliente (CPF ou Passaporte).';document.getElementById('res-inp-cpf')?.focus();return;}
  if(tipoDoc==='cpf'&&!validarCpfMod11(cpfInpVal)){err.textContent='CPF inválido.';document.getElementById('res-inp-cpf')?.focus();return;}
  if(tipoDoc==='passaporte'&&!validarPassaporte(cpfInpVal)){err.textContent='Passaporte inválido — use apenas letras e números (5–20 caracteres).';document.getElementById('res-inp-cpf')?.focus();return;}
  if(!tipo){err.textContent='Selecione o tipo de cliente (Hóspede ou Passante).';return;}
  if(!nome){err.textContent='Informe o nome do cliente.';return;}
  if(!email){err.textContent='Informe o e-mail.';return;}
  // Quarto: obrigatório se hóspede; se informado (mesmo passante), tem que existir.
  const quartoInpRaw = (document.getElementById('res-inp-apto')?.value || '').trim();
  const quartoInp = quartoInpRaw ? _normNumQuarto(quartoInpRaw) : '';
  if (tipo === 'hospede' && !quartoInp) {
    err.textContent='Informe o número do quarto (obrigatório para hóspedes).';
    document.getElementById('res-inp-apto')?.focus();
    return;
  }
  if (quartoInp && !quartoCategoria(quartoInp)) {
    err.textContent='Quarto inexistente. Confira o número (ex: 0501, 1401).';
    document.getElementById('res-inp-apto')?.focus();
    return;
  }
  // Telefone: aceita BR ou internacional, mas se digitado precisa ser válido.
  if (telefone) {
    const t = telefone.trim();
    let ok;
    if (t.startsWith('+')) { ok = t.slice(1).replace(/\D/g,'').length >= 8; }
    else { const d = t.replace(/\D/g,''); ok = d.length === 10 || d.length === 11; }
    if (!ok) { err.textContent='Telefone inválido. Use BR (85 99999-9999) ou internacional (+33 6 12 34 56 78).'; document.getElementById('res-inp-tel')?.focus(); return; }
  }
  if(!horaInicio){err.textContent='Informe a hora de início.';return;}
  if (_isEspBeleza()) {
    if (!_resHoraFim) { err.textContent='Informe a hora final (deve ser maior que a de início e dentro do expediente do spa).'; document.getElementById('res-inp-hora-fim-manual')?.focus(); return; }
  } else {
    if(!tratamento){err.textContent='Selecione o tratamento.';return;}
    if(!_resHoraFim){
      const _tObj = _tratSelecionado();
      err.textContent = (_tObj && !_tObj.duracao_min)
        ? 'O tratamento não possui duração definida. Configure a duração no cadastro de tratamentos.'
        : 'Horário inválido: o tratamento ultrapassaria o expediente do spa (fecha às 22:00).';
      return;
    }
  }
  if(!data){err.textContent='Informe a data.';return;}
  // Bloqueia agendamento no passado (só para novas reservas — edição permite datas passadas).
  if (!_resEditandoId) {
    const _agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
    const _hojeYMD = _agora.getFullYear() + '-' + String(_agora.getMonth()+1).padStart(2,'0') + '-' + String(_agora.getDate()).padStart(2,'0');
    if (data < _hojeYMD) {
      err.textContent = 'Não é possível agendar em data passada.';
      document.getElementById('res-inp-data')?.focus();
      return;
    }
    if (data === _hojeYMD) {
      const agoraHHMM = String(_agora.getHours()).padStart(2,'0') + ':' + String(_agora.getMinutes()).padStart(2,'0');
      if (horaInicio < agoraHHMM) {
        err.textContent = `Horário no passado. Agora são ${agoraHHMM} (Fortaleza) — agende a partir desse horário.`;
        document.getElementById('res-inp-hora-inicio')?.focus();
        return;
      }
    }
  }
  const iniMinSub = calTimeMin(horaInicio);
  if (iniMinSub < CAL_H_START*60 || iniMinSub >= CAL_H_END*60) {
    err.textContent = `Hora de início fora do expediente do spa (${String(CAL_H_START).padStart(2,'0')}:00–${String(CAL_H_END).padStart(2,'0')}:00).`;
    return;
  }
  if (calTimeMin(_resHoraFim) > CAL_H_END*60) {
    err.textContent = `O tratamento terminaria após o fechamento do spa às ${String(CAL_H_END).padStart(2,'0')}:00.`;
    return;
  }

  // Tratamento selecionado: pega ID + linha (se for facial) + valida
  const tratObj = _tratSelecionado();
  const tipoMassagemId = tratObj?.id || null;
  let linha = null;
  if (tratObj?.linhas?.length) {
    const linhaSel = document.getElementById('res-inp-linha');
    linha = linhaSel?.value || '';
    if (!linha) { err.textContent='Selecione a linha do tratamento facial (Immortelle ou Source Réotier).'; return; }
  }

  // Massoterapeuta obrigatória (exceto Espaço Beleza)
  const massagistaId = document.getElementById('res-inp-massagista')?.value ? +document.getElementById('res-inp-massagista').value : null;
  if (!_isEspBeleza() && !massagistaId) { err.textContent = 'Selecione a massoterapeuta que vai atender.'; return; }
  // Combo: massoterapeutas extras participam do mesmo tratamento.
  // Se _tratamentos não carregou (API fora), preserva as extras existentes —
  // senão um PUT de edição as apagaria silenciosamente do banco.
  const massagistasExtras = (_isComboTrat() || !_tratamentos.length) ? _resMassExtras.slice(0, 4) : [];

  // Casal: campos pessoa 2 — TODOS OPCIONAIS. Se NADA estiver preenchido,
  // pessoa 2 e' ignorada (sala 3 pode ser usada por uma pessoa so).
  // Se ALGUM campo for preenchido, valida o restante coerentemente.
  let cpf2 = null, tipoDoc2 = 'cpf', nome2 = null, tipo2 = null, apto2 = null, quarto2 = null, email2 = null, tel2 = null;
  let tratamento2 = null, tratObj2 = null, massagistaId2 = null, _p2Preenchida = false;
  if (_isCasal()) {
    tipoDoc2 = document.getElementById('res2-sel-tipo-doc')?.value || 'cpf';
    const _doc2Raw = document.getElementById('res2-inp-cpf')?.value || '';
    const cpf2InpVal = tipoDoc2 === 'cpf' ? _doc2Raw.replace(/\D/g,'') : _doc2Raw.trim().toUpperCase();
    nome2       = document.getElementById('res2-inp-nome')?.value.trim() || '';
    tipo2       = _resTipo2;
    const quarto2Raw = (document.getElementById('res2-inp-quarto')?.value || '').trim();
    quarto2     = quarto2Raw ? _normNumQuarto(quarto2Raw) : null;
    apto2       = quarto2;
    email2      = document.getElementById('res2-inp-email')?.value.trim() || null;
    tel2        = document.getElementById('res2-inp-tel')?.value.trim() || null;
    tratamento2 = document.getElementById('res-inp-tratamento2')?.value.trim() || '';
    tratObj2    = _tratamentos.find(t => t.nome === tratamento2) || null;
    massagistaId2 = document.getElementById('res-inp-massagista2')?.value ? +document.getElementById('res-inp-massagista2').value : null;
    _p2Preenchida = !!(cpf2InpVal || nome2 || email2 || tel2 || tratamento2 || massagistaId2 || quarto2);
    if (_p2Preenchida) {
      // Pessoa 2 preenchida → exige coerencia
      if (!cpf2InpVal) { err.textContent = 'Pessoa 2: informe o documento (CPF ou Passaporte).'; document.getElementById('res2-inp-cpf')?.focus(); return; }
      if (tipoDoc2==='cpf'&&!validarCpfMod11(cpf2InpVal)) { err.textContent = 'Pessoa 2: CPF inválido.'; document.getElementById('res2-inp-cpf')?.focus(); return; }
      if (tipoDoc2==='passaporte'&&!validarPassaporte(cpf2InpVal)) { err.textContent = 'Pessoa 2: passaporte inválido — use apenas letras e números (5–20 caracteres).'; document.getElementById('res2-inp-cpf')?.focus(); return; }
      if (cpfInpVal && cpf2InpVal === cpfInpVal) { err.textContent = 'Pessoa 1 e Pessoa 2 nao podem ter o mesmo documento.'; document.getElementById('res2-inp-cpf')?.focus(); return; }
      if (!nome2)       { err.textContent = 'Pessoa 2: informe o nome.'; return; }
      if (!tipo2)       { err.textContent = 'Pessoa 2: selecione tipo de cliente (Hospede ou Passante).'; return; }
      if (tipo2 === 'hospede' && !quarto2) { err.textContent = 'Pessoa 2: informe o quarto (obrigatorio para hospede).'; document.getElementById('res2-inp-quarto')?.focus(); return; }
      if (quarto2 && !quartoCategoria(quarto2)) { err.textContent = 'Pessoa 2: quarto inexistente.'; document.getElementById('res2-inp-quarto')?.focus(); return; }
      if (tel2) {
        const t = tel2.trim();
        let ok;
        if (t.startsWith('+')) ok = t.slice(1).replace(/\D/g,'').length >= 8;
        else { const d = t.replace(/\D/g,''); ok = d.length === 10 || d.length === 11; }
        if (!ok) { err.textContent = 'Pessoa 2: telefone invalido.'; document.getElementById('res2-inp-tel')?.focus(); return; }
      }
      if (!tratamento2)   { err.textContent = 'Pessoa 2: selecione o tratamento.'; return; }
      if (!massagistaId2) { err.textContent = 'Pessoa 2: selecione a massoterapeuta.'; return; }
      if (massagistaId2 === massagistaId) { err.textContent = 'As duas pessoas nao podem ter a mesma massoterapeuta.'; return; }
      cpf2 = cpf2InpVal;
    } else {
      // Nada preenchido: zera tudo (limpa null)
      cpf2 = null; nome2 = null; tipo2 = null; apto2 = null; quarto2 = null;
      email2 = null; tel2 = null; tratamento2 = null; tratObj2 = null; massagistaId2 = null;
    }
  }

  // Verificação local de conflito antes de bater no servidor
  const _novaCasal = _isCasal() && _p2Preenchida;
  const conflitoLocal = calDetectarConflito(sala, massagistaId, data, horaInicio, _resHoraFim, _resEditandoId || undefined, _novaCasal);
  if (conflitoLocal) { calMostrarConflito(conflitoLocal); return; }
  if (_p2Preenchida && massagistaId2) {
    const c2 = calDetectarConflito(sala, massagistaId2, data, horaInicio, _resHoraFim, _resEditandoId || null, _novaCasal);
    if (c2 && c2.tipo === 'massagista') { calMostrarConflito(c2); return; }
  }

  const btn=document.getElementById('btn-res-salvar');
  btn.disabled=true;
  try{
    const body = {
      sala, tipo_cliente: tipo, cliente: nome, apto, email, telefone, tratamento, data,
      hora_inicio: horaInicio, hora_fim: _resHoraFim,
      linha, tipo_massagem_id: tipoMassagemId, massagista_id: massagistaId,
      massagistas_extras: massagistasExtras,
      tipo_doc: tipoDoc, doc: cpfInpVal,
      quarto: quartoInp || null,
      idioma: document.getElementById('res-inp-idioma')?.value || null,
      nacionalidade: resolverNacionalidade(document.getElementById('res-inp-nacionalidade')?.value?.trim() || '', NACIONALIDADES) || null,
      tipo_pagamento: document.getElementById('res-inp-tipo-pagamento')?.value || 'pago',
      cortesia_justificativa: document.getElementById('res-sel-cortesia-tipo')?.value?.trim() || null,
      cortesia_autorizado_por: document.getElementById('res-inp-cortesia-autorizado-id')?.value?.trim() || null,
      cortesia_autorizado_por_nome: document.getElementById('res-inp-cortesia-autorizado-nome')?.value?.trim() || null,
    };
    // Override explícito (escala/recepção): flags auditadas no body como
    // decisão consciente do admin. Vale só para ESTE envio (consumida acima).
    if (_overrideEnvio) { body.override_escala = true; body.override_recepcao = true; }
    if (_isCasal() && _p2Preenchida) {
      Object.assign(body, {
        cliente2: nome2, tipo_cliente2: tipo2 || null, apto2, email2, telefone2: tel2,
        tratamento2, tipo_massagem_id2: tratObj2?.id || null, massagista_id2: massagistaId2,
        tipo_doc2: tipoDoc2, doc2: cpf2, quarto2,
        idioma2: document.getElementById('res2-inp-idioma')?.value || null,
        nacionalidade2: resolverNacionalidade(document.getElementById('res2-inp-nacionalidade')?.value?.trim() || '', NACIONALIDADES) || null,
      });
    }
    const _apiUrl    = _resEditandoId ? `/api/reservas/${_resEditandoId}` : '/api/reservas';
    const _apiMethod = _resEditandoId ? 'PUT' : 'POST';
    const res=await api(_apiUrl,{method:_apiMethod,body:JSON.stringify(body)});
    if(!res)return;
    const d=await res.json();
    if(!d.ok){
      // Fora da escala OU regra da recepção — override explícito do admin
      // ("Agendar mesmo assim"). A flag fica registrada na auditoria.
      if (res.status === 409 && (d.tipo === 'escala' || d.tipo === 'recepcao')) {
        const faixa = d.faixa ? ` (turno: ${d.faixa})` : '';
        const base = d.tipo === 'recepcao'
          ? (d.error || 'Regra da recepção: precisa sobrar ao menos uma massoterapeuta livre neste horário.')
          : (d.error || 'Massoterapeuta fora da escala nesta data/horário') + faixa + '. Escolha outro horário ou outra massoterapeuta.';
        err.innerHTML = `${escHtml(base)}<br><button type="button" id="btn-res-override" class="btn btn-danger" style="margin-top:.4rem">Agendar mesmo assim</button>`;
        document.getElementById('btn-res-override')?.addEventListener('click', () => {
          _resOverrideRegra = true;
          err.textContent = '';
          document.getElementById('btn-res-salvar')?.click();
        }, { once: true });
        return;
      }
      // Conflito detectado pelo servidor
      if (res.status === 409 && d.conflito) {
        calMostrarConflito({ tipo: d.tipo, reserva: { ...d.conflito, data, sala, massagista_id: massagistaId } });
        await loadReservas();
        return;
      }
      if (res.status === 409) {
        await loadReservas();
        const c = calDetectarConflito(sala, massagistaId, data, horaInicio, _resHoraFim, _resEditandoId || undefined, _novaCasal);
        if (c) { calMostrarConflito(c); return; }
      }
      err.textContent = d.error || 'Erro ao salvar.';
      return;
    }
    // Se o tratamento está marcado como "Espaço Beleza" e é uma nova reserva,
    // captura os dados antes de fechar o modal e exibe o popup de confirmação.
    const _tratBeleza = _tratSelecionado();
    const _dadosBeleza = _tratBeleza?.espaco_beleza && !_resEditandoId ? {
      nome: body.cliente,
      data: body.data,
      email: body.email,
      telefone: body.telefone || null,
      tipo_cliente: body.tipo_cliente,
      apto: body.apto || null,
      tipo_doc: body.tipo_doc,
      doc: body.doc,
      quarto: body.quarto || null,
      idioma: body.idioma || 'pt-BR',
      nacionalidade: body.nacionalidade || null,
    } : null;
    calCloseModal();
    loadReservas();
    if (_dadosBeleza) _abrirEspbPopup(_dadosBeleza);
  }finally{btn.disabled=false;}
});

// ── Espaço Beleza — popup pós-reserva ──────────────────────────────────────
let _espbDados = null;

function _abrirEspbPopup(dados) {
  _espbDados = dados;
  const [y, m, dia] = dados.data.split('-');
  document.getElementById('espb-popup-nome').textContent = dados.nome;
  document.getElementById('espb-popup-data').textContent = `${dia}/${m}/${y}`;
  document.getElementById('espb-err').textContent = '';
  document.getElementById('espb-overlay').style.display = 'flex';
}

function _fecharEspbPopup() {
  document.getElementById('espb-overlay').style.display = 'none';
  _espbDados = null;
}

document.getElementById('espb-btn-nao').addEventListener('click', () => {
  _fecharEspbPopup();
});

document.getElementById('espb-btn-sim').addEventListener('click', async () => {
  if (!_espbDados) return;
  const btn = document.getElementById('espb-btn-sim');
  const errEl = document.getElementById('espb-err');
  errEl.textContent = '';
  btn.disabled = true;
  try {
    // Bloqueio padrão começa às 09:00 — mas se a data é HOJE e já passou das
    // 09:00, o backend rejeita hora no passado ("Horário no passado. Agora
    // são HH:MM"). Nesse caso o bloqueio começa no próximo múltiplo de 5min.
    let _horaIniBeleza = '09:00';
    try {
      const _agoraFt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
      const _hojeFt = _agoraFt.getFullYear() + '-' + String(_agoraFt.getMonth()+1).padStart(2,'0') + '-' + String(_agoraFt.getDate()).padStart(2,'0');
      if (_espbDados.data === _hojeFt) {
        const _minAgora = _agoraFt.getHours()*60 + _agoraFt.getMinutes();
        const _prox = Math.ceil((_minAgora + 1) / 5) * 5;
        if (_prox >= 22*60) {
          errEl.textContent = 'O Espaço Beleza já encerrou por hoje (fecha às 22:00). Reserve para outra data.';
          return;
        }
        if (_prox > 9*60) _horaIniBeleza = String(Math.floor(_prox/60)).padStart(2,'0') + ':' + String(_prox%60).padStart(2,'0');
      }
    } catch {}
    const reservaBeleza = {
      sala: 5,
      tipo_cliente: _espbDados.tipo_cliente,
      cliente: _espbDados.nome,
      apto: _espbDados.apto || null,
      email: _espbDados.email,
      telefone: _espbDados.telefone || null,
      tratamento: 'Espaço Beleza',
      data: _espbDados.data,
      hora_inicio: _horaIniBeleza,
      hora_fim: '22:00',
      tipo_doc: _espbDados.tipo_doc,
      doc: _espbDados.doc,
      quarto: _espbDados.quarto || null,
      idioma: _espbDados.idioma || 'pt-BR',
      nacionalidade: _espbDados.nacionalidade || null,
    };
    const r = await api('/api/reservas', { method: 'POST', body: JSON.stringify(reservaBeleza) });
    if (r) {
      const d = await r.json();
      if (!d.ok) {
        errEl.textContent = r.status === 409
          ? 'Espaço Beleza já está reservado neste dia.'
          : (d.error || 'Não foi possível reservar o Espaço Beleza.');
        return;
      }
      loadReservas();
    }
    _fecharEspbPopup();
  } finally {
    btn.disabled = false;
  }
});

// ── Área Molhada — Day Use (Jacuzzi + Sauna) ─────────────────────────
const _AQ_TIPOS = ['hospede', 'passante', 'gran_class'];
const _AQ_PRECO = { hospede: 60 * 1.15, passante: 120 * 1.15, gran_class: 0 };
let _aqState   = {};  // { tipo: quantidade }
let _aqDate    = null;
let _aqSaving  = false;
let _aqLogCache = [];

function _aqGet(tipo) { return _aqState[tipo] || 0; }

function _aqFmt(v) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

function _aqRender() {
  let totPessoas = 0, totSubtotal = 0;
  for (const tipo of _AQ_TIPOS) {
    const qty = _aqGet(tipo);
    totPessoas += qty;
    totSubtotal += qty * (_AQ_PRECO_BASE[tipo] || 0);
    const elCount = document.getElementById(`aq-count-${tipo}`);
    if (elCount) {
      elCount.textContent = qty;
      elCount.className = 'aq-dw-count' + (qty > 0 ? ' nz' : '');
    }
    document.querySelector(`[data-aq-card="${tipo}"]`)?.classList.toggle('active', qty > 0);
    if (tipo !== 'gran_class') {
      const elSub = document.getElementById(`aq-sub-${tipo}`);
      if (elSub) {
        elSub.textContent = qty > 0 ? _aqFmt(qty * _AQ_PRECO[tipo]) : '—';
        elSub.className = 'aq-dw-sub' + (qty > 0 ? ' nz' : '');
      }
    }
  }
  const totTaxa = totSubtotal * 0.10;
  const totIss  = totSubtotal * 0.05;
  const totTotal = totSubtotal * 1.15;

  const elTot = document.getElementById('aq-tot-geral');
  if (elTot) elTot.textContent = `${totPessoas} pessoa${totPessoas !== 1 ? 's' : ''}`;
  const elFootRev = document.getElementById('aq-footer-revenue');
  if (elFootRev) elFootRev.textContent = totTotal > 0 ? _aqFmt(totTotal) : '—';
  const elChip = document.getElementById('aq-revenue-chip');
  if (elChip) {
    elChip.textContent = totTotal > 0 ? _aqFmt(totTotal) : '';
    elChip.style.display = totTotal > 0 ? '' : 'none';
  }
  const elPb = document.getElementById('aq-pb');
  if (elPb) elPb.classList.toggle('visible', totSubtotal > 0);
  const elPbSub  = document.getElementById('aq-pb-sub');
  const elPbTaxa = document.getElementById('aq-pb-taxa');
  const elPbIss  = document.getElementById('aq-pb-iss');
  if (elPbSub)  elPbSub.textContent  = totSubtotal > 0 ? _aqFmt(totSubtotal) : '—';
  if (elPbTaxa) elPbTaxa.textContent = totSubtotal > 0 ? _aqFmt(totTaxa)     : '—';
  if (elPbIss)  elPbIss.textContent  = totSubtotal > 0 ? _aqFmt(totIss)      : '—';
}

function _aqRenderDateBadge(ds) {
  const badge = document.getElementById('aq-date-badge');
  if (!badge || !ds) return;
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const todayStr = calDateStr(new Date());
  badge.textContent = ds === todayStr ? 'Hoje' : dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

async function loadUsoAquatico(ds) {
  if (!ds) return;
  _aqDate = ds;
  _aqRenderDateBadge(ds);
  const res = await api(`/api/reservas/uso-aquatico?data=${ds}`);
  if (!res) return;
  const d = await res.json();
  if (!d.ok) return;
  _aqState = {};
  for (const item of (d.items || [])) {
    if (item.equipamento === 'jacuzzi') _aqState[item.tipo_usuario] = item.quantidade;
  }
  _aqRender();
}

const _AQ_TIPO_LABEL = { hospede: 'Hóspede', passante: 'Passante', gran_class: 'Gran Class' };
const _AQ_PRECO_BASE = { hospede: 60, passante: 120, gran_class: 0 };
const _AQ_LOG_PREVIEW = 5;

function _aqLogRowHtml(item) {
  const delta = item.delta;
  const sign = delta > 0 ? '+' : '';
  const cls = delta > 0 ? 'pos' : 'neg';
  const label = _AQ_TIPO_LABEL[item.tipo_usuario] || item.tipo_usuario;
  const base = _AQ_PRECO_BASE[item.tipo_usuario] || 0;
  const valorFmt = item.tipo_usuario === 'gran_class'
    ? 'Gratuito'
    : _aqFmt(Math.abs(delta) * base * 1.15);
  const dt = new Date(item.registrado_em.replace(' ', 'T') + (item.registrado_em.includes('T') ? '' : 'Z'));
  const hora = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dia  = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const oper = item.operador || '—';
  return `<div class="aq-ledger-row">
    <span class="aq-ledger-delta ${cls}">${sign}${delta}</span>
    <div>
      <div class="aq-ledger-tipo">${label}</div>
      <div class="aq-ledger-oper">${oper}</div>
    </div>
    <div class="aq-ledger-valor">${valorFmt}</div>
    <div class="aq-ledger-meta">${hora}<br>${dia}</div>
  </div>`;
}

async function _aqLoadLog(ds) {
  const el = document.getElementById('aq-ledger-list');
  const moreBtn = document.getElementById('aq-ledger-more-btn');
  if (!el || !ds) return;
  const res = await api(`/api/reservas/uso-aquatico-log?data=${ds}`);
  if (!res) return;
  const d = await res.json();
  if (!d.ok || !d.items?.length) {
    el.innerHTML = '<div class="aq-ledger-empty">Sem registros para esta data</div>';
    moreBtn?.classList.remove('visible');
    _aqLogCache = [];
    return;
  }
  _aqLogCache = d.items;
  el.innerHTML = d.items.slice(0, _AQ_LOG_PREVIEW).map(_aqLogRowHtml).join('');
  if (moreBtn) {
    if (d.items.length > _AQ_LOG_PREVIEW) {
      moreBtn.textContent = `Ver todas as ${d.items.length} alterações →`;
      moreBtn.classList.add('visible');
    } else {
      moreBtn.classList.remove('visible');
    }
  }
}

function _aqOpenLogPopup() {
  if (document.getElementById('_aq-log-popup')) return;
  const ds = _aqDate || (_calDiaSel ? calDateStr(_calDiaSel) : calDateStr(new Date()));
  const [y, m, dv] = ds.split('-').map(Number);
  const dtStr = new Date(y, m - 1, dv).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const rows = _aqLogCache.map(_aqLogRowHtml).join('');
  const ov = document.createElement('div');
  ov.id = '_aq-log-popup';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.75);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  ov.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--gold);border-radius:14px;max-width:580px;width:100%;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 32px 80px rgba(0,0,0,.48)">
      <div style="padding:1.3rem 1.6rem 1.1rem;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;flex-shrink:0">
        <div>
          <div style="font-size:.64rem;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--gold);margin-bottom:.28rem">◆ Área Molhada · Day Use</div>
          <div style="font-weight:600;color:var(--text);font-size:1rem;line-height:1.3">Histórico de alterações</div>
          <div style="font-size:.75rem;color:var(--muted);margin-top:.18rem;text-transform:capitalize">${dtStr}</div>
        </div>
        <button data-act="close" style="background:none;border:none;color:var(--muted);font-size:1.1rem;cursor:pointer;padding:.3rem .4rem;border-radius:6px;line-height:1;margin-top:-.1rem">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding:.4rem 1.6rem .8rem">
        ${rows || '<div class="aq-ledger-empty" style="padding:2.5rem 0">Sem registros para esta data</div>'}
      </div>
      <div style="padding:.8rem 1.6rem;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;background:var(--surface2)">
        <span style="font-size:.7rem;color:var(--muted)">${_aqLogCache.length} registro${_aqLogCache.length !== 1 ? 's' : ''}</span>
        <button data-act="close" style="background:none;border:1px solid var(--border);border-radius:7px;padding:.42rem 1.1rem;font-size:.74rem;font-weight:600;letter-spacing:.04em;color:var(--muted);cursor:pointer;transition:border-color .18s,color .18s">Fechar</button>
      </div>
    </div>`;
  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
  ov.addEventListener('click', e => { const t = e.target.closest('[data-act="close"]'); if (t || e.target === ov) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}

async function _aqSaveCell(tipo, novaQtd) {
  if (_aqSaving) return;
  _aqSaving = true;
  const ds = _aqDate || (_calDiaSel ? calDateStr(_calDiaSel) : calDateStr(new Date()));
  try {
    const res = await api('/api/reservas/uso-aquatico', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: ds, equipamento: 'jacuzzi', tipo_usuario: tipo, quantidade: novaQtd }),
    });
    if (res && res.ok) {
      const d = await res.json();
      if (d.ok) {
        _aqState[tipo] = novaQtd;
        _aqRender();
        _aqLoadLog(ds);
      }
    }
  } finally { _aqSaving = false; }
}

// Drawer Day Use
function _openAqDrawer() {
  const ds = _calDiaSel ? calDateStr(_calDiaSel) : calDateStr(new Date());
  loadUsoAquatico(ds);
  _aqLoadLog(ds);
  document.getElementById('aq-drawer')?.classList.add('open');
  document.getElementById('aq-drawer-overlay')?.classList.add('open');
}
function _closeAqDrawer() {
  document.getElementById('aq-drawer')?.classList.remove('open');
  document.getElementById('aq-drawer-overlay')?.classList.remove('open');
}
document.getElementById('btn-aq-drawer-open')?.addEventListener('click', _openAqDrawer);
document.getElementById('aq-drawer-close')?.addEventListener('click', _closeAqDrawer);
document.getElementById('aq-drawer-overlay')?.addEventListener('click', _closeAqDrawer);
document.getElementById('aq-gc-chip-btn')?.addEventListener('click', e => { e.stopPropagation(); _abrirModalGranClass(); });
document.getElementById('aq-ledger-more-btn')?.addEventListener('click', _aqOpenLogPopup);

function _aqShowAddModal(tipo) {
  if (document.getElementById('_aq-add-modal')) return;
  const label = _AQ_TIPO_LABEL[tipo] || tipo;
  const atual = _aqGet(tipo);
  const ov = document.createElement('div');
  ov.id = '_aq-add-modal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.72);backdrop-filter:blur(4px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem';
  ov.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--gold);border-radius:12px;max-width:340px;width:100%;padding:1.45rem 1.55rem 1.25rem;box-shadow:0 24px 60px rgba(0,0,0,.44)">
      <div style="margin-bottom:1.15rem">
        <div style="font-size:.63rem;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--gold);margin-bottom:.28rem">Área Molhada · Day Use</div>
        <div style="font-weight:700;font-size:1rem;color:var(--text)">Adicionar ${label}</div>
        ${atual > 0 ? `<div style="font-size:.74rem;color:var(--muted);margin-top:.18rem">Quantidade atual: <strong style="color:var(--text)">${atual}</strong></div>` : ''}
      </div>
      <label style="display:block;font-size:.72rem;font-weight:600;color:var(--muted);margin-bottom:.38rem;letter-spacing:.02em">Quantos foram adicionados?</label>
      <input id="_aq-add-input" type="number" min="1" max="99" value="1"
        style="width:100%;padding:.65rem .8rem;border:1.5px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-family:var(--font);font-size:1.4rem;font-weight:700;text-align:center;outline:none;transition:border-color .15s;margin-bottom:1.1rem">
      <div style="display:flex;gap:.6rem;justify-content:flex-end">
        <button data-act="cancel" style="background:none;border:1px solid var(--border);border-radius:8px;padding:.46rem 1rem;font-size:.77rem;font-weight:600;color:var(--muted);cursor:pointer;font-family:var(--font)">Cancelar</button>
        <button data-act="confirm" style="background:var(--gold);border:none;border-radius:8px;padding:.46rem 1.2rem;font-size:.77rem;font-weight:700;color:#fff;cursor:pointer;font-family:var(--font)">Confirmar</button>
      </div>
    </div>`;

  function doConfirm() {
    const val = parseInt(document.getElementById('_aq-add-input')?.value, 10);
    if (!val || val < 1) return;
    const nova = atual + val;
    _aqState[tipo] = nova;
    _aqRender();
    _aqSaveCell(tipo, nova);
    close();
  }
  function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); if (e.key === 'Enter') doConfirm(); }

  ov.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel' || e.target === ov) close();
    if (act === 'confirm') doConfirm();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  setTimeout(() => { const inp = document.getElementById('_aq-add-input'); inp?.focus(); inp?.select(); }, 40);
}

document.getElementById('aq-body')?.addEventListener('click', e => {
  const btn = e.target.closest('.aq-add-btn[data-aq-tipo]');
  if (!btn) return;
  _aqShowAddModal(btn.dataset.aqTipo);
});

document.getElementById('btn-week-prev').addEventListener('click',()=>{_calWeekOffset--;_calDiaSel=null;loadReservas();});
document.getElementById('btn-week-next').addEventListener('click',()=>{_calWeekOffset++;_calDiaSel=null;loadReservas();});
document.getElementById('btn-week-hoje').addEventListener('click',()=>{_calWeekOffset=0;_calDiaSel=null;loadReservas();});
document.getElementById('btn-dp-open').addEventListener('click', dpToggle);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('cal-datepicker').style.display !== 'none') dpClose(); });

// Vigia a virada de meia-noite: se a aba fica aberta cruzando o dia, o
// destaque "hoje" e a selecao ficavam presos no dia anterior. A cada 60s
// (e tambem ao focar a aba apos suspender) checa se mudou o dia local;
// quando muda, se estiver na semana atual, reseta para o novo "hoje" e
// recarrega reservas.
(function vigiarViradaDoDia() {
  function diaLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }
  let ultimoDia = diaLocal();
  function checar() {
    const agora = diaLocal();
    if (agora === ultimoDia) return;
    ultimoDia = agora;
    // So mexe se o usuario esta vendo a semana corrente — nao tira
    // ninguem que esta navegando por outras semanas.
    if (_calWeekOffset === 0) {
      _calDiaSel = null;
      loadReservas();
    }
  }
  setInterval(checar, 60 * 1000);
  // Tambem checa quando a aba volta do background (laptop suspenso, etc).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checar(); });
  window.addEventListener('focus', checar);
})();
document.getElementById('btn-open-relatorios').addEventListener('click',()=>showView('view-main'));
// btn-back-relatorio-mensal e funcoes loadRelatorioMensal/loadCruzamento
// removidos — funcionalidade unificada no Historico de Clientes.
document.getElementById('btn-open-qualidade')?.addEventListener('click', () => { showView('view-qualidade'); loadQualidade(); });
document.getElementById('btn-ql-atualizar')?.addEventListener('click', () => loadQualidade());

// ── Abas Qualidade ─────────────────────────────────────────────────────────
// Estado visual (cor, underline, peso) é responsabilidade do CSS via
// .ql-tab.is-active. Aqui só fazemos toggle de classe + display dos panes.
document.querySelectorAll('.ql-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ql-tab').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    const tab = btn.dataset.tab;
    document.getElementById('ql-tab-visao').style.display     = tab === 'visao'     ? '' : 'none';
    document.getElementById('ql-tab-pesquisas').style.display = tab === 'pesquisas' ? '' : 'none';
    document.getElementById('ql-tab-biblioteca').style.display= tab === 'biblioteca'? '' : 'none';
    if (tab === 'pesquisas') loadPesquisasAdmin();
    if (tab === 'biblioteca') loadBiblioteca();
  });
});

// ── Gestao da Qualidade: pesquisa publicada + metas x medias por pergunta ──
// Consome /api/qualidade/admin/visao-geral. So leitura — nao mexe em
// estados nem persiste nada. Falha silenciosa se a pesquisa nao estiver
// publicada (mostra '—' nos KPIs).
async function loadQualidade() {
  // Popular o select de slugs (apenas uma vez por sessao desta view).
  const sel = document.getElementById('ql-slug');
  if (sel && !sel.options.length) {
    try {
      const r = await api('/api/qualidade/admin/pesquisas');
      if (r) {
        const d = await r.json();
        if (d.ok) {
          // Slugs unicos por (slug+versao mais alta)
          const porSlug = {};
          for (const p of d.items) {
            if (!porSlug[p.slug] || porSlug[p.slug].versao < p.versao) porSlug[p.slug] = p;
          }
          const opts = Object.values(porSlug);
          sel.innerHTML = opts.map(p => `<option value="${p.slug}">${escHtml(_nomeAmigavelPesquisa(p.slug, p.titulo))}</option>`).join('');
          sel.addEventListener('change', () => loadQualidadeVisao());
        }
      }
    } catch {}
  }
  await loadQualidadeVisao();
}

async function loadQualidadeVisao() {
  const sel = document.getElementById('ql-slug');
  const slug = (sel && sel.value) || 'spa-locc-v1';
  const from = document.getElementById('ql-from')?.value || '';
  const to   = document.getElementById('ql-to')?.value || '';
  const p = new URLSearchParams({ slug });
  if (from) p.set('from', from);
  if (to)   p.set('to', to);
  let d;
  try {
    const r = await api('/api/qualidade/admin/visao-geral?' + p);
    if (!r) return;
    d = await r.json();
  } catch { return; }
  if (!d || !d.ok) return;
  const { stats, metas } = d;
  document.getElementById('ql-kpi-pesquisa').textContent = _nomeAmigavelPesquisa(slug);
  document.getElementById('ql-kpi-versao').textContent = 'período: ' + (stats.periodo?.from || '—') + ' a ' + (stats.periodo?.to || '—');
  document.getElementById('ql-kpi-total').textContent = stats.total ?? '—';
  document.getElementById('ql-kpi-media').textContent = _mediaPct(stats.mediaGeral);
  document.getElementById('ql-kpi-reco').textContent = stats.pctRecomenda != null ? stats.pctRecomenda + '%' : '—';
  const metaReco = metas?.por_questionario?.pct_recomenda;
  const recoCard = document.getElementById('ql-kpi-reco-card');
  if (metaReco) {
    document.getElementById('ql-kpi-reco-meta').textContent = 'meta ≥ ' + metaReco.alvo + '%';
    if (recoCard) recoCard.classList.toggle('alert', metaReco.atingido === false);
  } else {
    document.getElementById('ql-kpi-reco-meta').textContent = 'sem meta';
    if (recoCard) recoCard.classList.remove('alert');
  }

  const porPerg = metas?.por_pergunta || {};
  const body  = document.getElementById('ql-body');
  const empty = document.getElementById('ql-empty');
  const count = document.getElementById('ql-count');
  const linhas = Object.entries(porPerg);
  if (count) count.textContent = linhas.length ? linhas.length + ' metas' : '';
  if (!linhas.length) {
    body.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  // Rotulos amigaveis a partir dos labels ja hardcoded
  const LABELS = Object.fromEntries(
    [...SERVICOS_LABELS, ...INSTALACOES_LABELS].map(x => [x.campo, x.label])
  );
  body.innerHTML = linhas.map(([campo, m]) => {
    const rotulo = LABELS[campo] || campo;
    const atual = m.valor_atual != null ? m.valor_atual.toFixed(2) : '—';
    const alvo = m.alvo != null ? m.alvo.toFixed(1) : '—';
    let badge;
    if (m.atingido === true)       badge = '<span class="ql-status-ok">✓ Atingida</span>';
    else if (m.atingido === false) badge = '<span class="ql-status-fail">✗ Abaixo</span>';
    else                           badge = '<span class="ql-status-na">—</span>';
    return `<tr>
      <td>${escHtml(rotulo)}</td>
      <td style="text-align:center;font-variant-numeric:tabular-nums">${atual}</td>
      <td style="text-align:center;font-variant-numeric:tabular-nums">${alvo}</td>
      <td style="text-align:center">${badge}</td>
    </tr>`;
  }).join('');
}

// ── Qualidade / Aba PESQUISAS ──────────────────────────────────────────────
let _qpCache = [];
// Alias curto p/ feedback visual nas operações de qualidade.
function toast(msg, isErr) { showToast(isErr ? '⚠ ' + msg : msg, isErr ? 5000 : 3000); }

async function loadPesquisasAdmin() {
  try {
    const r = await api('/api/qualidade/admin/pesquisas');
    if (!r) return;
    const d = await r.json();
    if (!d.ok) return;
    _qpCache = d.items;
    const body = document.getElementById('qp-list');
    body.innerHTML = d.items.map(p => `
      <tr>
        <td><span class="ql-code-chip">${escHtml(p.slug)}</span></td>
        <td>${escHtml(p.titulo)}</td>
        <td><span class="badge">${escHtml(p.app_escopo)}</span></td>
        <td style="text-align:center">v${p.versao}</td>
        <td style="text-align:center">${p.publicada_em ? '<span class="ql-pub-dot">●</span>' : '<span class="ql-pub-dot off">○</span>'}</td>
        <td style="text-align:center">${p.ativo ? 'Sim' : 'Não'}</td>
        <td class="ql-actions">
          <button class="btn btn-outline btn-sm" data-act="edit" data-id="${p.id}">Editar</button>
          <button class="btn btn-outline btn-sm" data-act="${p.publicada_em ? 'despub' : 'pub'}" data-id="${p.id}">${p.publicada_em ? 'Despublicar' : 'Publicar'}</button>
          <button class="btn btn-outline btn-sm" data-act="clone" data-id="${p.id}">Clonar</button>
        </td>
      </tr>
    `).join('');
    body.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => handleQpAction(btn.dataset.act, parseInt(btn.dataset.id)));
    });
  } catch (e) { console.error(e); }
}

async function handleQpAction(act, id) {
  if (act === 'pub') {
    await apiSend('POST', `/api/qualidade/admin/pesquisas/${id}/publicar`);
    return loadPesquisasAdmin();
  }
  if (act === 'despub') {
    if (!await confirmarAcao({ titulo: 'Despublicar pesquisa?', mensagem: 'Apps que a consomem deixarão de recebê-la imediatamente.', btnConfirmar: 'Despublicar', perigoso: true })) return;
    await apiSend('POST', `/api/qualidade/admin/pesquisas/${id}/despublicar`);
    return loadPesquisasAdmin();
  }
  if (act === 'clone') {
    const novoApp = prompt('App escopo do clone (ex: spa, spa-anamnese, hotel, all):', 'spa');
    if (!novoApp) return;
    const r = await apiSend('POST', `/api/qualidade/admin/pesquisas/${id}/clonar`, { novoAppEscopo: novoApp });
    if (r?.ok) toast('Clone criado (id ' + r.id + ')');
    return loadPesquisasAdmin();
  }
  if (act === 'edit') {
    return openEditorPesquisa(id);
  }
}

async function openEditorPesquisa(id) {
  const r = await api(`/api/qualidade/admin/pesquisas/${id}`);
  if (!r) return;
  const d = await r.json();
  if (!d.ok) return;
  const p = d.pesquisa;
  const editor = document.getElementById('qp-editor');
  editor.style.display = '';
  editor.innerHTML = `
    <div class="ql-editor-head">
      <h3 class="ql-section-title">Editar pesquisa: <span class="ql-code-chip">${escHtml(p.slug)}</span> <span class="ql-secao-meta">v${p.versao}</span></h3>
      <button class="btn btn-outline btn-sm" id="qp-ed-close">Fechar</button>
    </div>
    <div class="ql-form-grid">
      <label class="ql-field">Título
        <input id="qp-ed-titulo" class="ql-input" value="${escHtml(p.titulo || '')}">
      </label>
      <label class="ql-field">App escopo
        <input id="qp-ed-app" class="ql-input" value="${escHtml(p.app_escopo || 'spa')}">
      </label>
      <label class="ql-field ql-field-wide">Descrição
        <textarea id="qp-ed-desc" class="ql-input" rows="2">${escHtml(p.descricao || '')}</textarea>
      </label>
    </div>
    <div style="display:flex;gap:.5rem;margin-bottom:1.5rem">
      <button class="btn btn-primary btn-sm" id="qp-ed-save">Salvar</button>
    </div>
    <div id="qp-ed-secoes"></div>
    <div id="qp-ed-metas" style="margin-top:1.5rem"></div>
  `;
  document.getElementById('qp-ed-close').addEventListener('click', () => { editor.style.display = 'none'; });
  document.getElementById('qp-ed-save').addEventListener('click', async () => {
    await apiSend('PUT', `/api/qualidade/admin/pesquisas/${id}`, {
      titulo: document.getElementById('qp-ed-titulo').value.trim(),
      descricao: document.getElementById('qp-ed-desc').value.trim(),
      app_escopo: document.getElementById('qp-ed-app').value.trim(),
    });
    toast('Salvo'); loadPesquisasAdmin();
  });
  // Estrutura completa (seções + perguntas associadas) via /admin/visao-geral helper:
  // usamos buscarPesquisaPublicada-like via /api/survey/config se publicada, ou montamos manual.
  await renderEditorSecoes(id);
  await renderEditorMetas(id, d.metas);
}

async function renderEditorSecoes(pesquisaId) {
  const slug = (_qpCache.find(x => x.id === pesquisaId) || {}).slug;
  if (!slug) return;
  let cfg = null;
  // Tenta config (somente publicadas) – se nao publicada, lista vazia
  try {
    const r = await api(`/api/survey/config?slug=${encodeURIComponent(slug)}&idioma=pt-BR`);
    if (r) { const d = await r.json(); if (d.ok) cfg = d.pesquisa; }
  } catch {}
  const wrap = document.getElementById('qp-ed-secoes');
  const formNovaSecao = `
    <div class="ql-inline-add">
      <input id="qp-novasecao-chave" class="ql-input" placeholder="chave da seção">
      <input id="qp-novasecao-titulo" class="ql-input flex-grow" placeholder="título pt-BR">
      <button class="btn btn-outline btn-sm" id="qp-novasecao-add">+ Seção</button>
    </div>`;
  if (!cfg) {
    wrap.innerHTML = `
      <div class="empty">Esta pesquisa não está publicada ainda — publique-a para visualizar as seções e perguntas associadas.</div>
      ${formNovaSecao}
    `;
  } else {
    wrap.innerHTML = `
      <h4 class="ql-section-title" style="margin:0 0 .6rem 0;font-size:1rem">Seções e perguntas</h4>
      ${cfg.secoes.map(s => `
        <div class="ql-secao-card">
          <div class="ql-secao-head">
            <strong>${escHtml(s.titulo)}</strong>
            <span class="ql-secao-meta">ordem ${s.ordem} · ${s.perguntas.length} pergunta(s)</span>
          </div>
          ${s.perguntas.length ? `
            <table style="width:100%;font-size:.85rem">
              <thead><tr><th style="text-align:left">Pergunta</th><th style="text-align:center">Tipo</th><th style="text-align:center">Obrig.</th></tr></thead>
              <tbody>
                ${s.perguntas.map(q => `
                  <tr>
                    <td>${escHtml(q.rotulo)} <span class="ql-code-chip">${escHtml(q.chave)}</span></td>
                    <td style="text-align:center">${escHtml(q.tipo)}</td>
                    <td style="text-align:center">${q.obrigatoria ? '<span class="ql-pub-dot">●</span>' : '<span class="ql-pub-dot off">○</span>'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="ql-meta-empty">Sem perguntas associadas.</div>'}
        </div>
      `).join('')}
      ${formNovaSecao}
    `;
  }
  document.getElementById('qp-novasecao-add')?.addEventListener('click', async () => {
    const chave = document.getElementById('qp-novasecao-chave').value.trim();
    const titulo = document.getElementById('qp-novasecao-titulo').value.trim();
    if (!chave) return toast('Informe a chave');
    await apiSend('POST', `/api/qualidade/admin/pesquisas/${pesquisaId}/secoes`, {
      chave, ordem: 99,
      traducoes: { 'pt-BR': { titulo: titulo || chave } }
    });
    toast('Seção criada'); renderEditorSecoes(pesquisaId);
  });
}

async function renderEditorMetas(pesquisaId, metas) {
  const wrap = document.getElementById('qp-ed-metas');
  if (!wrap) return;
  const mq = metas?.por_questionario || [];
  const mp = metas?.por_pergunta || [];
  wrap.innerHTML = `
    <h4 class="ql-section-title" style="margin:0 0 .6rem 0;font-size:1rem">Metas configuradas</h4>
    <div style="font-size:.85rem">
      <strong>Por questionário:</strong>
      ${mq.length ? '<ul class="ql-meta-list">' + mq.map(m => `<li>${escHtml(m.tipo_meta)} ≥ ${m.valor_alvo}</li>`).join('') + '</ul>' : '<span class="ql-meta-empty"> nenhuma</span>'}
      <strong>Por pergunta:</strong>
      ${mp.length ? '<ul class="ql-meta-list">' + mp.map(m => `<li><span class="ql-code-chip">${escHtml(m.chave)}</span> — ${escHtml(m.tipo_meta)} ≥ ${m.valor_alvo}</li>`).join('') + '</ul>' : '<span class="ql-meta-empty"> nenhuma</span>'}
    </div>
    <div class="ql-inline-add">
      <label class="ql-field">Meta de % recomenda
        <input id="qp-meta-reco" class="ql-input" type="number" min="0" max="100" step="1" placeholder="90" style="width:110px">
      </label>
      <button class="btn btn-outline btn-sm" id="qp-meta-reco-save">Salvar % recomenda</button>
    </div>
  `;
  document.getElementById('qp-meta-reco-save')?.addEventListener('click', async () => {
    const v = parseFloat(document.getElementById('qp-meta-reco').value);
    if (isNaN(v)) return toast('Informe um valor');
    await apiSend('POST', '/api/qualidade/admin/metas/questionario', {
      pesquisa_id: pesquisaId, tipo_meta: 'pct_recomenda', valor_alvo: v
    });
    toast('Meta salva');
  });
}

// Botões "Nova pesquisa" / "Recarregar"
document.getElementById('btn-qp-nova')?.addEventListener('click', async () => {
  const slug = prompt('Slug da pesquisa (ex: hotel-checkin-v1):');
  if (!slug) return;
  const titulo = prompt('Título:', slug);
  if (!titulo) return;
  const app = prompt('App escopo (ex: spa, hotel, all):', 'spa');
  if (!app) return;
  try {
    const r = await apiSend('POST', '/api/qualidade/admin/pesquisas', { slug, titulo, app_escopo: app });
    if (r?.ok) toast('Criada (id ' + r.id + ')');
  } catch (e) { toast('Erro: ' + e.message, true); }
  loadPesquisasAdmin();
});
document.getElementById('btn-qp-reload')?.addEventListener('click', () => loadPesquisasAdmin());

// ── Qualidade / Aba BIBLIOTECA ─────────────────────────────────────────────
async function loadBiblioteca() {
  try {
    const [rp, re] = await Promise.all([
      api('/api/qualidade/admin/perguntas'),
      api('/api/qualidade/admin/escalas'),
    ]);
    if (rp) {
      const dp = await rp.json();
      if (dp.ok) {
        document.getElementById('qb-perg-list').innerHTML = dp.items.map(p => `
          <tr>
            <td><span class="ql-code-chip">${escHtml(p.chave)}</span><div class="ql-pergunta-sub">${escHtml(p.rotulo || '')}</div></td>
            <td>${escHtml(p.tipo)}</td>
            <td>${escHtml(p.escala_chave || '—')}</td>
            <td style="text-align:center">${p.ativo ? '<span class="ql-pub-dot">●</span>' : '<span class="ql-pub-dot off">○</span>'}</td>
          </tr>
        `).join('');
      }
    }
    if (re) {
      const de = await re.json();
      if (de.ok) {
        document.getElementById('qb-esc-list').innerHTML = de.items.map(e => `
          <tr>
            <td><span class="ql-code-chip">${escHtml(e.chave)}</span></td>
            <td>${escHtml(e.tipo)}</td>
            <td style="font-size:.78rem">${e.opcoes.map(o => escHtml(o.rotulo || o.chave)).join(' · ')}</td>
          </tr>
        `).join('');
      }
    }
  } catch (e) { console.error(e); }
}

document.getElementById('btn-qb-nova-perg')?.addEventListener('click', async () => {
  const chave = prompt('Chave da pergunta (ex: hotel_recepcao):');
  if (!chave) return;
  const tipo = prompt('Tipo (escala / texto_livre / unica / multipla):', 'texto_livre');
  if (!tipo) return;
  const rotulo = prompt('Rótulo pt-BR:', chave);
  let escala_id = null;
  if (tipo === 'escala') {
    const eChave = prompt('Chave da escala (ex: 4pt_qualitativa, sim_nao):');
    if (eChave) {
      // resolve id consultando a lista
      const re = await api('/api/qualidade/admin/escalas');
      if (re) { const de = await re.json(); if (de.ok) {
        const found = de.items.find(x => x.chave === eChave);
        if (found) escala_id = found.id;
      }}
    }
  }
  try {
    await apiSend('POST', '/api/qualidade/admin/perguntas', {
      chave, tipo, escala_id, traducoes: { 'pt-BR': { rotulo: rotulo || chave } }
    });
    toast('Pergunta criada');
  } catch (e) { toast('Erro: ' + e.message, true); }
  loadBiblioteca();
});

document.getElementById('btn-qb-nova-esc')?.addEventListener('click', async () => {
  const chave = prompt('Chave da escala (ex: 5pt_likert):');
  if (!chave) return;
  const tipo = prompt('Tipo da escala (qualitativa, numerica, sim_nao...):', 'qualitativa');
  const opcsRaw = prompt('Opções no formato chave:rotulo:valor, separadas por vírgula\nEx: muito_bom:Muito bom:10, bom:Bom:7, regular:Regular:5');
  if (!opcsRaw) return;
  const opcoes = opcsRaw.split(',').map((s, i) => {
    const parts = s.trim().split(':');
    return { chave: parts[0]?.trim(), rotulo: parts[1]?.trim() || parts[0]?.trim(), valor_numerico: parts[2] ? parseFloat(parts[2]) : null, ordem: i + 1 };
  }).filter(o => o.chave);
  try {
    await apiSend('POST', '/api/qualidade/admin/escalas', { chave, tipo, opcoes });
    toast('Escala criada');
  } catch (e) { toast('Erro: ' + e.message, true); }
  loadBiblioteca();
});

// Helper: POST/PUT/DELETE com JSON, retorna {ok, ...}.
async function apiSend(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  // O token é armazenado como string pura (não JSON-encoded). Usar o
  // helper token() pra reaproveitar a mesma lógica de api().
  const tok = token();
  if (tok) headers['Authorization'] = 'Bearer ' + tok;
  const opts = { method, headers, credentials: 'include' };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (r.status === 401) { logout?.(); return null; }
  let d = null; try { d = await r.json(); } catch {}
  if (!r.ok || (d && d.ok === false)) {
    throw new Error((d && d.error) || ('HTTP ' + r.status));
  }
  return d;
}

// ── Relatorio Mensal: REMOVIDO — unificado no Historico de Clientes ──
// Endpoints /api/relatorios/{mensal,cruzamento} preservados no backend
// para uso futuro (nao ha caller hoje, mas a remocao introduz risco baixo).
document.getElementById('btn-back-reservas').addEventListener('click',()=>showView('view-reservas'));

// Dropdowns gerenciados por shared-header.js (setupDropdownToggles)

// Usuários
// ── Usuários ──
function currentUserPayload() {
  try { return JSON.parse(atob(token().split('.')[1])); } catch { return null; }
}

const ROLE_LABEL = { master: 'Master', admin: 'Admin', normal: 'Normal' };

function fecharFormUsuario() {
  document.getElementById('form-usuario').style.display = 'none';
  ['usuario-nome','usuario-username','usuario-edit-id'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('usuario-role').value = 'admin';
  document.getElementById('usuario-msg').style.display = 'none';
}

// Botao "+ Novo Usuario" removido do HTML — criacao de admin agora e' feita
// exclusivamente pelo Hub. Optional chaining mantem o restante da
// inicializacao segura caso o botao volte a existir no futuro.
document.getElementById('btn-novo-usuario')?.addEventListener('click', () => {
  fecharFormUsuario();
  document.getElementById('form-usuario-titulo').textContent = 'Novo Usuário';
  document.getElementById('form-usuario').style.display = 'block';
  document.getElementById('form-usuario').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('btn-cancel-form-usuario').addEventListener('click', fecharFormUsuario);

document.getElementById('btn-open-usuarios').addEventListener('click',()=>{ showView('view-usuarios'); loadUsuarios(); });

async function loadUsuarios() {
  // Preenche card "você está logado como"
  const me = currentUserPayload();
  if (me) {
    document.getElementById('meu-avatar').textContent = (me.username || '?')[0].toUpperCase();
    document.getElementById('meu-username-display').textContent = '@' + me.username;
  }

  const tbody = document.getElementById('usuarios-body');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--muted)">Carregando…</td></tr>';
  let r, d;
  try {
    r = await api('/api/auth/usuarios');
    if (!r) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--danger)">Sessão inválida. Faça logout e login novamente.</td></tr>';
      return;
    }
    d = await r.json();
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--danger)">Erro ao carregar usuários.</td></tr>';
    return;
  }

  // Atualiza card com dados completos do usuário logado
  if (me && d.ok) {
    const eu = d.items.find(u => u.id === me.sub);
    if (eu) {
      document.getElementById('meu-nome-display').textContent = eu.nome || eu.username;
      document.getElementById('meu-username-display').textContent = '@' + eu.username;
      const rb = document.getElementById('meu-role-badge');
      rb.textContent = ROLE_LABEL[eu.role] || eu.role || 'admin';
      rb.className = 'role-badge role-' + (eu.role || 'admin');
    }
  }

  if (!d.ok || !d.items?.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--muted)">Nenhum usuário.</td></tr>';
    return;
  }
  const fmt = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—';
  const meId = me?.sub;
  const isMaster = me?.role === 'master';
  // btn-novo-usuario foi removido do HTML; optional chaining evita TypeError
  // ao renderizar a tela de Usuarios.
  const btnNovo = document.getElementById('btn-novo-usuario');
  if (btnNovo) btnNovo.style.display = isMaster ? '' : 'none';
  tbody.innerHTML = d.items.map(u => `<tr>
    <td>
      <div style="font-weight:500">${escHtml(u.nome || u.username)}</div>
      ${u.nome ? `<div style="font-size:.75rem;color:var(--muted)">@${escHtml(u.username)}</div>` : ''}
    </td>
    <td style="font-size:.82rem;color:var(--muted)">@${escHtml(u.username)}</td>
    <td><span class="role-badge role-${u.role||'admin'}">${ROLE_LABEL[u.role]||u.role||'admin'}</span></td>
    <td style="font-size:.78rem;color:var(--muted)">${fmt(u.created_at)}</td>
    <td style="text-align:right;white-space:nowrap">
      ${isMaster && u.id !== meId ? `<button class="btn btn-outline btn-sm" style="border-color:var(--danger);color:var(--danger)" data-action="del-user" data-id="${u.id}" data-nome="${escHtml(u.nome||u.username)}">Remover</button>` : u.id === meId ? '<span style="font-size:.72rem;color:var(--muted)">você</span>' : ''}
    </td>
  </tr>`).join('');
}

window.editarUsuario = async (id) => {
  const r = await api('/api/auth/usuarios');
  if (!r) return;
  const d = await r.json();
  const u = d.items?.find(x => x.id === id);
  if (!u) return;
  document.getElementById('form-usuario-titulo').textContent = 'Editar Usuário';
  document.getElementById('usuario-nome').value = u.nome || '';
  document.getElementById('usuario-username').value = u.username;
  document.getElementById('usuario-role').value = u.role || 'admin';
  document.getElementById('usuario-edit-id').value = id;
  document.getElementById('usuario-msg').style.display = 'none';
  document.getElementById('form-usuario').style.display = 'block';
  document.getElementById('form-usuario').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

document.getElementById('btn-salvar-usuario').addEventListener('click', async () => {
  const editId  = document.getElementById('usuario-edit-id').value;
  const nome    = document.getElementById('usuario-nome').value.trim();
  const username= document.getElementById('usuario-username').value.trim();
  const role    = document.getElementById('usuario-role').value;
  const msg     = document.getElementById('usuario-msg');
  msg.style.display = 'none';

  if (!username) { msg.textContent='Usuário obrigatório.'; msg.style.display='block'; return; }

  const body = JSON.stringify({ nome, username, role });
  const isEdit = !!editId;
  const r = await api(
    isEdit ? `/api/auth/usuarios/${editId}` : '/api/auth/usuarios',
    { method: isEdit ? 'PUT' : 'POST', body }
  );
  if (!r) return;
  const d = await r.json();
  if (!d.ok) { msg.textContent = d.error || 'Erro ao salvar.'; msg.style.display='block'; return; }
  fecharFormUsuario();
  loadUsuarios();
});

window.deletarUsuario = async (id, nome) => {
  if (!await confirmarAcao({ titulo: `Remover "${nome}"?`, mensagem: 'O usuário perderá acesso ao sistema. Esta ação não pode ser desfeita.', btnConfirmar: 'Remover', perigoso: true })) return;
  const r = await api(`/api/auth/usuarios/${id}`, { method:'DELETE' });
  if (!r) return;
  const d = await r.json();
  if (!d.ok) { alert(d.error || 'Erro ao remover.'); return; }
  loadUsuarios();
};

// btn-open-historico-clientes removido — sub-aba "Atendimentos" em Relatórios.
document.getElementById('btn-hc-filtrar').addEventListener('click',()=>loadHistoricoClientes());
document.getElementById('btn-hc-limpar').addEventListener('click',()=>{
  document.getElementById('hc-from').value='';
  document.getElementById('hc-to').value='';
  _hcResetSalas();
  const st = document.getElementById('hc-status'); if (st) st.value = 'todos';
  const ms = document.getElementById('hc-massagista'); if (ms) ms.value = '';
  document.getElementById('hc-busca').value='';
  loadHistoricoClientes();
});

const HC_SALAS_LABEL = { 1:'Sala 1', 2:'Sala 2', 3:'Sala 3', 4:'Sala 4', 5:'Espaço Beleza' };
function _hcSalaCbs(){ return Array.from(document.querySelectorAll('.hc-salas-cb')); }
function _hcSelectedSalas(){ return _hcSalaCbs().filter(cb=>cb.checked).map(cb=>cb.value); }
function _hcUpdateSalasLabel(){
  const sel = _hcSelectedSalas();
  const allCb = document.getElementById('hc-salas-all');
  const label = document.getElementById('hc-salas-label');
  if (!sel.length || sel.length === _hcSalaCbs().length) {
    if (allCb) allCb.checked = true;
    label.textContent = 'Todas';
  } else {
    if (allCb) allCb.checked = false;
    label.textContent = sel.length === 1
      ? HC_SALAS_LABEL[sel[0]]
      : `${sel.length} salas`;
  }
}
function _hcResetSalas(){
  _hcSalaCbs().forEach(cb => cb.checked = false);
  const allCb = document.getElementById('hc-salas-all'); if (allCb) allCb.checked = true;
  _hcUpdateSalasLabel();
}
(function _hcWireSalasDropdown(){
  const btn = document.getElementById('hc-salas-btn');
  const panel = document.getElementById('hc-salas-panel');
  const dd = document.getElementById('hc-salas-dd');
  if (!btn || !panel || !dd) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = !panel.hidden;
    panel.hidden = open;
    btn.setAttribute('aria-expanded', String(!open));
  });
  document.addEventListener('click', e => {
    if (!dd.contains(e.target)) { panel.hidden = true; btn.setAttribute('aria-expanded','false'); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.hidden) {
      panel.hidden = true;
      btn.setAttribute('aria-expanded','false');
      btn.focus();
    }
  });
  document.getElementById('hc-salas-all')?.addEventListener('change', e => {
    if (e.target.checked) _hcSalaCbs().forEach(cb => cb.checked = false);
    _hcUpdateSalasLabel();
  });
  _hcSalaCbs().forEach(cb => cb.addEventListener('change', _hcUpdateSalasLabel));
})();
document.getElementById('hc-busca').addEventListener('keydown', e=>{ if(e.key==='Enter') loadHistoricoClientes(); });
document.getElementById('hc-status')?.addEventListener('change', () => loadHistoricoClientes());

let _hcMassagistasCarregadas = false;
async function _hcCarregarMassagistas() {
  if (_hcMassagistasCarregadas) return;
  const sel = document.getElementById('hc-massagista');
  if (!sel) return;
  const r = await api('/api/massagistas-ativas');
  if (!r) return;
  const d = await r.json();
  (d.items || []).forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.nome;
    sel.appendChild(opt);
  });
  _hcMassagistasCarregadas = true;
}

const SALA_NOME = { 1: 'Sala 1', 2: 'Sala 2', 3: 'Sala 3', 4: 'Sala 4', 5: 'Espaço Beleza' };
const TIPO_CLIENTE_LABEL = { hospede: 'Hóspede', passante: 'Passante' };

function _hcParams(off=0) {
  const from  = document.getElementById('hc-from').value || '';
  const to    = document.getElementById('hc-to').value || '';
  const salas = _hcSelectedSalas();
  const busca = document.getElementById('hc-busca').value.trim() || '';
  const massagista_id = document.getElementById('hc-massagista')?.value || '';
  const p = new URLSearchParams({ limit: _hcLimit, offset: off });
  if (from)  p.set('from',  from);
  if (to)    p.set('to',    to);
  // Não envia 'sala' quando nenhuma (ou todas) está marcada → backend retorna tudo.
  if (salas.length && salas.length < _hcSalaCbs().length) {
    salas.forEach(v => p.append('sala', v));
  }
  if (massagista_id) p.set('massagista_id', massagista_id);
  if (busca) p.set('busca', busca);
  return p.toString();
}

async function loadHistoricoClientes(page=0) {
  _hcPage = page;
  const body   = document.getElementById('hc-body');
  const empty  = document.getElementById('hc-empty');
  const count  = document.getElementById('hc-count');
  const pag    = document.getElementById('hc-pagination');
  body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--muted)">Carregando…</td></tr>';
  empty.style.display = 'none';
  pag.innerHTML = '';

  const r = await api(`/api/reservas/historico?${_hcParams(page * _hcLimit)}`);
  if (!r) return;
  const d = await r.json();
  if (!d.ok) { body.innerHTML=''; empty.textContent='Erro ao carregar dados.'; empty.style.display='block'; return; }

  let { total, items } = d;
  // Filtro client-side por status da pesquisa (todos/respondidas/pendentes)
  const status = document.getElementById('hc-status')?.value || 'todos';
  if (status === 'respondidas') items = items.filter(it => it.respondeu_pesquisa);
  else if (status === 'pendentes') items = items.filter(it => !it.respondeu_pesquisa);
  count.textContent = `${items.length} atendimento${items.length !== 1 ? 's' : ''}${status !== 'todos' ? ` (filtrado: ${status})` : ''}`;

  // Atualiza KPIs do periodo (substitui o antigo Relatorio Mensal)
  _hcAtualizarKPIs(d.items, total);

  if (!items.length) {
    body.innerHTML = '';
    empty.textContent = 'Nenhum atendimento encontrado.';
    empty.style.display = 'block';
    return;
  }

  const fmt = iso => {
    if (!iso) return '—';
    const [y,m,day] = iso.split('-');
    return `${day}/${m}/${y}`;
  };

  body.innerHTML = items.map(it => {
    const contato = [it.apto ? `Apto ${it.apto}` : '', it.telefone || ''].filter(Boolean).join(' · ') || it.email || '—';
    const tratamento = it.tipo_massagem_nome || it.tratamento || '—';
    const massoterapeuta = it.massoterapeuta_nome || '—';
    const tipoLabel = TIPO_CLIENTE_LABEL[it.tipo_cliente] || it.tipo_cliente || '—';
    const salaLabel = SALA_NOME[it.sala] || `Sala ${it.sala}`;
    const pesquisaBadge = it.respondeu_pesquisa
      ? '<span style="display:inline-block;background:var(--success-dim);color:var(--success);border:1px solid var(--success);padding:.18rem .55rem;border-radius:999px;font-size:.7rem;font-weight:600">✓ Respondida</span>'
      : '<span style="display:inline-block;background:var(--bg);color:var(--muted2);border:1px solid var(--border);padding:.18rem .55rem;border-radius:999px;font-size:.7rem;font-weight:500">Pendente</span>';
    return `<tr data-action="hc-row-detalhe" data-id="${it.id}" style="cursor:pointer">
      <td>${fmt(it.data)}</td>
      <td style="font-family:var(--mono);font-size:.82rem">${it.hora_inicio} – ${it.hora_fim}</td>
      <td>
        <div style="font-weight:500">${escHtml(it.cliente)}</div>
        <div style="font-size:.78rem;color:var(--muted)">${escHtml(it.email || '')}</div>
      </td>
      <td><span class="badge-tipo-${it.tipo_cliente || 'outro'}">${escHtml(tipoLabel)}</span></td>
      <td style="font-size:.82rem;color:var(--muted2)">${escHtml(contato)}</td>
      <td style="font-size:.82rem">${escHtml(salaLabel)}</td>
      <td style="font-size:.82rem">${escHtml(tratamento)}</td>
      <td style="font-size:.82rem">${escHtml(massoterapeuta)}</td>
      <td style="text-align:center">${pesquisaBadge}</td>
    </tr>`;
  }).join('');

  const totalPages = Math.ceil(total / _hcLimit);
  if (totalPages > 1) {
    let html = '';
    if (page > 0) html += `<button class="page-btn" data-action="hc-page" data-p="${page-1}">‹ Anterior</button>`;
    html += `<span style="padding:0 .75rem;font-size:.82rem;color:var(--muted)">Página ${page+1} de ${totalPages}</span>`;
    if (page < totalPages-1) html += `<button class="page-btn" data-action="hc-page" data-p="${page+1}">Próxima ›</button>`;
    pag.innerHTML = html;
  }
}

// Atualiza os KPIs do Historico (substitui o antigo Relatorio Mensal).
// Calcula sobre TODOS os items retornados pelo backend (nao apenas a pagina
// atual): respondeu_pesquisa vem aditivo da query — sem chamada extra.
// Se quiser totais do mes inteiro, usa o intervalo from-to atual.
function _hcAtualizarKPIs(itemsTodos, total) {
  const sessoes = total ?? itemsTodos.length;
  const respondidas = itemsTodos.reduce((acc, it) => acc + (it.respondeu_pesquisa ? 1 : 0), 0);
  const pendentes = itemsTodos.length - respondidas;
  const taxa = itemsTodos.length ? Math.round((respondidas / itemsTodos.length) * 100) : 0;
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('hc-kpi-sessoes', String(sessoes));
  setText('hc-kpi-respondidas', String(respondidas));
  setText('hc-kpi-taxa', `${taxa}%`);
  setText('hc-kpi-pendentes', String(pendentes));
  // Subtitulo do periodo
  const from = document.getElementById('hc-from')?.value;
  const to = document.getElementById('hc-to')?.value;
  const periodo = (from || to)
    ? `${from || 'início'} → ${to || 'hoje'}`
    : 'Todo o histórico';
  setText('hc-kpi-periodo', periodo);
}

// ═══════════════════════════════════════════════════════════════════════════
// Detalhe do atendimento (modal) — abre ao clicar numa linha do Historico.
// Backend: GET /api/reservas/:id/detalhe. Mostra dados da sessao + status
// da pesquisa + notas + anamnese (readonly). NAO inclui produtos.
// Respeita _modalOpen pra pausar polling enquanto modal estiver aberto.
// ═══════════════════════════════════════════════════════════════════════════

const _RATINGS_FACES_LABEL = {
  otimo: 'Ótimo', bom: 'Bom', regular: 'Regular', ruim: 'Ruim',
  great: 'Ótimo', good: 'Bom', fair: 'Regular', poor: 'Ruim',
};
const _SERVICOS_LABELS = {
  servicos_expectativa: 'Expectativa do tratamento',
  servicos_explicacao: 'Explicação da massoterapeuta',
  servicos_atitude: 'Atitude e qualidade dos serviços',
  servicos_tecnica: 'Técnica e habilidade',
};
const _INSTALACOES_LABELS = {
  instalacoes_conforto: 'Conforto e conservação',
  instalacoes_organizacao: 'Organização da sala',
  instalacoes_conveniencia: 'Itens de conveniência',
};

async function abrirDetalheSessao(id) {
  if (!Number.isFinite(id) || id <= 0) return;
  const r = await api(`/api/reservas/${id}/detalhe`);
  if (!r) return;
  const d = await r.json();
  if (!d?.ok) return showToast('Erro ao carregar detalhe: ' + (d?.error || 'desconhecido'), 4000);

  _modalOpen = true;
  const { reserva, pessoa1, pessoa2 } = d;
  const ov = document.createElement('div');
  ov.id = 'detalhe-sessao-overlay';
  ov.className = 'confirm-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.76);backdrop-filter:blur(3px);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:2rem 1rem;overflow-y:auto';

  const dataLabel = fmt(reserva.data);
  const salaLabel = SALA_NOME[reserva.sala] || `Sala ${reserva.sala}`;
  const tratamento = reserva.tipo_massagem_nome || reserva.tratamento || '—';
  const massoterapeuta = reserva.massagista_nome || '—';
  const tratamento2 = reserva.tratamento2 || null;
  const massoterapeuta2 = reserva.massagista_nome2 || null;

  ov.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;width:100%;max-width:780px;box-shadow:0 24px 60px rgba(0,0,0,.5);display:flex;flex-direction:column;max-height:90vh;overflow:hidden">
      <header style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;padding:1.4rem 1.6rem 1rem;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface);z-index:2">
        <div style="flex:1;min-width:0">
          <div style="font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);font-weight:600;margin-bottom:.35rem">Atendimento • #${reserva.id}</div>
          <h2 style="font-family:var(--serif);font-size:1.65rem;font-weight:500;color:var(--text);margin:0 0 .35rem;line-height:1.15">${escHtml(reserva.cliente || '(sem cliente)')}</h2>
          <p style="margin:0;color:var(--muted2);font-size:.82rem">${dataLabel} · ${reserva.hora_inicio || ''}–${reserva.hora_fim || ''} · ${escHtml(salaLabel)}</p>
        </div>
        <button class="anamx-icon-btn" type="button" data-detsess-close="1" aria-label="Fechar" style="flex-shrink:0">✕</button>
      </header>
      <div style="overflow-y:auto;padding:1.1rem 1.6rem 1.6rem">
        ${_renderBlocoSessao({ pessoa: 1, pessoaData: pessoa1, cliente: reserva.cliente, apto: reserva.apto || reserva.quarto, telefone: reserva.telefone, email: reserva.email, tratamento, massoterapeuta, tipoCliente: reserva.tipo_cliente })}
        ${pessoa2 ? _renderBlocoSessao({ pessoa: 2, pessoaData: pessoa2, cliente: reserva.cliente2, apto: reserva.apto2 || reserva.quarto2, telefone: reserva.telefone2, email: reserva.email2, tratamento: tratamento2 || tratamento, massoterapeuta: massoterapeuta2 || massoterapeuta, tipoCliente: reserva.tipo_cliente2 || reserva.tipo_cliente }) : ''}
      </div>
    </div>
  `;
  ov.addEventListener('click', e => {
    if (e.target.closest('[data-detsess-close]')) {
      ov.remove();
      _modalOpen = false;
    }
  });
  document.body.appendChild(ov);
}

function _renderBlocoSessao({ pessoa, pessoaData, cliente, apto, telefone, email, tratamento, massoterapeuta, tipoCliente }) {
  const tipoLabel = TIPO_CLIENTE_LABEL[tipoCliente] || tipoCliente || '—';
  const tit = pessoa === 1 ? 'Hóspede' : 'Acompanhante';
  return `
    <section style="margin-bottom:1.6rem">
      <h3 style="font-family:var(--serif);font-size:1.15rem;font-weight:500;color:var(--text);margin:0 0 .8rem;padding-bottom:.4rem;border-bottom:1px solid var(--border)">
        ${tit}${pessoa === 2 ? '' : ''}
      </h3>
      <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.6rem;margin-bottom:1rem">
        ${_kpiSessao('Cliente', cliente || '—')}
        ${_kpiSessao('Apto / Quarto', apto || '—')}
        ${_kpiSessao('Tratamento', tratamento || '—')}
        ${_kpiSessao('Massoterapeuta', massoterapeuta || '—')}
        ${_kpiSessao('Tipo cliente', tipoLabel)}
        ${_kpiSessao('Contato', telefone || email || '—')}
      </div>
      ${_renderBlocoPesquisa(pessoaData)}
      ${_renderBlocoAnamnese(pessoaData?.anamnese)}
    </section>
  `;
}

function _kpiSessao(label, valor) {
  return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:.55rem .75rem">
    <div style="font-size:.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-weight:600;margin-bottom:.2rem">${escHtml(label)}</div>
    <div style="font-size:.88rem;color:var(--text);font-weight:500">${escHtml(valor)}</div>
  </div>`;
}

function _renderBlocoPesquisa(pData) {
  if (!pData) return '';
  const respondida = !!pData.pesquisa_respondida_em;
  const fb = pData.feedback;
  if (!respondida || !fb) {
    return `<div style="background:var(--bg);border:1px dashed var(--border);border-radius:8px;padding:.85rem 1rem;margin-bottom:.8rem">
      <div style="font-size:.7rem;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;font-weight:700;margin-bottom:.25rem">Pesquisa de Satisfação</div>
      <div style="color:var(--muted2);font-size:.85rem">${respondida ? 'Respondida, mas avaliação não localizada.' : 'Não respondida ainda.'}</div>
    </div>`;
  }
  const respondidaEm = pData.pesquisa_respondida_em
    ? new Date(pData.pesquisa_respondida_em.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  const notasServ = Object.entries(_SERVICOS_LABELS).map(([k, lbl]) => _rowNota(lbl, fb[k]));
  const notasInst = Object.entries(_INSTALACOES_LABELS).map(([k, lbl]) => _rowNota(lbl, fb[k]));
  const recomendaLabel = fb.recomenda === 'sim' ? 'Sim — recomenda' : fb.recomenda === 'nao' ? 'Não recomenda' : '—';
  const recomendaDetalhe = fb.recomenda_qual || fb.recomenda_porque || '';
  return `
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:.95rem 1.1rem;margin-bottom:.8rem">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;flex-wrap:wrap;margin-bottom:.65rem">
        <div style="font-size:.7rem;color:var(--success);letter-spacing:.1em;text-transform:uppercase;font-weight:700">✓ Pesquisa respondida</div>
        <div style="font-size:.7rem;color:var(--muted);font-family:var(--mono)">${respondidaEm}</div>
      </div>
      ${notasServ.join('')}
      ${notasInst.join('')}
      <div style="margin-top:.65rem;padding-top:.65rem;border-top:1px solid var(--border);font-size:.82rem;color:var(--text)">
        <strong style="color:var(--muted)">Recomendaria?</strong> ${escHtml(recomendaLabel)}${recomendaDetalhe ? ' — <em>' + escHtml(recomendaDetalhe) + '</em>' : ''}
      </div>
      ${fb.servicos_comentario ? `<div style="margin-top:.45rem;font-size:.82rem;color:var(--muted2)"><strong style="color:var(--muted)">Comentário (serviços):</strong> ${escHtml(fb.servicos_comentario)}</div>` : ''}
      ${fb.instalacoes_comentario ? `<div style="margin-top:.45rem;font-size:.82rem;color:var(--muted2)"><strong style="color:var(--muted)">Comentário (instalações):</strong> ${escHtml(fb.instalacoes_comentario)}</div>` : ''}
    </div>
  `;
}

function _rowNota(label, valor) {
  if (!valor) return '';
  const v = _RATINGS_FACES_LABEL[valor] || valor;
  return `<div style="display:flex;justify-content:space-between;font-size:.82rem;padding:.18rem 0;border-bottom:1px solid var(--border-soft)">
    <span style="color:var(--muted2)">${escHtml(label)}</span>
    <strong style="color:var(--text)">${escHtml(v)}</strong>
  </div>`;
}

function _renderBlocoAnamnese(anam) {
  if (!anam) {
    return `<div style="background:var(--bg);border:1px dashed var(--border);border-radius:8px;padding:.85rem 1rem">
      <div style="font-size:.7rem;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;font-weight:700;margin-bottom:.25rem">Anamnese</div>
      <div style="color:var(--muted2);font-size:.85rem">Sem anamnese vinculada.</div>
    </div>`;
  }
  const campos = [
    ['Nome completo', `${anam.nome || ''} ${anam.sobrenome || ''}`.trim()],
    ['Documento', `${(anam.tipo_documento || 'CPF').toUpperCase()} ${anam.documento || ''}`.trim()],
    ['E-mail', anam.email],
    ['Telefone', anam.telefone],
    ['Data nascimento', anam.data_nascimento],
    ['Nacionalidade', anam.nacionalidade],
    ['Rotina facial', anam.rotina_facial],
    ['Rotina corporal', anam.rotina_corporal],
    ['Produto específico', anam.produto_especifico],
    ['Pressão massagem', anam.pressao_massagem],
    ['Informações médicas', anam.info_medica],
  ];
  return `
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:.95rem 1.1rem">
      <div style="font-size:.7rem;color:var(--gold);letter-spacing:.1em;text-transform:uppercase;font-weight:700;margin-bottom:.65rem">Anamnese (somente leitura)</div>
      ${campos.filter(([_, v]) => v && String(v).trim()).map(([k, v]) =>
        `<div style="display:flex;justify-content:space-between;gap:1rem;font-size:.82rem;padding:.2rem 0;border-bottom:1px solid var(--border-soft)">
          <span style="color:var(--muted2);flex-shrink:0">${escHtml(k)}</span>
          <span style="color:var(--text);text-align:right;word-break:break-word">${escHtml(v)}</span>
        </div>`
      ).join('')}
      ${anam.assinatura_data_url ? `<div style="margin-top:.65rem;padding-top:.65rem;border-top:1px solid var(--border);font-size:.78rem;color:var(--muted)">Assinatura registrada ✓</div>` : ''}
    </div>
  `;
}

// ────────────────────────────────────────────────────────────────────────────
// MÓDULO 1: Clientes 360 (busca + detalhe com 4 abas: tratamentos, anamneses,
// pesquisas, produtos). Reusa apiSend (POST/PUT/DELETE com JSON).
// ────────────────────────────────────────────────────────────────────────────

let _cliCache = [];
let _cliSelId = null;

document.getElementById('btn-open-clientes')?.addEventListener('click', () => {
  showView('view-clientes'); initClienteView();
});
function initClienteView() {
  const inp = document.getElementById('cli-q');
  if (inp) {
    inp.oninput = debounce(loadClientesLista, 250);
    loadClientesLista();
  }
  // Tela Clientes 360 é somente leitura — criação acontece ao salvar reserva
  // com CPF inédito. Botões + Novo / Editar foram removidos a pedido.
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function fmtCpfMask(d) {
  d = (d || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return d;
}

// Validador CPF módulo-11 (espelha src/db.js#validarCpfMod11)
function validarCpfMod11(cpf) {
  cpf = (cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(.)\1+$/.test(cpf)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += +cpf[i] * (10 - i);
  let r = (s * 10) % 11; if (r >= 10) r = 0;
  if (r !== +cpf[9]) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += +cpf[i] * (11 - i);
  r = (s * 10) % 11; if (r >= 10) r = 0;
  return r === +cpf[10];
}
window.validarCpfMod11 = validarCpfMod11;
window.fmtCpfMask = fmtCpfMask;

function validarPassaporte(p) {
  return /^[A-Z0-9]{5,20}$/.test((p || '').trim().toUpperCase());
}

async function loadClientesLista() {
  const q = (document.getElementById('cli-q')?.value || '').trim();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const r = await api('/api/clientes?' + params);
  if (!r) return;
  const d = await r.json();
  if (!d.ok) return;
  _cliCache = d.items;
  const wrap = document.getElementById('cli-list');
  if (!d.items.length) {
    wrap.innerHTML = '<div class="empty" style="font-size:.85rem">Nenhum cliente encontrado.</div>';
    return;
  }
  wrap.innerHTML = d.items.map(c => `
    <button class="cli-card${c.id === _cliSelId ? ' is-active' : ''}" data-id="${c.id}"
      style="display:block;width:100%;text-align:left;padding:.6rem .7rem;border:1px solid var(--border);background:${c.id === _cliSelId ? 'var(--surface2)' : 'var(--bg)'};color:var(--text);border-radius:6px;cursor:pointer">
      <div style="font-weight:600;font-size:.92rem;color:var(--text)">${escHtml(c.nome)}</div>
      <div style="font-size:.74rem;color:var(--muted)">${escHtml(fmtCpfMask(c.cpf) || c.email || c.telefone || '—')}</div>
    </button>
  `).join('');
  wrap.querySelectorAll('button[data-id]').forEach(b => {
    b.addEventListener('click', () => selectCliente(parseInt(b.dataset.id)));
  });
}

async function selectCliente(id) {
  _cliSelId = id;
  // realça lista
  document.querySelectorAll('#cli-list .cli-card').forEach(c => {
    c.classList.toggle('is-active', parseInt(c.dataset.id) === id);
    c.style.background = parseInt(c.dataset.id) === id ? 'var(--surface2)' : 'var(--bg)';
  });
  const det = document.getElementById('cli-detail');
  det.innerHTML = '<div class="empty">Carregando…</div>';
  const r = await api('/api/clientes/' + id);
  if (!r) return;
  const d = await r.json();
  if (!d.ok) { det.innerHTML = '<div class="empty">Erro ao carregar cliente.</div>'; return; }
  renderClienteDetail(d);
}

function renderClienteDetail({ cliente: c, reservas, anamneses, pesquisas, produtos, gran_class }) {
  const det = document.getElementById('cli-detail');
  det.innerHTML = `
    <div style="margin-bottom:1rem">
      <div style="display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;margin-bottom:.3rem">
        <h2 style="margin:0;font-family:var(--serif);font-size:1.6rem">${escHtml(c.nome)}</h2>
      </div>
      <div style="display:flex;gap:1rem;flex-wrap:wrap;font-size:.85rem;color:var(--muted)">
        ${c.cpf ? `<span>CPF: <strong>${escHtml(fmtCpfMask(c.cpf))}</strong></span>` : ''}
        ${c.email ? `<span>✉ ${escHtml(c.email)}</span>` : ''}
        ${c.telefone ? `<span>☎ ${escHtml(c.telefone)}</span>` : ''}
        ${c.locale_pref ? `<span>🌐 ${escHtml(c.locale_pref)}</span>` : ''}
        ${c.nacionalidade ? `<span>🏳 ${escHtml(c.nacionalidade)}</span>` : ''}
      </div>
    </div>

    <!-- abas -->
    <div class="cli-tabs" style="display:flex;gap:.4rem;margin-bottom:1rem;border-bottom:1px solid var(--border)">
      <button class="cli-tab is-active" data-t="trat"  style="padding:.5rem .9rem;background:none;border:none;border-bottom:2px solid var(--gold);cursor:pointer;font-weight:600;color:var(--gold)">Tratamentos <span class="badge">${reservas.length}</span></button>
      <button class="cli-tab" data-t="anam" style="padding:.5rem .9rem;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;color:var(--muted)">Anamneses <span class="badge">${anamneses.length}</span></button>
      <button class="cli-tab" data-t="pesq" style="padding:.5rem .9rem;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;color:var(--muted)">Pesquisas <span class="badge">${pesquisas.length}</span></button>
      <button class="cli-tab" data-t="prod" style="padding:.5rem .9rem;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;color:var(--muted)">Produtos <span class="badge">${produtos.length}</span></button>
    </div>

    <div id="cli-pane-trat" class="cli-pane">${renderClienteReservas(reservas)}</div>
    <div id="cli-pane-anam" class="cli-pane" style="display:none">${renderClienteAnamneses(anamneses)}</div>
    <div id="cli-pane-pesq" class="cli-pane" style="display:none">${renderClientePesquisas(pesquisas)}</div>
    <div id="cli-pane-prod" class="cli-pane" style="display:none">${renderClienteProdutos(c.id, produtos)}</div>
  `;
  det.querySelectorAll('.cli-tab').forEach(b => b.addEventListener('click', () => {
    det.querySelectorAll('.cli-tab').forEach(t => {
      t.classList.remove('is-active'); t.style.borderBottomColor = 'transparent'; t.style.color = 'var(--muted)';
    });
    b.classList.add('is-active'); b.style.borderBottomColor = 'var(--gold)'; b.style.color = 'var(--gold)';
    const t = b.dataset.t;
    det.querySelectorAll('.cli-pane').forEach(p => p.style.display = 'none');
    document.getElementById('cli-pane-' + t).style.display = '';
  }));
  // Botão "Editar" removido — tela é somente leitura.
  // Wire dos botoes "Ver anamnese" e "Ver pesquisa"
  det.querySelectorAll('button[data-act="ver-anamnese"]').forEach(b =>
    b.addEventListener('click', () => _abrirModalAnamnesePreenchida(parseInt(b.dataset.id)))
  );
  det.querySelectorAll('button[data-act="ver-pesquisa"]').forEach(b =>
    b.addEventListener('click', () => _abrirModalPesquisaRespondida(parseInt(b.dataset.id)))
  );
  det.querySelectorAll('button[data-act="ver-feedback"]').forEach(b =>
    b.addEventListener('click', () => _abrirModalFeedbackRaw(parseInt(b.dataset.id)))
  );
  // Wire up botões dos produtos
  document.getElementById('btn-prod-add')?.addEventListener('click', () => adicionarProduto(c.id));
  det.querySelectorAll('button[data-prod-del]').forEach(b =>
    b.addEventListener('click', async () => {
      if (!await _confirmar('Remover este produto?')) return;
      await apiSend('DELETE', '/api/clientes/produtos/' + b.dataset.prodDel);
      selectCliente(c.id);
    })
  );
}

function renderClienteReservas(rs) {
  if (!rs.length) return '<div class="empty">Sem tratamentos registrados.</div>';
  return `<div class="table-wrap"><table style="font-size:.88rem"><thead>
    <tr><th>Data</th><th>Horário</th><th>Sala</th><th>Quarto</th><th>Tratamento</th><th>Cliente</th></tr>
  </thead><tbody>${rs.map(r => {
    const ehGC = r.quarto_categoria === 'gran_class';
    const gcBadge = ehGC ? ' <span style="display:inline-flex;align-items:center;gap:.18rem;padding:.1rem .4rem;border:1px solid #9C5843;border-radius:9999px;background:linear-gradient(180deg,#F5EFE2,#B8705A);color:#202C28;font-size:.67rem;font-weight:700;letter-spacing:.06em;vertical-align:middle">★ GC</span>' : '';
    return `<tr${ehGC ? ' style="background:rgba(212,166,74,.06)"' : ''}>
      <td>${fmtDataBR(r.data)}</td>
      <td>${escHtml((r.hora_inicio||'') + ' – ' + (r.hora_fim||''))}</td>
      <td style="text-align:center">${r.sala}</td>
      <td>${r.quarto ? escHtml(r.quarto) : '<em style="color:var(--muted);font-size:.82rem">passante</em>'}${gcBadge}</td>
      <td>${escHtml(r.tratamento || (r.tipo_massagem_id ? '#' + r.tipo_massagem_id : '—'))}</td>
      <td>${escHtml(r.cliente || '')}${r.cliente2 ? ' + ' + escHtml(r.cliente2) : ''}</td>
    </tr>`;
  }).join('')}</tbody></table></div>`;
}
function renderClienteAnamneses(as) {
  if (!as.length) return '<div class="empty">Cliente ainda não preencheu anamnese.</div>';
  return `<div style="color:var(--muted);font-size:.78rem;margin-bottom:.5rem">Cada linha é uma anamnese preenchida — pode ter mudado entre visitas. Clique "Ver" para conferir as respostas daquele momento.</div>
  <div class="table-wrap"><table style="font-size:.88rem"><thead>
    <tr><th>Data</th><th>Idioma</th><th>Reserva</th><th>Email</th><th>Telefone</th><th></th></tr>
  </thead><tbody>${as.map(a => {
    const ehResposta = a.fonte === 'resposta_pesquisa';
    // Modal correto conforme fonte: spa_perfil → modal completo; resposta_pesquisa → modal de respostas estruturadas
    const act = ehResposta ? 'ver-pesquisa' : 'ver-anamnese';
    return `<tr>
      <td>${fmtBRT(a.criado_em, { br: true }).slice(0, 10)}</td>
      <td>${escHtml(a.idioma || '—')}</td>
      <td>${a.reserva_id ? '#' + a.reserva_id : '—'}</td>
      <td>${escHtml(a.email || '—')}</td>
      <td>${escHtml(a.telefone || '—')}</td>
      <td><button class="btn btn-outline btn-sm" data-act="${act}" data-id="${a.id}">Ver</button></td>
    </tr>`;
  }).join('')}</tbody></table></div>`;
}
function _nomeAmigavelPesquisa(slug, titulo) {
  if (titulo && !slug?.match(/^spa-(anamnese|locc)/)) return titulo;
  if (!slug) return titulo || '—';
  if (slug.startsWith('spa-anamnese')) return 'Anamnese';
  if (slug.startsWith('spa-locc')) return 'Pesquisa de Satisfação';
  return titulo || slug;
}
function renderClientePesquisas(ps) {
  if (!ps.length) return '<div class="empty">Nenhuma pesquisa de satisfação respondida.</div>';
  return `<div style="color:var(--muted);font-size:.78rem;margin-bottom:.5rem">Cada pesquisa respondida ao final de um tratamento. Clique "Ver" para conferir as notas e comentários.</div>
  <div class="table-wrap"><table style="font-size:.88rem"><thead>
    <tr><th>Data</th><th>Pesquisa</th><th>Reserva</th><th></th></tr>
  </thead><tbody>${ps.map(p => {
    const isFb = p.fonte === 'fb';
    const btnAttr = isFb
      ? `data-act="ver-feedback" data-id="${p.feedback_id}"`
      : `data-act="ver-pesquisa" data-id="${p.id}"`;
    return `<tr>
      <td>${fmtBRT(p.submitted_at, { br: true })}</td>
      <td>${escHtml(_nomeAmigavelPesquisa(p.slug, p.pesquisa_titulo))}</td>
      <td>${p.reserva_id ? '#' + p.reserva_id : '—'}</td>
      <td><button class="btn btn-outline btn-sm" ${btnAttr}>Ver</button></td>
    </tr>`;
  }).join('')}</tbody></table></div>`;
}

// Modal de visualizacao completa de uma anamnese preenchida (spa_perfil)
async function _abrirModalAnamnesePreenchida(perfilId) {
  let dados = null, extras = [];
  try {
    const r = await api('/api/clientes/anamnese/' + perfilId);
    if (!r) return;
    const d = await r.json();
    if (!d.ok) { showToast('Erro ao carregar anamnese: ' + (d.error || ''), 5000); return; }
    dados = d.anamnese;
    extras = d.extras || [];
  } catch (e) { showToast('Erro: ' + e.message, 5000); return; }

  const a = dados;
  const dt = fmtBRT(a.criado_em, { br: true });
  const _ROW = 'display:grid;grid-template-columns:170px 1fr;gap:.4rem 1rem;padding:.52rem 0;border-bottom:1px solid rgba(184,147,90,.14);align-items:baseline';
  const _LBL = 'font-family:\'Raleway\',sans-serif;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:#7A6B5A;padding-top:.1rem;line-height:1.4';
  const _VAL = 'font-family:\'Raleway\',sans-serif;font-size:.875rem;color:#3A2010;line-height:1.5';
  const TIPO_DOC = { cpf:'CPF', passport:'Passaporte', passaporte:'Passaporte', rg:'RG', rne:'RNE' };
  const PRESSAO   = { low:'Leve', light:'Leve', soft:'Suave', medium:'Média', normal:'Normal', high:'Forte', firm:'Firme', strong:'Forte', hard:'Forte' };
  const fmtData   = v => v && /^\d{4}-\d{2}-\d{2}/.test(v) ? fmtDataBR(v.slice(0,10)) : (v || null);
  const _vazio = '<em style="color:#A99080;font-style:italic;font-size:.82rem;font-family:\'Raleway\',sans-serif">— vazio —</em>';
  const linhaCampo = (label, valor) => `
    <div style="${_ROW}">
      <div style="${_LBL}">${escHtml(label)}</div>
      <div style="${_VAL}">${valor != null && valor !== '' ? escHtml(String(valor)) : _vazio}</div>
    </div>`;
  const linhaLista = (label, arr) => {
    const items = (arr || []).filter(Boolean);
    const v = items.length ? items.map(i => `<span style="background:rgba(184,147,90,.12);color:#9C5843;border:1px solid rgba(156,88,67,.28);font-size:.74rem;padding:.18rem .58rem;border-radius:9999px;font-weight:600;font-family:'Raleway',sans-serif">${escHtml(i)}</span>`).join(' ') : _vazio;
    return `<div style="${_ROW}">
      <div style="${_LBL}">${escHtml(label)}</div>
      <div style="display:flex;gap:.3rem;flex-wrap:wrap;align-items:center;padding:.08rem 0">${v}</div>
    </div>`;
  };
  const linhaBool = (label, b) => `
    <div style="${_ROW}">
      <div style="${_LBL}">${escHtml(label)}</div>
      <div style="${_VAL}">${b ? '<span style="color:#2E7D56;font-weight:700;font-family:\'Raleway\',sans-serif">✓ Sim</span>' : '<span style="color:#B83232;font-weight:700;font-family:\'Raleway\',sans-serif">✗ Não</span>'}</div>
    </div>`;
  const _secBar = '<span style="display:inline-block;width:3px;height:1.05rem;background:linear-gradient(180deg,#B8935A,#9C5843);border-radius:9999px;flex-shrink:0;margin-right:.6rem;vertical-align:middle"></span>';
  const secaoTitulo = t => `<div style="display:flex;align-items:center;margin:1.4rem 0 .65rem">${_secBar}<h3 style="margin:0;font-family:'Raleway',sans-serif;font-weight:600;font-style:italic;font-size:1rem;color:#3A2010;letter-spacing:.01em">${escHtml(t)}</h3></div>`;
  // Render de um item extra (pergunta dinamica). Mesma logica anterior da
  // antiga "Secao 8" — agora invocado dentro de cada secao alvo.
  const renderExtra = (it) => {
    if (Array.isArray(it.valor_texto_rotulos) && it.valor_texto_rotulos.length) return linhaLista(it.rotulo, it.valor_texto_rotulos);
    if (it.escala_opcao_rotulo) return linhaCampo(it.rotulo, it.escala_opcao_rotulo);
    if (it.valor_texto_rotulo) return linhaCampo(it.rotulo, it.valor_texto_rotulo);
    if (it.valor_texto) {
      try { const arr = JSON.parse(it.valor_texto); if (Array.isArray(arr) && arr.length) return linhaLista(it.rotulo, arr); } catch {}
      return linhaCampo(it.rotulo, it.valor_texto);
    }
    if (it.escala_opcao_chave) return linhaCampo(it.rotulo, it.escala_opcao_chave);
    if (it.valor_numerico != null) return linhaCampo(it.rotulo, String(it.valor_numerico));
    return '';
  };
  // Agrupa extras por secao_chave e ordena por pergunta_ordem ASC.
  // Espelha o posicionamento do form cliente:
  //   dados_pessoais -> ao final da Secao 1
  //   saude_rotinas  -> ao final da Secao 5 (Info medica)
  //   consentimentos -> ao final da Secao 6
  //   custom (chave nao reconhecida) -> bloco proprio antes da Assinatura
  //   sem secao (NULL) -> bloco "Outros" antes da Assinatura
  const _SECOES_NATIVAS = new Set(['dados_pessoais', 'saude_rotinas', 'consentimentos']);
  const _grupoExtras = { dados_pessoais: [], saude_rotinas: [], consentimentos: [] };
  const _extrasCustom = new Map(); // chave -> { titulo, itens[] }
  const _extrasOrfaos = [];
  for (const it of extras) {
    const ch = it.secao_chave;
    if (ch && _SECOES_NATIVAS.has(ch)) _grupoExtras[ch].push(it);
    else if (ch) {
      if (!_extrasCustom.has(ch)) _extrasCustom.set(ch, { titulo: it.secao_titulo || ch, itens: [], ordem: it.secao_ordem ?? 999 });
      _extrasCustom.get(ch).itens.push(it);
    } else _extrasOrfaos.push(it);
  }
  const _ordPerg = (a, b) => (a.pergunta_ordem ?? 999) - (b.pergunta_ordem ?? 999);
  for (const k of Object.keys(_grupoExtras)) _grupoExtras[k].sort(_ordPerg);
  for (const g of _extrasCustom.values()) g.itens.sort(_ordPerg);
  const _customOrdenadas = [..._extrasCustom.values()].sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999));
  const _renderGrupo = (arr) => arr.map(renderExtra).join('');
  const _blocosCustom = _customOrdenadas.map(g => `${secaoTitulo(g.titulo)}${_renderGrupo(g.itens)}`).join('');
  const _blocoOrfaos = _extrasOrfaos.length ? `${secaoTitulo('Outros')}${_renderGrupo(_extrasOrfaos)}` : '';
  // Valor truncado em 1000 chars pelo bug antigo do san() — rejeitar: nunca é imagem válida
  const _sigUrl = typeof a.assinatura_data_url === 'string' && a.assinatura_data_url.startsWith('data:image') && a.assinatura_data_url.length > 1000 ? a.assinatura_data_url : null;
  const assinaturaHtml = _sigUrl
    ? `<img src="${_sigUrl}" alt="Assinatura do cliente" style="max-width:280px;max-height:120px;border:1px solid #D9CFC4;border-radius:8px;background:#fff;padding:.5rem;display:block;box-shadow:0 2px 10px rgba(36,21,8,.1)">`
    : _vazio;

  if (!document.getElementById('_am-style')) {
    const s = document.createElement('style');
    s.id = '_am-style';
    s.textContent = '@keyframes am-in{from{opacity:0;transform:translateY(10px) scale(.984)}to{opacity:1;transform:none}}';
    document.head.appendChild(s);
  }

  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(36,21,8,.52);backdrop-filter:blur(5px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  const _clienteNome = escHtml([a.nome, a.sobrenome].filter(Boolean).join(' ') || '—');
  ov.innerHTML = `
    <div style="background:#F7F3EC;border:1px solid #D9CFC4;border-radius:16px;width:100%;max-width:740px;height:88vh;display:flex;flex-direction:column;box-shadow:0 28px 70px rgba(36,21,8,.28),0 0 0 1px rgba(184,147,90,.12);overflow:hidden;animation:am-in .22s ease-out;font-family:'Raleway',sans-serif">

      <header style="display:flex;align-items:flex-start;justify-content:space-between;padding:1.4rem 1.65rem 1.2rem;border-bottom:1px solid #D9CFC4;background:linear-gradient(135deg,#F7F3EC 55%,#EDE7DA);gap:1rem;flex-shrink:0">
        <div>
          <div style="display:flex;align-items:center;gap:.65rem;margin-bottom:.3rem">
            <span style="display:inline-block;width:3px;height:1.5rem;background:linear-gradient(180deg,#B8935A,#9C5843);border-radius:9999px;flex-shrink:0"></span>
            <h2 style="margin:0;font-family:'Raleway',sans-serif;font-weight:700;font-size:1.3rem;color:#3A2010;letter-spacing:.01em">Anamnese preenchida</h2>
          </div>
          <p style="margin:.25rem 0 0 .85rem;color:#7A6B5A;font-size:.73rem;font-family:'Raleway',sans-serif;letter-spacing:.02em;line-height:1.5">${_clienteNome} · ${escHtml(dt)} · idioma ${escHtml(a.idioma || 'pt-BR')}${a.reserva_id ? ' · reserva #' + a.reserva_id : ''}</p>
        </div>
        <button data-act="close" title="Fechar" style="flex-shrink:0;background:none;border:1px solid #D9CFC4;border-radius:8px;width:2.1rem;height:2.1rem;font-size:.9rem;cursor:pointer;color:#7A6B5A;display:flex;align-items:center;justify-content:center;transition:background .15s,border-color .15s;margin-top:.1rem" onmouseover="this.style.background='rgba(156,88,67,.1)';this.style.borderColor='#B8935A'" onmouseout="this.style.background='none';this.style.borderColor='#D9CFC4'">✕</button>
      </header>

      <div style="flex:1;overflow-y:auto;padding:1rem 1.65rem 1.75rem;scroll-behavior:smooth">
        ${secaoTitulo('1. Dados pessoais')}
        ${linhaCampo('Nome', a.nome)}
        ${linhaCampo('Sobrenome', a.sobrenome)}
        ${linhaCampo('Tipo de documento', TIPO_DOC[(a.tipo_documento||'').toLowerCase()] || a.tipo_documento)}
        ${linhaCampo('Número do documento', a.documento)}
        ${linhaCampo('E-mail', a.email)}
        ${linhaCampo('Telefone', a.telefone)}
        ${linhaCampo('Data de nascimento', fmtData(a.data_nascimento))}
        ${linhaCampo('Nacionalidade', a.nacionalidade)}
        ${linhaCampo('Quarto', a.quarto || 'Passante')}
        ${_renderGrupo(_grupoExtras.dados_pessoais)}

        ${secaoTitulo('2. Rotina facial')}
        ${linhaLista('Itens usados', a.rotina_facial)}

        ${secaoTitulo('3. Rotina corporal')}
        ${linhaLista('Itens usados', a.rotina_corporal)}
        ${linhaCampo('Produto específico', a.produto_especifico)}

        ${secaoTitulo('4. Preferência de massagem')}
        ${linhaCampo('Pressão preferida', PRESSAO[(a.pressao_massagem||'').toLowerCase()] || a.pressao_massagem)}

        ${secaoTitulo('5. Informações médicas')}
        ${linhaCampo('Info médica relevante', a.info_medica)}
        ${_renderGrupo(_grupoExtras.saude_rotinas)}

        ${secaoTitulo('6. Consentimentos')}
        ${linhaBool('Apto a realizar tratamento', a.consentimento_saude)}
        ${linhaBool('Marketing autorizado', a.consentimento_marketing)}
        ${linhaLista('Canais autorizados', a.canais_marketing)}
        ${_renderGrupo(_grupoExtras.consentimentos)}

        ${_blocosCustom}
        ${_blocoOrfaos}

        ${secaoTitulo('7. Assinatura')}
        <div style="padding:.6rem 0">${assinaturaHtml}</div>
      </div>

      <footer style="padding:.9rem 1.65rem;border-top:1px solid #D9CFC4;background:linear-gradient(135deg,#F7F3EC,#EDE7DA);display:flex;justify-content:flex-end;flex-shrink:0">
        <button data-act="close" style="font-family:'Raleway',sans-serif;font-size:.82rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:.55rem 1.5rem;border-radius:8px;border:1px solid #C4A882;background:#fff;color:#4A2E1A;cursor:pointer;transition:all .15s;box-shadow:0 1px 4px rgba(36,21,8,.07)" onmouseover="this.style.background='#F7F3EC';this.style.borderColor='#9C5843'" onmouseout="this.style.background='#fff';this.style.borderColor='#C4A882'">Fechar</button>
      </footer>
    </div>
  `;
  function close() { ov.remove(); }
  ov.addEventListener('click', e => { if (e.target.closest('[data-act="close"]')) close(); });
  document.body.appendChild(ov);
}

// Modal de visualizacao das respostas de uma pesquisa de satisfacao ou anamnese
async function _abrirModalPesquisaRespondida(respostaId) {
  let resp = null, itens = [];
  try {
    const r = await api('/api/clientes/pesquisa/' + respostaId);
    if (!r) return;
    const d = await r.json();
    if (!d.ok) { showToast('Erro ao carregar pesquisa: ' + (d.error || ''), 5000); return; }
    resp = d.resposta; itens = d.itens || [];
  } catch (e) { showToast('Erro: ' + e.message, 5000); return; }

  const isAnamnese = !!(resp.pesquisa_slug?.startsWith('spa-anamnese'));

  // ── helpers compartilhados ────────────────────────────────────────────────
  const OPTS4 = ['ruim','regular','bom','otimo'];
  const OPTS4_L = { ruim:'Ruim', regular:'Regular', bom:'Bom', otimo:'Ótimo' };
  const OPTS4_C = { ruim:'#b83232', regular:'#c4721a', bom:'#2e7d56', otimo:'#9C5843' };
  const OPTS4_T = { ruim:'#fff', regular:'#fff', bom:'#fff', otimo:'#1a1008' };
  const r4 = sel => OPTS4.map(k => {
    if (k === sel) return `<div class="srm-opt srm-on" style="background:${OPTS4_C[k]};color:${OPTS4_T[k]};border-color:${OPTS4_C[k]}">${OPTS4_L[k]}</div>`;
    return `<div class="srm-opt">${OPTS4_L[k]}</div>`;
  }).join('');
  const ryn = sel => ['nao','sim'].map(k => {
    const c = k === 'sim' ? '#2e7d56' : '#b83232', l = k === 'sim' ? 'Sim' : 'Não';
    if (k === sel) return `<div class="srm-opt srm-on" style="background:${c};color:#fff;border-color:${c}">${l}</div>`;
    return `<div class="srm-opt">${l}</div>`;
  }).join('');

  // ── CSS unificado ─────────────────────────────────────────────────────────
  const CSS = `
    .srm-wrap{background:var(--surface);border:1px solid var(--border);border-radius:16px;width:100%;max-width:720px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 32px 80px rgba(0,0,0,.65),0 0 0 1px rgba(156,88,67,.08);overflow:hidden;animation:srm-in .2s ease-out}
    @keyframes srm-in{from{opacity:0;transform:translateY(7px) scale(.982)}to{opacity:1;transform:none}}
    .srm-head{display:flex;align-items:flex-start;justify-content:space-between;padding:1.35rem 1.6rem 1.15rem;border-bottom:1px solid var(--border);gap:1rem}
    .srm-head h2{margin:0;font-family:var(--serif);font-weight:500;font-size:1.65rem;color:var(--text);letter-spacing:-.01em;line-height:1.2}
    .srm-head p{margin:.3rem 0 0;color:var(--muted);font-size:.74rem;letter-spacing:.02em;line-height:1.5}
    .srm-body{flex:1;overflow-y:auto;padding:1.4rem 1.6rem;display:flex;flex-direction:column;gap:1.6rem}
    .srm-sec{display:flex;flex-direction:column;gap:1rem}
    .srm-sec-title{font-size:.63rem;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#9C5843;display:flex;align-items:center;gap:.55rem}
    .srm-sec-title::after{content:'';flex:1;height:1px;background:linear-gradient(to right,rgba(156,88,67,.4),transparent)}
    .srm-item{display:flex;flex-direction:column;gap:.5rem}
    .srm-q{font-size:.86rem;color:var(--text);line-height:1.45}
    .srm-opts{display:grid;grid-template-columns:repeat(4,1fr);gap:.38rem}
    .srm-opts--yn{grid-template-columns:repeat(2,1fr);max-width:200px}
    .srm-opt{display:flex;align-items:center;justify-content:center;padding:.45rem .3rem;border-radius:7px;border:1px solid #242424;font-size:.76rem;font-weight:600;letter-spacing:.03em;color:#3c3c3c;background:transparent;text-align:center;line-height:1.2;user-select:none}
    .srm-on{box-shadow:0 2px 14px rgba(0,0,0,.35)!important}
    .srm-comment{display:flex;flex-direction:column;gap:.38rem}
    .srm-comment-lbl{font-size:.64rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}
    .srm-comment-txt{background:rgba(156,88,67,.05);border-left:2px solid rgba(156,88,67,.4);padding:.65rem .9rem;border-radius:0 6px 6px 0;font-size:.85rem;color:var(--text);line-height:1.6;font-style:italic}
    .srm-foot{padding:.85rem 1.6rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end}
    .an-grid{display:flex;flex-direction:column}
    .an-row{display:grid;grid-template-columns:165px 1fr;gap:.75rem;padding:.52rem 0;border-bottom:1px solid rgba(255,255,255,.04);align-items:baseline}
    .an-lbl{color:var(--muted);font-size:.71rem;text-transform:uppercase;letter-spacing:.07em;line-height:1.4}
    .an-val{color:var(--text);font-size:.88rem;line-height:1.5}
    .an-tags{display:flex;flex-wrap:wrap;gap:.3rem;align-items:center}
    .an-tag{background:rgba(156,88,67,.1);color:#9C5843;border:1px solid rgba(156,88,67,.25);font-size:.76rem;padding:.18rem .55rem;border-radius:9999px;font-weight:500}
    .an-yes{color:#3d8a5c;font-weight:700;font-size:.87rem}
    .an-no{color:#c0392b;font-weight:700;font-size:.87rem}
  `;

  let titulo, subtitulo, corpoHtml;

  // ── ANAMNESE ──────────────────────────────────────────────────────────────
  if (isAnamnese) {
    const byK = {};
    for (const it of itens) { (byK[it.pergunta_chave] = byK[it.pergunta_chave] || []).push(it); }
    // Chaves gravadas com prefixo 'anamnese_' (spa.js) também acessíveis sem prefixo
    for (const [k, v] of Object.entries(byK)) {
      if (k.startsWith('anamnese_')) { const bare = k.slice(9); if (!byK[bare]) byK[bare] = v; }
    }

    const getText  = k => byK[k]?.[0]?.valor_texto  ?? null;
    const getOpcR  = k => byK[k]?.[0]?.escala_opcao_rotulo ?? byK[k]?.[0]?.escala_opcao_chave ?? null;
    const getOpc   = k => byK[k]?.[0]?.escala_opcao_chave ?? null;
    const getAll   = k => (byK[k] || []).map(i => i.escala_opcao_rotulo || i.escala_opcao_chave).filter(Boolean);
    const tryArr   = v => { try { const j = JSON.parse(v); return Array.isArray(j) ? j : null; } catch { return null; } };
    const toBool   = v => /^(true|1|sim|yes)$/i.test(String(v || ''));

    const TIPO_DOC = { cpf:'CPF', passport:'Passaporte', passaporte:'Passaporte', rg:'RG', rne:'RNE' };
    const PRESSAO  = { low:'Leve', light:'Leve', soft:'Suave', medium:'Média', normal:'Normal', high:'Forte', firm:'Firme', strong:'Forte', hard:'Forte' };

    const tagsHtml = arr => arr.filter(Boolean).map(x => `<span class="an-tag">${escHtml(x)}</span>`).join('');

    const txtRow = (lbl, val) => {
      if (val == null || val === '') return '';
      const arr = tryArr(val);
      if (arr?.length) return `<div class="an-row"><div class="an-lbl">${escHtml(lbl)}</div><div class="an-val an-tags">${tagsHtml(arr)}</div></div>`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(val)) val = fmtDataBR(val);
      return `<div class="an-row"><div class="an-lbl">${escHtml(lbl)}</div><div class="an-val">${escHtml(String(val))}</div></div>`;
    };
    const multiRow = (lbl, k) => {
      const all = getAll(k);
      if (!all.length) return txtRow(lbl, getText(k));
      return `<div class="an-row"><div class="an-lbl">${escHtml(lbl)}</div><div class="an-val an-tags">${tagsHtml(all)}</div></div>`;
    };
    const boolRow = (lbl, k) => {
      const raw = getText(k) || getOpc(k);
      if (!raw) return '';
      const pos = toBool(raw);
      return `<div class="an-row"><div class="an-lbl">${escHtml(lbl)}</div><div class="an-val"><span class="${pos ? 'an-yes' : 'an-no'}">${pos ? '✓ Sim' : '✗ Não'}</span></div></div>`;
    };
    const opcRow = (lbl, k, mapa) => {
      const raw = getOpcR(k) || getText(k);
      if (!raw) return '';
      const fmt = mapa?.[raw.toLowerCase()] || raw;
      return `<div class="an-row"><div class="an-lbl">${escHtml(lbl)}</div><div class="an-val">${escHtml(fmt)}</div></div>`;
    };

    const sigVal = getText('assinatura_digital') || getText('assinatura');
    const sigHtml = sigVal && sigVal.startsWith('data:image')
      ? `<img src="${sigVal}" style="max-width:300px;max-height:130px;border:1px solid rgba(255,255,255,.15);border-radius:8px;background:#fff;padding:.4rem;display:block;box-shadow:0 2px 12px rgba(0,0,0,.4)">`
      : sigVal ? `<span class="an-tag" style="font-size:.83rem">✓ Assinatura registrada</span>`
      : `<em style="color:#9a8f82;font-size:.85rem">— sem assinatura registrada —</em>`;

    const nomeFull = [getText('nome'), getText('sobrenome')].filter(Boolean).join(' ');
    const tipoDocR = getOpcR('tipo_documento') || getText('tipo_documento') || '';
    const tipoDocF = TIPO_DOC[tipoDocR.toLowerCase()] || tipoDocR;
    const docNum   = getText('documento') || getText('numero_documento') || '';
    const nascRaw  = getText('data_nascimento');
    const pressaoR = getOpcR('pressao_massagem') || getText('pressao_massagem') || getText('pressao_preferida') || '';
    const pressaoF = PRESSAO[pressaoR.toLowerCase()] || pressaoR;

    const temIdent   = nomeFull || tipoDocR || docNum || nascRaw || getText('quarto');
    const temContato = getText('email') || getText('telefone');
    const temRotina  = byK['rotina_facial'] || byK['rotina_corporal'] || pressaoR || getText('produto_especifico');
    const temSaude   = getText('info_medica') || getText('informacoes_medicas');
    const temConsent = byK['consentimento_saude'] || byK['consentimento_marketing'] || byK['canais_marketing'];
    const KNOWN_ANAM_KEYS = new Set([
      'nome','sobrenome','tipo_documento','documento','numero_documento','email','telefone',
      'data_nascimento','quarto','rotina_facial','rotina_corporal','produto_especifico',
      'pressao_massagem','pressao_preferida','info_medica','informacoes_medicas',
      'consentimento_saude','consentimento_marketing','canais_marketing',
      'assinatura','assinatura_digital',
    ]);
    const anamExtras = itens.filter(it => !it.pergunta_chave.startsWith('anamnese_') && !KNOWN_ANAM_KEYS.has(it.pergunta_chave));

    corpoHtml = `
      ${temIdent ? `<div class="srm-sec"><div class="srm-sec-title">✦ Identificação</div><div class="an-grid">
        ${nomeFull ? `<div class="an-row"><div class="an-lbl">Nome completo</div><div class="an-val" style="font-weight:500">${escHtml(nomeFull)}</div></div>` : ''}
        ${tipoDocF || docNum ? `<div class="an-row"><div class="an-lbl">Documento</div><div class="an-val">${escHtml([tipoDocF, docNum].filter(Boolean).join(' · '))}</div></div>` : ''}
        ${nascRaw ? `<div class="an-row"><div class="an-lbl">Nascimento</div><div class="an-val">${fmtDataBR(nascRaw)}</div></div>` : ''}
        <div class="an-row"><div class="an-lbl">Quarto</div><div class="an-val">${escHtml(getText('quarto') || 'Passante')}</div></div>
      </div></div>` : ''}
      ${temContato ? `<div class="srm-sec"><div class="srm-sec-title">✦ Contato</div><div class="an-grid">
        ${txtRow('E-mail', getText('email'))}
        ${txtRow('Telefone', getText('telefone'))}
      </div></div>` : ''}
      ${temRotina ? `<div class="srm-sec"><div class="srm-sec-title">✦ Rotina & Preferências</div><div class="an-grid">
        ${multiRow('Rotina facial', 'rotina_facial')}
        ${multiRow('Rotina corporal', 'rotina_corporal')}
        ${txtRow('Produto específico', getText('produto_especifico'))}
        ${pressaoF ? `<div class="an-row"><div class="an-lbl">Pressão de massagem</div><div class="an-val">${escHtml(pressaoF)}</div></div>` : ''}
      </div></div>` : ''}
      ${temSaude ? `<div class="srm-sec"><div class="srm-sec-title">✦ Saúde</div><div class="an-grid">
        ${txtRow('Informações médicas', getText('info_medica') || getText('informacoes_medicas'))}
      </div></div>` : ''}
      ${temConsent ? `<div class="srm-sec"><div class="srm-sec-title">✦ Consentimentos</div><div class="an-grid">
        ${boolRow('Apto ao tratamento', 'consentimento_saude')}
        ${boolRow('Autoriza marketing', 'consentimento_marketing')}
        ${multiRow('Canais autorizados', 'canais_marketing')}
      </div></div>` : ''}
      <div class="srm-sec"><div class="srm-sec-title">✦ Assinatura</div><div style="padding:.35rem 0">${sigHtml}</div></div>
      ${anamExtras.length ? `<div class="srm-sec"><div class="srm-sec-title">✦ Perguntas adicionais</div><div class="an-grid">
        ${anamExtras.map(it => {
          const lbl = it.rotulo || it.pergunta_chave;
          // Prioridade: rotulos resolvidos pelo backend (Sim, Ombros, etc)
          if (Array.isArray(it.valor_texto_rotulos) && it.valor_texto_rotulos.length) return `<div class="an-row"><div class="an-lbl">${escHtml(lbl)}</div><div class="an-val an-tags">${tagsHtml(it.valor_texto_rotulos)}</div></div>`;
          if (it.escala_opcao_rotulo) return `<div class="an-row"><div class="an-lbl">${escHtml(lbl)}</div><div class="an-val">${escHtml(it.escala_opcao_rotulo)}</div></div>`;
          if (it.valor_texto_rotulo) return `<div class="an-row"><div class="an-lbl">${escHtml(lbl)}</div><div class="an-val">${escHtml(it.valor_texto_rotulo)}</div></div>`;
          if (it.valor_texto) {
            try { const arr = JSON.parse(it.valor_texto); if (Array.isArray(arr) && arr.length) return `<div class="an-row"><div class="an-lbl">${escHtml(lbl)}</div><div class="an-val an-tags">${tagsHtml(arr)}</div></div>`; } catch {}
            return txtRow(lbl, it.valor_texto);
          }
          if (it.escala_opcao_chave) return `<div class="an-row"><div class="an-lbl">${escHtml(lbl)}</div><div class="an-val">${escHtml(it.escala_opcao_chave)}</div></div>`;
          return '';
        }).join('')}
      </div></div>` : ''}
    `;
    titulo    = 'Anamnese preenchida';
    subtitulo = `${escHtml(nomeFull || 'Anamnese')} · ${escHtml(fmtBRT(resp.submitted_at, { br: true }))}${resp.reserva_id ? ' · reserva #' + resp.reserva_id : ''}`;

  // ── PESQUISA DE SATISFAÇÃO ────────────────────────────────────────────────
  } else {
    const byKey = {};
    for (const it of itens) { if (!byKey[it.pergunta_chave]) byKey[it.pergunta_chave] = it; }
    const SERV  = ['servicos_expectativa','servicos_explicacao','servicos_atitude','servicos_tecnica'];
    const INST  = ['instalacoes_conforto','instalacoes_organizacao','instalacoes_conveniencia'];
    const KNOWN = new Set([...SERV,...INST,'recomenda','servicos_comentario','instalacoes_comentario','recomenda_qual','recomenda_porque']);
    const item4 = k => {
      const it = byKey[k]; if (!it) return '';
      return `<div class="srm-item"><div class="srm-q">${escHtml(it.rotulo || k)}</div><div class="srm-opts">${r4(it.escala_opcao_chave)}</div></div>`;
    };
    const commentIt = k => {
      const it = byKey[k]; if (!it || !it.valor_texto) return '';
      return `<div class="srm-comment"><div class="srm-comment-lbl">${escHtml(it.rotulo || k)}</div><div class="srm-comment-txt">${escHtml(it.valor_texto)}</div></div>`;
    };
    const extrasItens = itens.filter(it => !KNOWN.has(it.pergunta_chave));
    const extrasHtml  = extrasItens.map(it => {
      const lbl = it.rotulo || it.pergunta_chave;
      // multipla: usa rotulos resolvidos pelo backend
      if (Array.isArray(it.valor_texto_rotulos) && it.valor_texto_rotulos.length) {
        const tags = it.valor_texto_rotulos.map(x => `<span style="background:rgba(156,88,67,.12);color:#9C5843;border:1px solid rgba(156,88,67,.3);font-size:.78rem;padding:.2rem .65rem;border-radius:9999px;font-weight:600;margin-right:.3rem">${escHtml(x)}</span>`).join('');
        return `<div class="srm-item"><div class="srm-q">${escHtml(lbl)}</div><div style="display:flex;flex-wrap:wrap;gap:.3rem">${tags}</div></div>`;
      }
      if (it.valor_texto) return `<div class="srm-comment"><div class="srm-comment-lbl">${escHtml(lbl)}</div><div class="srm-comment-txt">${escHtml(it.valor_texto)}</div></div>`;
      if (it.escala_opcao_chave) {
        if (OPTS4.includes(it.escala_opcao_chave)) return `<div class="srm-item"><div class="srm-q">${escHtml(lbl)}</div><div class="srm-opts">${r4(it.escala_opcao_chave)}</div></div>`;
        if (['sim','nao'].includes(it.escala_opcao_chave)) return `<div class="srm-item"><div class="srm-q">${escHtml(lbl)}</div><div class="srm-opts srm-opts--yn">${ryn(it.escala_opcao_chave)}</div></div>`;
        return `<div class="srm-item"><div class="srm-q">${escHtml(lbl)}</div><div><span style="background:rgba(156,88,67,.12);color:#9C5843;border:1px solid rgba(156,88,67,.3);font-size:.78rem;padding:.2rem .65rem;border-radius:9999px;font-weight:600">${escHtml(it.escala_opcao_rotulo||it.escala_opcao_chave)}</span></div></div>`;
      }
      return '';
    }).join('');

    corpoHtml = itens.length === 0
      ? '<div style="padding:2rem;text-align:center;color:var(--muted)">Nenhuma resposta registrada.</div>'
      : `
        ${SERV.some(k => byKey[k]) ? `<div class="srm-sec"><div class="srm-sec-title">✦ Serviços</div>${item4('servicos_expectativa')}${item4('servicos_explicacao')}${item4('servicos_atitude')}${item4('servicos_tecnica')}${commentIt('servicos_comentario')}</div>` : ''}
        ${INST.some(k => byKey[k]) ? `<div class="srm-sec"><div class="srm-sec-title">✦ Instalações</div>${item4('instalacoes_conforto')}${item4('instalacoes_organizacao')}${item4('instalacoes_conveniencia')}${commentIt('instalacoes_comentario')}</div>` : ''}
        ${byKey['recomenda'] ? `<div class="srm-sec"><div class="srm-sec-title">✦ Recomendação</div><div class="srm-item"><div class="srm-q">${escHtml(byKey['recomenda'].rotulo || 'Recomendaria nossos serviços?')}</div><div class="srm-opts srm-opts--yn">${ryn(byKey['recomenda'].escala_opcao_chave)}</div></div>${commentIt('recomenda_qual')}${commentIt('recomenda_porque')}</div>` : ''}
        ${extrasHtml ? `<div class="srm-sec"><div class="srm-sec-title">✦ Outras perguntas</div>${extrasHtml}</div>` : ''}
      `;
    titulo    = 'Pesquisa respondida';
    subtitulo = `${escHtml(_nomeAmigavelPesquisa(resp.pesquisa_slug, resp.pesquisa_titulo))} · ${escHtml(fmtBRT(resp.submitted_at, { br: true }))}${resp.reserva_id ? ' · reserva #' + resp.reserva_id : ''}`;
  }

  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.82);backdrop-filter:blur(5px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  ov.innerHTML = `
    <style>${CSS}</style>
    <div class="srm-wrap">
      <div class="srm-head">
        <div><h2>${titulo}</h2><p>${subtitulo}</p></div>
        <button class="btn btn-outline btn-sm" data-act="close" style="flex-shrink:0">✕</button>
      </div>
      <div class="srm-body">${corpoHtml}</div>
      <div class="srm-foot"><button class="btn btn-outline" data-act="close">Fechar</button></div>
    </div>
  `;
  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
  ov.addEventListener('click', e => { if (e.target.dataset.act === 'close' || e.target === ov) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}
async function _abrirModalFeedbackRaw(feedbackId) {
  let fb = null;
  try {
    const r = await api('/api/feedback/item/' + feedbackId);
    if (!r) return;
    const d = await r.json();
    if (!d.ok) { showToast('Erro ao carregar pesquisa: ' + (d.error || ''), 5000); return; }
    fb = d.item;
  } catch (e) { showToast('Erro: ' + e.message, 5000); return; }

  const OPTS4 = ['ruim','regular','bom','otimo'];
  const OPTS4_L = { ruim:'Ruim', regular:'Regular', bom:'Bom', otimo:'Ótimo' };
  const OPTS4_C = { ruim:'#b83232', regular:'#c4721a', bom:'#2e7d56', otimo:'#9C5843' };
  const OPTS4_T = { ruim:'#fff', regular:'#fff', bom:'#fff', otimo:'#1a1008' };

  const r4 = sel => OPTS4.map(k => {
    if (k === sel) return `<div class="srm-opt srm-on" style="background:${OPTS4_C[k]};color:${OPTS4_T[k]};border-color:${OPTS4_C[k]}">${OPTS4_L[k]}</div>`;
    return `<div class="srm-opt">${OPTS4_L[k]}</div>`;
  }).join('');

  const ryn = sel => ['nao','sim'].map(k => {
    const c = k === 'sim' ? '#2e7d56' : '#b83232', l = k === 'sim' ? 'Sim' : 'Não';
    if (k === sel) return `<div class="srm-opt srm-on" style="background:${c};color:#fff;border-color:${c}">${l}</div>`;
    return `<div class="srm-opt">${l}</div>`;
  }).join('');

  const item4 = (q, k) => `<div class="srm-item"><div class="srm-q">${escHtml(q)}</div><div class="srm-opts">${r4(fb[k])}</div></div>`;
  const comment = (lbl, val) => val ? `<div class="srm-comment"><div class="srm-comment-lbl">${escHtml(lbl)}</div><div class="srm-comment-txt">${escHtml(val)}</div></div>` : '';

  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.82);backdrop-filter:blur(5px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  ov.innerHTML = `
    <style>
      .srm-wrap{background:var(--surface);border:1px solid var(--border);border-radius:16px;width:100%;max-width:700px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 32px 80px rgba(0,0,0,.65),0 0 0 1px rgba(156,88,67,.08);overflow:hidden;animation:srm-in .2s ease-out}
      @keyframes srm-in{from{opacity:0;transform:translateY(7px) scale(.982)}to{opacity:1;transform:none}}
      .srm-head{display:flex;align-items:flex-start;justify-content:space-between;padding:1.35rem 1.6rem 1.15rem;border-bottom:1px solid var(--border);gap:1rem}
      .srm-head h2{margin:0;font-family:var(--serif);font-weight:500;font-size:1.65rem;color:var(--text);letter-spacing:-.01em;line-height:1.2}
      .srm-head p{margin:.3rem 0 0;color:var(--muted);font-size:.74rem;letter-spacing:.02em;line-height:1.5}
      .srm-body{flex:1;overflow-y:auto;padding:1.4rem 1.6rem;display:flex;flex-direction:column;gap:1.6rem}
      .srm-sec{display:flex;flex-direction:column;gap:1rem}
      .srm-sec-title{font-size:.63rem;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#9C5843;display:flex;align-items:center;gap:.55rem;padding-bottom:.1rem}
      .srm-sec-title::after{content:'';flex:1;height:1px;background:linear-gradient(to right,rgba(156,88,67,.4),transparent)}
      .srm-item{display:flex;flex-direction:column;gap:.5rem}
      .srm-q{font-size:.86rem;color:var(--text);line-height:1.45}
      .srm-opts{display:grid;grid-template-columns:repeat(4,1fr);gap:.38rem}
      .srm-opts--yn{grid-template-columns:repeat(2,1fr);max-width:200px}
      .srm-opt{display:flex;align-items:center;justify-content:center;padding:.45rem .3rem;border-radius:7px;border:1px solid #242424;font-size:.76rem;font-weight:600;letter-spacing:.03em;color:#3c3c3c;background:transparent;text-align:center;line-height:1.2;user-select:none}
      .srm-on{box-shadow:0 2px 14px rgba(0,0,0,.35)!important}
      .srm-comment{display:flex;flex-direction:column;gap:.38rem}
      .srm-comment-lbl{font-size:.64rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}
      .srm-comment-txt{background:rgba(156,88,67,.05);border-left:2px solid rgba(156,88,67,.4);padding:.65rem .9rem;border-radius:0 6px 6px 0;font-size:.85rem;color:var(--text);line-height:1.6;font-style:italic}
      .srm-foot{padding:.85rem 1.6rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end}
    </style>
    <div class="srm-wrap">
      <div class="srm-head">
        <div>
          <h2>Pesquisa respondida</h2>
          <p>Pesquisa de Satisfação · ${escHtml(fmtBRT(fb.submitted_at, { br: true }))}${fb.reserva_id ? ' · reserva #' + fb.reserva_id : ''}</p>
        </div>
        <button class="btn btn-outline btn-sm" data-act="close" style="flex-shrink:0">✕</button>
      </div>
      <div class="srm-body">
        <div class="srm-sec">
          <div class="srm-sec-title">✦ Serviços</div>
          ${item4('Expectativa do tratamento', 'servicos_expectativa')}
          ${item4('Explicação da massoterapeuta sobre benefícios e procedimentos', 'servicos_explicacao')}
          ${item4('Atitude e qualidade dos serviços da massoterapeuta', 'servicos_atitude')}
          ${item4('Técnica e habilidade da massoterapeuta', 'servicos_tecnica')}
          ${comment('Comentário — serviços', fb.servicos_comentario)}
        </div>
        <div class="srm-sec">
          <div class="srm-sec-title">✦ Instalações</div>
          ${item4('Conforto e conservação da estrutura', 'instalacoes_conforto')}
          ${item4('Organização da sala, equipamentos e atmosfera', 'instalacoes_organizacao')}
          ${item4('Itens de conveniência (roupões, toalhas, etc.)', 'instalacoes_conveniencia')}
          ${comment('Comentário — instalações', fb.instalacoes_comentario)}
        </div>
        ${fb.recomenda ? `<div class="srm-sec">
          <div class="srm-sec-title">✦ Recomendação</div>
          <div class="srm-item">
            <div class="srm-q">Recomendaria nossos serviços?</div>
            <div class="srm-opts srm-opts--yn">${ryn(fb.recomenda)}</div>
          </div>
          ${comment('Por que recomendaria', fb.recomenda_qual)}
          ${comment('Por que não recomendaria', fb.recomenda_porque)}
        </div>` : ''}
      </div>
      <div class="srm-foot">
        <button class="btn btn-outline" data-act="close">Fechar</button>
      </div>
    </div>
  `;
  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
  ov.addEventListener('click', e => { if (e.target.dataset.act === 'close' || e.target === ov) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}
function renderClienteProdutos(cliId, prods) {
  return `
    <div style="margin-bottom:.8rem">
      <button class="btn btn-primary btn-sm" id="btn-prod-add">+ Lançar produto</button>
    </div>
    ${prods.length ? `<div class="table-wrap"><table style="font-size:.88rem"><thead>
      <tr><th>Produto</th><th>Categoria</th><th>Valor</th><th>Data</th><th>Obs</th><th></th></tr>
    </thead><tbody>${prods.map(p => `
      <tr>
        <td>${escHtml(p.produto_nome)}</td>
        <td>${escHtml(p.categoria || '')}</td>
        <td>${p.valor != null ? 'R$ ' + p.valor.toFixed(2) : '—'}</td>
        <td>${escHtml(p.data_compra || '')}</td>
        <td>${escHtml(p.observacao || '')}</td>
        <td><button class="btn btn-outline btn-sm" data-prod-del="${p.id}">×</button></td>
      </tr>
    `).join('')}</tbody></table></div>` : '<div class="empty">Sem produtos lançados.</div>'}
  `;
}

async function criarClienteNovo() {
  const nome = prompt('Nome do cliente:');
  if (!nome) return;
  const cpf = prompt('CPF (opcional):') || '';
  if (cpf && !validarCpfMod11(cpf)) { showToast('CPF inválido', 4000); return; }
  const email = prompt('E-mail (opcional):') || '';
  const tel = prompt('Telefone (opcional):') || '';
  try {
    const r = await apiSend('POST', '/api/clientes', { nome, cpf: cpf.replace(/\D/g,''), email, telefone: tel });
    showToast('Cliente criado');
    document.getElementById('cli-q').value = nome;
    await loadClientesLista();
    if (r?.id) selectCliente(r.id);
  } catch (e) { showToast('Erro: ' + e.message, 5000); }
}

async function editarCliente(c) {
  const nome = prompt('Nome:', c.nome); if (nome === null) return;
  const cpf = prompt('CPF:', fmtCpfMask(c.cpf || '')); if (cpf === null) return;
  if (cpf && !validarCpfMod11(cpf)) { showToast('CPF inválido', 4000); return; }
  const email = prompt('E-mail:', c.email || ''); if (email === null) return;
  const tel = prompt('Telefone:', c.telefone || ''); if (tel === null) return;
  try {
    await apiSend('PUT', '/api/clientes/' + c.id, {
      nome, cpf: cpf.replace(/\D/g, ''), email, telefone: tel,
    });
    showToast('Atualizado'); selectCliente(c.id);
  } catch (e) { showToast('Erro: ' + e.message, 5000); }
}

// ── Modal de produto (lançar) ─────────────────────────────────────────────
function _abrirModalProduto(cliId) {
  const ov  = document.getElementById('prod-modal-overlay');
  const err = document.getElementById('prod-modal-err');
  if (!ov) return;
  // Limpa
  ['prod-inp-nome','prod-inp-categoria','prod-inp-valor','prod-inp-data'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  if (err) err.textContent = '';
  ov.style.display = 'flex';
  setTimeout(() => document.getElementById('prod-inp-nome')?.focus(), 50);

  const close = () => { ov.style.display = 'none'; };

  const saveHandler = async () => {
    const produto_nome = (document.getElementById('prod-inp-nome')?.value || '').trim();
    if (!produto_nome) { if (err) err.textContent = 'Informe o nome do produto.'; return; }
    const categoria   = (document.getElementById('prod-inp-categoria')?.value || '').trim() || null;
    const valorRaw    = (document.getElementById('prod-inp-valor')?.value || '').trim();
    const valor       = valorRaw ? parseFloat(valorRaw.replace(',', '.')) : null;
    const data_compra = (document.getElementById('prod-inp-data')?.value || '').trim() || null;
    if (valorRaw && isNaN(valor)) { if (err) err.textContent = 'Valor inválido.'; return; }
    const btn = document.getElementById('prod-modal-save');
    if (btn) btn.disabled = true;
    try {
      await apiSend('POST', `/api/clientes/${cliId}/produtos`, { produto_nome, categoria, valor, data_compra });
      close(); showToast('Produto lançado'); selectCliente(cliId);
    } catch (e) {
      if (err) err.textContent = 'Erro: ' + (e.message || 'tente novamente');
    } finally { if (btn) btn.disabled = false; }
  };

  // Remove listeners antigos (troca o nó pelo clone)
  const xBtn     = document.getElementById('prod-modal-x');
  const cancelBtn = document.getElementById('prod-modal-cancel');
  const saveBtn   = document.getElementById('prod-modal-save');
  const replaceBtn = (el, handler) => {
    if (!el) return;
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
    clone.addEventListener('click', handler);
  };
  replaceBtn(xBtn,     close);
  replaceBtn(cancelBtn, close);
  replaceBtn(saveBtn,   saveHandler);

  // Fechar com Escape
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  // Fechar ao clicar fora
  ov.onclick = (e) => { if (e.target === ov) close(); };
}

function adicionarProduto(cliId) {
  _abrirModalProduto(cliId);
}

// ── Modal de confirmação genérica ─────────────────────────────────────────
function _confirmar(msg) {
  return new Promise(resolve => {
    const ov  = document.getElementById('confirm-modal-overlay');
    const txt = document.getElementById('confirm-modal-msg');
    if (!ov) { resolve(window.confirm(msg)); return; }
    if (txt) txt.textContent = msg;
    ov.style.display = 'flex';

    const done = (result) => {
      ov.style.display = 'none';
      document.removeEventListener('keydown', onKey);
      ov.onclick = null;
      resolve(result);
    };

    const replaceBtn = (id, val) => {
      const el = document.getElementById(id);
      if (!el) return;
      const clone = el.cloneNode(true);
      el.parentNode.replaceChild(clone, el);
      clone.addEventListener('click', () => done(val));
    };
    replaceBtn('confirm-modal-x',      false);
    replaceBtn('confirm-modal-cancel', false);
    replaceBtn('confirm-modal-ok',     true);

    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    ov.onclick = (e) => { if (e.target === ov) done(false); };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Validação client-side do campo "Quarto" (Nova Reserva) + badge Gran Class.
// Backend ainda valida e bloqueia, mas client-side dá feedback imediato.
// ────────────────────────────────────────────────────────────────────────────
(async function wireUpReservaQuarto() {
  await _carregarQuartos();
  const inp = document.getElementById('res-inp-apto');
  const info = document.getElementById('res-quarto-info');
  if (!inp || !info) return;
  inp.addEventListener('input', function () {
    // Mantém só dígitos no campo (não obrigatório, mas evita lixo)
    const onlyDigits = this.value.replace(/\D/g, '').slice(0, 4);
    if (onlyDigits !== this.value) this.value = onlyDigits;
    if (!onlyDigits) { info.style.display = 'none'; return; }
    if (onlyDigits.length < 4) {
      info.style.color = 'var(--muted)';
      info.textContent = 'Digite os 4 dígitos do quarto (ex: 0501, 1401)';
      info.style.display = '';
      return;
    }
    const cat = quartoCategoria(onlyDigits);
    if (!cat) {
      info.style.color = 'var(--danger)';
      info.textContent = '⚠ Quarto inexistente. Confira o número.';
      info.style.display = '';
    } else if (cat === 'gran_class') {
      info.style.color = '';
      info.innerHTML = `★ ${badgeGranClassHtml('Cliente Gran Class')} <span style="color:var(--muted);margin-left:.4rem">Atendimento VIP</span>`;
      info.style.display = '';
    } else {
      info.style.color = 'var(--success)';
      info.textContent = '✓ Quarto válido';
      info.style.display = '';
    }
    _atualizarComboLinhaPreco();
  });
})();

// ────────────────────────────────────────────────────────────────────────────
// MÓDULO 3: máscara + autofill do CPF na Nova Reserva.
// Ao digitar 11 dígitos válidos, busca cliente existente e preenche
// nome/email/telefone. Não bloqueia o submit se for cliente novo.
// ────────────────────────────────────────────────────────────────────────────

// ── Autocomplete de Nacionalidade ─────────────────────────────────────────
const NACIONALIDADES = [
  'Afegã','Albanesa','Alemã','Americana','Andorrana','Angolana','Antiguense',
  'Argelina','Argentina','Armênia','Australiana','Austríaca','Azerbaijanesa',
  'Bahamense','Bangladenha','Barbadense','Bareinita','Belga','Belizenha',
  'Bielorrussa','Boliviana','Bósnia-herzegovínea','Botsuanesa','Brasileira',
  'Bruneiana','Búlgara','Burkinabe','Burundesa','Butanesa',
  'Cabo-verdiana','Camaronesa','Cambojana','Canadense','Catariana',
  'Cazaquistanesa','Chadiana','Chilena','Chinesa','Cipriota',
  'Colombiana','Comorense','Congolesa','Costarriquenha','Croata','Cubana',
  'Dinamarquesa','Djiboutiana','Dominicana',
  'Egípcia','Emiradense','Equatoguineense','Equatoriana',
  'Eritreia','Eslovaca','Eslovena','Espanhola','Estoniana','Eswatiniana','Etíope',
  'Fijiana','Filipina','Finlandesa','Francesa',
  'Gabonesa','Gambiana','Ganense','Georgiana','Granadina','Grega',
  'Guatemalteca','Guianense','Guineense','Guinéu-bissauense',
  'Haitiana','Holandesa','Hondurenha','Húngara',
  'Iemenita','Indiana','Indonésia','Iraniana','Iraquiana','Irlandesa',
  'Islandesa','Israelense','Italiana',
  'Jamaicana','Japonesa','Jordaniana',
  'Kirguiz','Kiribatiana','Kuwaitiana',
  'Laosiana','Lesotiana','Letã','Libanesa','Liberiana','Líbia',
  'Liechtensteinense','Lituana','Luxemburguesa',
  'Macedônia','Madagascarense','Malauiana','Maldiviana','Malinesa','Maltesa',
  'Marroquina','Mauriciana','Mauritana','Mexicana','Micronésia',
  'Moçambicana','Moldava','Monegasca','Mongol','Montenegrina',
  'Namibiana','Nauruense','Nepalesa','Neozelandesa','Nicaraguense',
  'Nigerina','Nigeriana','Norte-coreana','Norueguesa',
  'Omaniense',
  'Palauense','Palestina','Panamenha','Papua-nova-guineense','Paquistanesa',
  'Paraguaia','Peruana','Polonesa','Portuguesa',
  'Queniana','Quirguiz',
  'Romena','Ruandesa','Russa',
  'Samoana','São-cristovense','São-marinhense','São-tomense',
  'Saudita','Senegalesa','Sérvia','Seichelense','Serra-leonesa',
  'Singapuriana','Síria','Somaliana','Srilanquesa','Sudanesa','Sudanesa do Sul',
  'Sueca','Sul-africana','Sul-coreana','Suíça','Surinamesa',
  'Tailandesa','Tanzaniana','Timorense','Togolesa','Tonganesa',
  'Trindadense','Tunisiana','Turca','Turcomena','Tuvaluense',
  'Ucraniana','Ugandesa','Uruguaia','Uzbeque',
  'Vanuatuana','Venezuelana','Vietnamita',
  'Zambiana','Zimbabuense'
];

const _NAC_TOP_LIST = ['Brasileira','Francesa','Italiana','Portuguesa','Espanhola','Argentina','Americana','Alemã','Suíça','Belga','Holandesa'];

const _NAC_PAIS_MAP = {
  'brasil':'Brasileira','portugal':'Portuguesa',
  'estados unidos':'Americana','eua':'Americana','usa':'Americana',
  'estados unidos da america':'Americana','estados unidos da américa':'Americana',
  'reino unido':'Britânica','uk':'Britânica','inglaterra':'Britânica','gra-bretanha':'Britânica',
  'canada':'Canadense','canadá':'Canadense',
  'australia':'Australiana','austrália':'Australiana',
  'espanha':'Espanhola',
  'colombia':'Colombiana','colômbia':'Colombiana',
  'mexico':'Mexicana','méxico':'Mexicana',
  'franca':'Francesa','frança':'Francesa',
  'italia':'Italiana','itália':'Italiana',
  'alemanha':'Alemã',
  'japao':'Japonesa','japão':'Japonesa',
  'china':'Chinesa',
  'india':'Indiana','índia':'Indiana',
  'russia':'Russa','rússia':'Russa',
  'uruguai':'Uruguaia','chile':'Chilena','peru':'Peruana',
  'venezuela':'Venezuelana','paraguai':'Paraguaia',
  'bolivia':'Boliviana','bolívia':'Boliviana',
  'equador':'Equatoriana','cuba':'Cubana',
  'suica':'Suíça','suíça':'Suíça',
  'suecia':'Sueca','suécia':'Sueca',
  'noruega':'Norueguesa','dinamarca':'Dinamarquesa',
  'finlandia':'Finlandesa','finlândia':'Finlandesa',
  'irlanda':'Irlandesa',
  'holanda':'Holandesa','paises baixos':'Holandesa','países baixos':'Holandesa',
  'belgica':'Belga','bélgica':'Belga',
  'austria':'Austríaca','áustria':'Austríaca',
  'grecia':'Grega','grécia':'Grega',
  'turquia':'Turca',
  'coreia do sul':'Sul-coreana','coreia do norte':'Norte-coreana',
  'africa do sul':'Sul-africana','áfrica do sul':'Sul-africana',
  'nova zelandia':'Neozelandesa','nova zelândia':'Neozelandesa',
  'polonia':'Polonesa','polônia':'Polonesa',
  'romenia':'Romena','romênia':'Romena',
  'hungria':'Húngara','marrocos':'Marroquina',
  'nigeria':'Nigeriana','nigéria':'Nigeriana',
  'egito':'Egípcia','egito':'Egípcia',
  'etiopia':'Etíope','etiópia':'Etíope',
  'kenya':'Queniana','quenia':'Queniana','quênia':'Queniana',
  'gana':'Ganense','ghana':'Ganense',
  'tailandia':'Tailandesa','tailândia':'Tailandesa',
  'indonesia':'Indonésia','indonésia':'Indonésia',
  'filipinas':'Filipina',
  'vietna':'Vietnamita','vietnã':'Vietnamita',
  'arabia saudita':'Saudita','arábia saudita':'Saudita',
  'emirados arabes unidos':'Emiradense','emirados árabes unidos':'Emiradense',
  'paquistao':'Paquistanesa','paquistão':'Paquistanesa',
  'bangladesh':'Bangladenha',
  'sri lanka':'Srilanquesa','srilanka':'Srilanquesa',
  'camboja':'Cambojana',
  'laos':'Laosiana',
};

function _normAcento(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Converte país ou gentílico salvo no banco para o gentílico canônico da lista.
// opcoes: array de strings válidas (NACIONALIDADES). Ordem de tentativa:
//  a. match direto → b. mapa país->gentílico → c. match sem acento → d. ''
function resolverNacionalidade(val, opcoes) {
  if (!val) return '';
  const v = val.trim();
  if (opcoes.includes(v)) return v;
  const nv = _normAcento(v);
  const mapped = _NAC_PAIS_MAP[nv];
  if (mapped && opcoes.includes(mapped)) return mapped;
  const exactMatch = opcoes.find(o => _normAcento(o) === nv);
  if (exactMatch) return exactMatch;
  for (const [k, mv] of Object.entries(_NAC_PAIS_MAP)) {
    if ((nv.includes(k) || k.includes(nv)) && opcoes.includes(mv)) return mv;
  }
  return '';
}

// Inicializa o autocomplete typeahead numa dupla (input, listDiv) já no DOM.
// Reutiliza classes res-cb-* existentes. Fecha ao clicar fora ou pressionar Esc.
function criarAutocompleteNacionalidade(inp, listEl) {
  let _ativo = -1;

  const _topSet = new Set(_NAC_TOP_LIST);

  function _filtrar(q) {
    const n = _normAcento(q);
    const lista = n ? NACIONALIDADES.filter(nac => _normAcento(nac).includes(n)) : NACIONALIDADES;
    const tops  = lista.filter(nac => _topSet.has(nac)).sort((a, b) => _NAC_TOP_LIST.indexOf(a) - _NAC_TOP_LIST.indexOf(b));
    const outros = lista.filter(nac => !_topSet.has(nac));
    return { tops, outros };
  }

  function _renderizar({ tops, outros }) {
    _ativo = -1;
    if (!tops.length && !outros.length) {
      listEl.innerHTML = '<div class="res-cb-opt cb-empty">Nenhuma opção encontrada</div>';
      listEl.style.display = '';
      return;
    }
    let html = tops.map(n => `<div class="res-cb-opt" role="option" data-val="${escHtml(n)}">${escHtml(n)}</div>`).join('');
    if (tops.length && outros.length) {
      html += '<div aria-hidden="true" style="border-top:1px solid rgba(128,128,128,.25);margin:3px 8px;pointer-events:none"></div>';
    }
    html += outros.map(n => `<div class="res-cb-opt" role="option" data-val="${escHtml(n)}">${escHtml(n)}</div>`).join('');
    listEl.innerHTML = html;
    listEl.style.display = '';
  }

  function _fechar() { listEl.style.display = 'none'; _ativo = -1; }

  function _atualizarClr() {
    const clr = inp.parentElement?.querySelector('.res-cb-clr');
    if (clr) clr.style.display = inp.value ? '' : 'none';
  }

  function _selecionar(val) {
    inp.value = val; _fechar(); _atualizarClr();
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }

  listEl.addEventListener('mousedown', e => {
    const item = e.target.closest('.res-cb-opt:not(.cb-empty)');
    if (item) { e.preventDefault(); _selecionar(item.dataset.val); }
  });

  inp.addEventListener('input', () => { if (inp.value.trim()) { _renderizar(_filtrar(inp.value)); } else { _fechar(); } _atualizarClr(); });
  inp.addEventListener('focus', () => { if (inp.value.trim()) _renderizar(_filtrar(inp.value)); });

  inp.addEventListener('blur', () => {
    setTimeout(() => {
      _fechar();
      inp.value = resolverNacionalidade(inp.value, NACIONALIDADES);
      _atualizarClr();
    }, 160);
  });

  inp.addEventListener('keydown', e => {
    if (listEl.style.display === 'none') return;
    const items = listEl.querySelectorAll('.res-cb-opt:not(.cb-empty)');
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _ativo = Math.min(_ativo + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('cb-focused', i === _ativo));
      items[_ativo]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _ativo = Math.max(_ativo - 1, 0);
      items.forEach((el, i) => el.classList.toggle('cb-focused', i === _ativo));
      items[_ativo]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && _ativo >= 0) {
      e.preventDefault(); _selecionar(items[_ativo].dataset.val);
    } else if (e.key === 'Escape') { _fechar(); }
  });

  const clrBtn = inp.parentElement?.querySelector('.res-cb-clr');
  if (clrBtn) {
    clrBtn.addEventListener('click', () => { inp.value = ''; _fechar(); _atualizarClr(); inp.focus(); });
  }

  document.addEventListener('click', e => {
    if (!inp.contains(e.target) && !listEl.contains(e.target)) _fechar();
  }, true);
}

// Wire generico de documento (CPF ou Passaporte) — máscara + autofill
function _wireCpfAutofill({ inpId, infoId, nomeId, emailId, telId, tipoDocSelId, idiomaId, nacionalidadeId }) {
  const inp = document.getElementById(inpId);
  if (!inp) return;

  // Ao trocar o tipo de documento: limpa o campo, ajusta placeholder e inputmode
  const sel = tipoDocSelId ? document.getElementById(tipoDocSelId) : null;
  function _atualizarTipoDoc() {
    const tipo = sel?.value || 'cpf';
    inp.value = '';
    const info = document.getElementById(infoId);
    if (info) { info.style.display = 'none'; info.textContent = ''; }
    if (tipo === 'cpf') {
      inp.placeholder = '000.000.000-00';
      inp.inputMode = 'numeric';
      inp.maxLength = 14;
    } else {
      inp.placeholder = 'Ex: AB123456';
      inp.inputMode = 'text';
      inp.maxLength = 20;
    }
  }
  if (sel) sel.addEventListener('change', _atualizarTipoDoc);

  inp.addEventListener('input', async function () {
    const tipo = sel?.value || 'cpf';
    const info = document.getElementById(infoId);

    if (tipo === 'cpf') {
      let v = this.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 9)      v = v.replace(/^(\d{3})(\d{3})(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
      else if (v.length > 6) v = v.replace(/^(\d{3})(\d{3})(\d{1,3})$/, '$1.$2.$3');
      else if (v.length > 3) v = v.replace(/^(\d{3})(\d{1,3})$/, '$1.$2');
      this.value = v;
      const digits = v.replace(/\D/g, '');
      if (digits.length !== 11) { if (info) info.style.display = 'none'; return; }
      if (!validarCpfMod11(digits)) {
        if (info) { info.style.color = 'var(--danger)'; info.textContent = '⚠ CPF inválido'; info.style.display = ''; }
        return;
      }
      try {
        const r = await api('/api/clientes/buscar?cpf=' + digits);
        if (!r) return;
        const d = await r.json();
        if (d.ok && d.cliente) {
          const c = d.cliente;
          const set = (id, val) => { const el = document.getElementById(id); if (el && val && !el.value) el.value = val; };
          // overwrite sempre aplica; fallback garante que campo nao fique "sujo"
          // com valor de busca anterior quando o novo cliente nao tem o dado.
          const overwrite = (id, val, dflt = '') => { const el = document.getElementById(id); if (el) el.value = val || dflt; };
          set(nomeId, c.nome); set(emailId, c.email); set(telId, c.telefone);
          if (idiomaId) overwrite(idiomaId, c.locale_pref, 'pt-BR');
          if (nacionalidadeId) overwrite(nacionalidadeId, resolverNacionalidade(c.nacionalidade, NACIONALIDADES), '');
          const _dtAtual = c.atualizado_em ? '. Última atualização: ' + fmtBRT(c.atualizado_em, { br: true }).slice(0, 10) : '';
          if (info) { info.style.color = 'var(--success)'; info.textContent = '✓ Cliente já cadastrado — dados preenchidos (editáveis)' + _dtAtual; info.style.display = ''; }
        } else {
          if (info) { info.style.color = 'var(--muted)'; info.textContent = 'CPF válido. Cliente novo será criado ao salvar.'; info.style.display = ''; }
        }
      } catch {}
    } else {
      // Passaporte: sem máscara, uppercase
      this.value = this.value.toUpperCase();
      const v = this.value.trim();
      if (!validarPassaporte(v)) { if (info) info.style.display = 'none'; return; }
      try {
        const r = await api('/api/clientes/buscar?passaporte=' + encodeURIComponent(v));
        if (!r) return;
        const d = await r.json();
        if (d.ok && d.cliente) {
          const c = d.cliente;
          const set = (id, val) => { const el = document.getElementById(id); if (el && val && !el.value) el.value = val; };
          const overwrite = (id, val, dflt = '') => { const el = document.getElementById(id); if (el) el.value = val || dflt; };
          set(nomeId, c.nome); set(emailId, c.email); set(telId, c.telefone);
          if (idiomaId) overwrite(idiomaId, c.locale_pref, 'pt-BR');
          if (nacionalidadeId) overwrite(nacionalidadeId, resolverNacionalidade(c.nacionalidade, NACIONALIDADES), '');
          const _dtAtualPass = c.atualizado_em ? '. Última atualização: ' + fmtBRT(c.atualizado_em, { br: true }).slice(0, 10) : '';
          if (info) { info.style.color = 'var(--success)'; info.textContent = '✓ Cliente já cadastrado — dados preenchidos (editáveis)' + _dtAtualPass; info.style.display = ''; }
        } else {
          if (info) { info.style.color = 'var(--muted)'; info.textContent = 'Passaporte válido. Cliente novo será criado ao salvar.'; info.style.display = ''; }
        }
      } catch {}
    }
  });
}
_wireCpfAutofill({ inpId: 'res-inp-cpf',  infoId: 'res-cpf-info',  nomeId: 'res-inp-nome',  emailId: 'res-inp-email',  telId: 'res-inp-tel',  tipoDocSelId: 'res-sel-tipo-doc',  idiomaId: 'res-inp-idioma',  nacionalidadeId: 'res-inp-nacionalidade'  });
_wireCpfAutofill({ inpId: 'res2-inp-cpf', infoId: 'res2-cpf-info', nomeId: 'res2-inp-nome', emailId: 'res2-inp-email', telId: 'res2-inp-tel', tipoDocSelId: 'res2-sel-tipo-doc', idiomaId: 'res2-inp-idioma', nacionalidadeId: 'res2-inp-nacionalidade' });

(function() {
  const _wNac = (inpId, listId) => {
    const inp = document.getElementById(inpId);
    const lst = document.getElementById(listId);
    if (inp && lst) criarAutocompleteNacionalidade(inp, lst);
  };
  _wNac('res-inp-nacionalidade', 'res-nac-list');
  _wNac('res2-inp-nacionalidade', 'res2-nac-list');
})();

// Associação bidirecional Idioma ↔ Nacionalidade no modal de reserva
(function() {
  const _NAC_FROM_LANG = { 'pt-BR': 'Brasileira', 'pt-PT': 'Portuguesa', fr: 'Francesa', it: 'Italiana', de: 'Alemã' };
  const _LANG_FROM_NAC = { Brasileira: 'pt-BR', Portuguesa: 'pt-PT', Francesa: 'fr', Italiana: 'it', Alemã: 'de' };

  // Mapa completo: cobre todas as 180 entradas de NACIONALIDADES
  const NAC_IDIOMA = {
    'Brasileira':'pt-BR',
    // pt-PT — lusófonos fora do Brasil
    'Angolana':'pt-PT','Cabo-verdiana':'pt-PT','Guinéu-bissauense':'pt-PT',
    'Moçambicana':'pt-PT','Portuguesa':'pt-PT','São-tomense':'pt-PT','Timorense':'pt-PT',
    // es — hispanófonos
    'Argentina':'es','Boliviana':'es','Chilena':'es','Colombiana':'es',
    'Costarriquenha':'es','Cubana':'es','Dominicana':'es','Equatoguineense':'es',
    'Equatoriana':'es','Espanhola':'es','Guatemalteca':'es','Hondurenha':'es',
    'Mexicana':'es','Nicaraguense':'es','Panamenha':'es','Paraguaia':'es',
    'Peruana':'es','Uruguaia':'es','Venezuelana':'es',
    // it — italiano oficial
    'Italiana':'it','São-marinhense':'it',
    // de — germanófonos
    'Alemã':'de','Austríaca':'de','Liechtensteinense':'de',
    // fr — francófonos (inclui Bélgica, Suíça e países africanos francófonos)
    'Belga':'fr','Burkinabe':'fr','Burundesa':'fr','Camaronesa':'fr',
    'Chadiana':'fr','Comorense':'fr','Congolesa':'fr','Djiboutiana':'fr',
    'Francesa':'fr','Gabonesa':'fr','Guineense':'fr','Haitiana':'fr',
    'Luxemburguesa':'fr','Madagascarense':'fr','Malinesa':'fr','Monegasca':'fr',
    'Nigerina':'fr','Senegalesa':'fr','Seichelense':'fr','Suíça':'fr',
    'Togolesa':'fr','Tunisiana':'fr',
    // en — idioma nativo não suportado; inglês como padrão internacional
    'Afegã':'en','Albanesa':'en','Americana':'en','Andorrana':'en',
    'Antiguense':'en','Argelina':'en','Armênia':'en','Australiana':'en',
    'Azerbaijanesa':'en','Bahamense':'en','Bangladenha':'en','Barbadense':'en',
    'Bareinita':'en','Belizenha':'en','Bielorrussa':'en',
    'Bósnia-herzegovínea':'en','Botsuanesa':'en','Bruneiana':'en',
    'Búlgara':'en','Butanesa':'en','Cambojana':'en','Canadense':'en',
    'Catariana':'en','Cazaquistanesa':'en','Chinesa':'en','Cipriota':'en',
    'Croata':'en','Dinamarquesa':'en','Egípcia':'en','Emiradense':'en',
    'Eritreia':'en','Eslovaca':'en','Eslovena':'en','Estoniana':'en',
    'Eswatiniana':'en','Etíope':'en','Fijiana':'en','Filipina':'en',
    'Finlandesa':'en','Gambiana':'en','Ganense':'en','Georgiana':'en',
    'Granadina':'en','Grega':'en','Guianense':'en','Holandesa':'en',
    'Húngara':'en','Iemenita':'en','Indiana':'en','Indonésia':'en',
    'Iraniana':'en','Iraquiana':'en','Irlandesa':'en','Islandesa':'en',
    'Israelense':'en','Jamaicana':'en','Japonesa':'en','Jordaniana':'en',
    'Kirguiz':'en','Kiribatiana':'en','Kuwaitiana':'en','Laosiana':'en',
    'Lesotiana':'en','Letã':'en','Libanesa':'en','Liberiana':'en',
    'Líbia':'en','Lituana':'en','Macedônia':'en','Malauiana':'en',
    'Maldiviana':'en','Maltesa':'en','Marroquina':'en','Mauriciana':'en',
    'Mauritana':'en','Micronésia':'en','Moldava':'en','Mongol':'en',
    'Montenegrina':'en','Namibiana':'en','Nauruense':'en','Nepalesa':'en',
    'Neozelandesa':'en','Nigeriana':'en','Norte-coreana':'en','Norueguesa':'en',
    'Omaniense':'en','Palauense':'en','Palestina':'en',
    'Papua-nova-guineense':'en','Paquistanesa':'en','Polonesa':'en',
    'Queniana':'en','Quirguiz':'en','Romena':'en','Ruandesa':'en',
    'Russa':'en','Samoana':'en','São-cristovense':'en','Saudita':'en',
    'Sérvia':'en','Serra-leonesa':'en','Singapuriana':'en','Síria':'en',
    'Somaliana':'en','Srilanquesa':'en','Sudanesa':'en','Sudanesa do Sul':'en',
    'Sueca':'en','Sul-africana':'en','Sul-coreana':'en','Surinamesa':'en',
    'Tailandesa':'en','Tanzaniana':'en','Tonganesa':'en','Trindadense':'en',
    'Turca':'en','Turcomena':'en','Tuvaluense':'en','Ucraniana':'en',
    'Ugandesa':'en','Uzbeque':'en','Vanuatuana':'en','Vietnamita':'en',
    'Zambiana':'en','Zimbabuense':'en',
  };

  function nacionalidadeParaIdioma(nac) {
    return NAC_IDIOMA[nac] || 'en';
  }

  function _wire(idiomaId, nacId) {
    const idiomaEl = document.getElementById(idiomaId);
    const nacEl    = document.getElementById(nacId);
    if (!idiomaEl || !nacEl) return;

    // Idioma → Nacionalidade (sobrescreve sempre que há mapeamento)
    idiomaEl.addEventListener('change', function () {
      const nac = _NAC_FROM_LANG[this.value];
      if (!nac) return;
      nacEl.value = nac;
      const clr = nacEl.parentElement?.querySelector('.res-cb-clr');
      if (clr) clr.style.display = '';
    });

    // Nacionalidade → Idioma (cobre todas as 180 nacionalidades, fallback 'en')
    nacEl.addEventListener('change', function () {
      idiomaEl.value = nacionalidadeParaIdioma(this.value);
    });
  }

  _wire('res-inp-idioma',  'res-inp-nacionalidade');
  _wire('res2-inp-idioma', 'res2-inp-nacionalidade');
})();

// ────────────────────────────────────────────────────────────────────────────
// Máscara automática do TELEFONE na Nova Reserva.
// BR: (DD) 9 NNNN-NNNN (celular) ou (DD) NNNN-NNNN (fixo).
// Internacional: se começar com '+', NÃO formata — preserva como digitado.
// ────────────────────────────────────────────────────────────────────────────
function _formatarTelefoneBR(raw) {
  if (!raw) return '';
  // Internacional: deixa o usuário digitar livremente.
  if (raw.trim().startsWith('+')) return raw;
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2)  return '(' + d;
  if (d.length <= 6)  return '(' + d.slice(0, 2) + ') ' + d.slice(2);
  if (d.length <= 7 && d.length === 7)  return '(' + d.slice(0, 2) + ') ' + d.slice(2);
  if (d.length === 10) return '(' + d.slice(0,2) + ') ' + d.slice(2,6) + '-' + d.slice(6);
  if (d.length === 11) return '(' + d.slice(0,2) + ') ' + d.slice(2,3) + ' ' + d.slice(3,7) + '-' + d.slice(7);
  // Comprimento intermediário (digitando): formata progressivamente como celular
  return '(' + d.slice(0,2) + ') ' + d.slice(2,3) + ' ' + d.slice(3,7) + (d.length > 7 ? '-' + d.slice(7) : '');
}
window._formatarTelefoneBR = _formatarTelefoneBR;

function _wireTelefoneMascara(inpId) {
  const inp = document.getElementById(inpId);
  if (!inp) return;
  inp.addEventListener('input', function () {
    const before = this.value;
    if (before.trim().startsWith('+')) return;
    const formatted = _formatarTelefoneBR(before);
    if (formatted === before) return;
    this.value = formatted;
    try { this.setSelectionRange(formatted.length, formatted.length); } catch {}
  });
}
_wireTelefoneMascara('res-inp-tel');
_wireTelefoneMascara('res2-inp-tel');

// Mascara numerica simples pro quarto da pessoa 2 (4 digitos)
(function wireUpQuarto2() {
  const inp = document.getElementById('res2-inp-quarto');
  if (!inp) return;
  inp.addEventListener('input', function () {
    const digits = this.value.replace(/\D/g, '').slice(0, 4);
    if (this.value !== digits) this.value = digits;
    const info = document.getElementById('res2-quarto-info');
    if (digits.length === 4) {
      const cat = quartoCategoria(_normNumQuarto(digits));
      if (cat && info) { info.style.color = 'var(--success)'; info.textContent = cat === 'gran_class' ? '✓ Quarto Gran Class' : '✓ Quarto válido'; info.style.display = ''; }
      else if (info) { info.style.color = 'var(--danger)'; info.textContent = '⚠ Quarto inexistente'; info.style.display = ''; }
    } else if (info) {
      info.style.display = 'none';
    }
  });
}());

// ────────────────────────────────────────────────────────────────────────────
// HISTÓRICO DO SISTEMA (auditoria) — master only.
// Lista todas as ações que modificam estado, com filtros por período,
// quem fez, recurso e status. Acessível via botão na tela de Usuários.
// ────────────────────────────────────────────────────────────────────────────

const _AUD_RECURSO_LABEL = {
  reservas: 'Reservas',
  feedback: 'Pesquisas',
  auth: 'Login',
  clientes: 'Clientes',
  qualidade: 'Qualidade',
  survey: 'Qualidade',
  spa: 'Anamnese',
  massagistas: 'Massoterapeutas',
  'escala-spa': 'Escala mensal',
  'tipos-massagem': 'Tratamentos',
  dev: 'Dev',
  outro: 'Outro',
};
const _AUD_ACAO_LABEL = {
  criar_reservas: 'Criou reserva',
  remover_reservas: 'Cancelou reserva',
  atualizar_reservas: 'Atualizou reserva',
  liberar_pesquisa: 'Liberou pesquisa',
  gerar_ficha_anamnese: 'Gerou link de anamnese',
  salvar_anamnese: 'Cliente preencheu anamnese',
  criar_feedback: 'Cliente respondeu pesquisa',
  login: 'Login (form local)',
  login_sso: 'Login via Hub',
  criar_clientes: 'Criou cliente',
  atualizar_clientes: 'Editou cliente',
  criar_massagistas: 'Cadastrou massoterapeuta',
  atualizar_massagistas: 'Editou massoterapeuta',
  remover_massagistas: 'Removeu massoterapeuta',
  'atualizar_escala-spa': 'Editou turno da escala',
  'remover_escala-spa': 'Limpou turno da escala',
  aplicar_padrao_escala: 'Aplicou padrão na escala',
  'criar_tipos-massagem': 'Criou tratamento',
  'atualizar_tipos-massagem': 'Editou tratamento',
  'remover_tipos-massagem': 'Removeu tratamento',
  criar_qualidade: 'Criou em Qualidade',
  atualizar_qualidade: 'Editou em Qualidade',
  remover_qualidade: 'Removeu em Qualidade',
  publicar_pesquisa: 'Publicou pesquisa',
  despublicar_pesquisa: 'Despublicou pesquisa',
  clonar_pesquisa: 'Clonou pesquisa',
  criar_auth: 'Criou usuário admin',
  atualizar_auth: 'Editou usuário admin',
  remover_auth: 'Removeu usuário admin',
  reset_demo: 'Reset/demo executado',
};

let _audPage = 0;
const _audLimit = 50;
let _audTotal = 0;

document.getElementById('btn-open-auditoria')?.addEventListener('click', () => {
  showView('view-auditoria');
});
document.getElementById('btn-aud-reload')?.addEventListener('click', () => loadAuditoria());
document.getElementById('btn-aud-filtrar')?.addEventListener('click', () => { _audPage = 0; loadAuditoria(); });
document.getElementById('btn-aud-limpar')?.addEventListener('click', () => {
  ['aud-from','aud-to','aud-ator','aud-acao'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  document.getElementById('aud-recurso').value = '';
  document.getElementById('aud-sucesso').value = '';
  _audPage = 0;
  loadAuditoria();
});
document.getElementById('btn-aud-prev')?.addEventListener('click', () => { if (_audPage > 0) { _audPage--; loadAuditoria(); } });
document.getElementById('btn-aud-next')?.addEventListener('click', () => {
  if ((_audPage + 1) * _audLimit < _audTotal) { _audPage++; loadAuditoria(); }
});

let _audRecursosCarregados = false;
async function initAuditoriaView() {
  if (!_audRecursosCarregados) {
    try {
      const r = await api('/api/auditoria/recursos');
      if (r) {
        const d = await r.json();
        if (d.ok) {
          const sel = document.getElementById('aud-recurso');
          for (const rec of d.items) {
            const opt = document.createElement('option');
            opt.value = rec;
            opt.textContent = _AUD_RECURSO_LABEL[rec] || rec;
            sel.appendChild(opt);
          }
        }
      }
    } catch {}
    _audRecursosCarregados = true;
  }
  _audPage = 0;
  loadAuditoria();
}

function _fmtDataHora(s) {
  // s vem como "YYYY-MM-DD HH:MM:SS" do SQLite (datetime('now') é UTC).
  // Convertemos para a hora local de Fortaleza p/ apresentação.
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(d).replace(',', '');
}

async function loadAuditoria() {
  const params = new URLSearchParams();
  const from = document.getElementById('aud-from')?.value;
  const to   = document.getElementById('aud-to')?.value;
  const ator = document.getElementById('aud-ator')?.value.trim();
  const recurso = document.getElementById('aud-recurso')?.value;
  const acao = document.getElementById('aud-acao')?.value.trim();
  const sucesso = document.getElementById('aud-sucesso')?.value;
  if (from) params.set('from', from);
  if (to)   params.set('to', to);
  if (ator) params.set('ator', ator);
  if (recurso) params.set('recurso', recurso);
  if (acao) params.set('acao', acao);
  if (sucesso !== '') params.set('sucesso', sucesso);
  params.set('limit', _audLimit);
  params.set('offset', _audPage * _audLimit);

  let d;
  try {
    const r = await api('/api/auditoria?' + params);
    if (!r) return;
    d = await r.json();
  } catch (e) { return; }
  if (!d.ok) { showToast('Erro ao carregar histórico'); return; }
  _audTotal = d.total;
  const body = document.getElementById('aud-body');
  const empty = document.getElementById('aud-empty');
  const count = document.getElementById('aud-count');
  count.textContent = d.total ? `${d.total} evento${d.total === 1 ? '' : 's'}` : '';
  if (!d.items.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    body.innerHTML = d.items.map(e => {
      const ator = e.ator_username || '— (público)';
      const role = e.ator_role ? `<small style="color:var(--muted)"> · ${escHtml(e.ator_role)}</small>` : '';
      const recLabel = _AUD_RECURSO_LABEL[e.recurso] || e.recurso || '—';
      const acaoLabel = _AUD_ACAO_LABEL[e.acao] || e.acao || `${e.metodo} ${e.rota}`;
      const statusBadge = e.sucesso
        ? `<span style="color:var(--success);font-weight:600">${e.status}</span>`
        : `<span style="color:var(--danger);font-weight:600">${e.status}</span>`;
      const det = e.detalhes
        ? `<details><summary style="cursor:pointer;color:var(--muted);font-size:.78rem">ver</summary><pre style="white-space:pre-wrap;word-break:break-all;font-size:.72rem;color:var(--muted);margin:.3rem 0 0 0;max-width:380px">${escHtml(e.detalhes)}</pre></details>`
        : '<span style="color:var(--muted)">—</span>';
      return `<tr>
        <td style="white-space:nowrap;font-variant-numeric:tabular-nums;font-size:.82rem">${_fmtDataHora(e.criado_em)}</td>
        <td style="font-size:.85rem">${escHtml(ator)}${role}<br><small style="color:var(--muted);font-size:.7rem">${escHtml(e.ator_ip || '')}</small></td>
        <td style="font-size:.85rem">${escHtml(acaoLabel)}<br><small style="color:var(--muted);font-size:.7rem"><code>${e.metodo} ${escHtml(e.rota || '')}</code></small></td>
        <td><span class="badge">${escHtml(recLabel)}</span></td>
        <td style="text-align:center;font-size:.85rem">${e.recurso_id ? '#' + escHtml(e.recurso_id) : '—'}</td>
        <td style="text-align:center">${statusBadge}</td>
        <td>${det}</td>
      </tr>`;
    }).join('');
  }
  const totalPages = Math.max(1, Math.ceil(d.total / _audLimit));
  document.getElementById('aud-pag').textContent = `Página ${_audPage + 1} de ${totalPages}`;
  document.getElementById('btn-aud-prev').disabled = _audPage === 0;
  document.getElementById('btn-aud-next').disabled = (_audPage + 1) >= totalPages;
}

// ────────────────────────────────────────────────────────────────────────────
// EDITOR DA ANAMNESE (Formulário Pré-Massagem) — gerencia perguntas, ordem,
// tipo, obrigatoriedade, ativo/inativo e opções (para perguntas tipo
// 'unica'/'multipla'). Reusa os endpoints CRUD do módulo Qualidade.
// ────────────────────────────────────────────────────────────────────────────

// ANAMNESE_SLUG hoisted pro topo do arquivo (TDZ fix).
let _anamPesquisaId = null;
let _anamEstrutura  = null;
let _anamxSecaoAtivaId = null; // qual secao do sidebar esta selecionada (v2)

const _ANAM_TIPOS = [
  { value: 'texto_livre', label: 'Texto livre' },
  { value: 'unica',       label: 'Escolha única (opções)' },
  { value: 'multipla',    label: 'Múltipla escolha (opções)' },
  { value: 'escala',      label: 'Escala (ex: sim/não, otimo/bom/...)' },
];

// Icones por tipo de pergunta — usados nas tags do card v2.
const _ANAMX_TIPO_ICO = {
  texto_livre: '✎',
  unica:       '◉',
  multipla:    '☐',
  escala:      '▮▮',
  sim_nao:     '⇄',
  data:        '📅',
};
const _ANAMX_TIPO_LABEL = {
  texto_livre: 'Texto livre',
  unica:       'Escolha única',
  multipla:    'Múltipla escolha',
  escala:      'Escala',
  sim_nao:     'Sim ou Não',
  data:        'Data',
};

document.getElementById('btn-open-anamnese-editor')?.addEventListener('click', () => showView('view-anamnese-editor'));
document.getElementById('btn-anam-reload')?.addEventListener('click', () => initAnamneseEditor());

async function initAnamneseEditor() {
  const empty = document.getElementById('anam-empty');
  const wrap  = document.getElementById('anam-secoes');
  if (empty) { empty.style.display = 'block'; empty.textContent = 'Carregando…'; }
  if (wrap)  wrap.innerHTML = '';

  try {
    const rE = await api(`/api/qualidade/admin/pesquisas/slug/${ANAMNESE_SLUG}/estrutura?_=${Date.now()}`);
    if (!rE) return;
    const dE = await rE.json();
    if (!dE.ok || !dE.estrutura) {
      if (empty) { empty.style.display = 'block'; empty.textContent = `Anamnese "${ANAMNESE_SLUG}" não encontrada.`; }
      return;
    }
    _anamPesquisaId = dE.estrutura.id;
    _anamEstrutura  = dE.estrutura;
  } catch (e) {
    if (empty) { empty.style.display = 'block'; empty.textContent = 'Erro: ' + e.message; }
    return;
  }

  if (empty) empty.style.display = 'none';
  _renderAnamEstrutura();
}

// ═════════════════════════════════════════════════════════════════════
// EDITOR ANAMNESE — v2 "Atelier de Hospitalidade"
// Render 2-col (sidebar + main), inline edit, drag-and-drop preservado.
// ═════════════════════════════════════════════════════════════════════
function _escAttr(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

function _anamxRender() {
  if (!_anamEstrutura) return;
  const secoes = (_anamEstrutura.secoes || []).filter(s => s.ativo !== 0 && s.ativo !== false);
  if (!secoes.length) {
    _anamxRenderSemSecoes();
    return;
  }
  // Se nao tem secao ativa selecionada, escolhe a primeira
  if (!_anamxSecaoAtivaId || !secoes.find(s => s.id === _anamxSecaoAtivaId)) {
    _anamxSecaoAtivaId = secoes[0].id;
  }
  _anamxRenderSidebar(secoes);
  const ativa = secoes.find(s => s.id === _anamxSecaoAtivaId);
  if (ativa) _anamxRenderSecaoContent(ativa);
  _wireAnamxAcoes();
  _wireDragReorder('anam');
}

function _anamxRenderSemSecoes() {
  const content = document.getElementById('anamx-content');
  const nav = document.getElementById('anamx-nav');
  if (nav) nav.innerHTML = '<div style="font-size:.85rem;color:var(--anamx-taupe);padding:.5rem .85rem">Nenhuma seção</div>';
  if (content) {
    content.innerHTML = `
      <div class="anamx-secao-card">
        <div class="anamx-empty-state">
          <h3>Comece sua anamnese</h3>
          <p>Crie a primeira seção para agrupar perguntas. Ex: "Dados Pessoais", "Saúde", "Consentimentos".</p>
          <button class="anamx-add-perg-btn" id="anamx-empty-add-secao" type="button">
            <span aria-hidden="true">+</span> Criar primeira seção
          </button>
        </div>
      </div>
    `;
    document.getElementById('anamx-empty-add-secao')?.addEventListener('click', _anamxAddSecaoFlow);
  }
  _wireAnamxAcoes();
}

function _anamxRenderSidebar(secoes) {
  const nav = document.getElementById('anamx-nav');
  if (!nav) return;
  nav.innerHTML = secoes.map(s => {
    const perg = (s.perguntas || []).filter(q => q.ativo !== 0 && q.ativo !== false);
    const active = s.id === _anamxSecaoAtivaId;
    return `
      <button type="button" class="anamx-nav-item${active ? ' active' : ''}" data-anamx-nav="${s.id}">
        <span class="anamx-nav-name">${_escAttr(s.titulo || s.chave)}</span>
        <span class="anamx-nav-count">${perg.length}</span>
      </button>
    `;
  }).join('');
}

function _anamxRenderSecaoContent(secao) {
  const content = document.getElementById('anamx-content');
  if (!content) return;
  const todasPerguntas = secao.perguntas || [];
  const perguntas      = todasPerguntas.filter(q => q.ativo !== 0 && q.ativo !== false);
  const inativas       = todasPerguntas.filter(q => q.ativo === 0 || q.ativo === false);
  const totalPerg = perguntas.length;
  const perguntasHTML = perguntas.map((q, i) => _anamxRenderPerguntaCard(q, i, totalPerg, secao.id, false)).join('');

  const inativasHTML = inativas.length ? `
    <div style="margin-top:.6rem;padding:.7rem 1.2rem .5rem;border-top:1px dashed rgba(255,255,255,.07);background:rgba(0,0,0,.12)">
      <div style="font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:.4rem">
        ${inativas.length} pergunta${inativas.length > 1 ? 's' : ''} inativa${inativas.length > 1 ? 's' : ''} nesta seção
      </div>
      ${inativas.map(q => _anamxRenderPerguntaCard(q, -1, 0, secao.id, true)).join('')}
    </div>` : '';

  const corpoPerguntas = totalPerg
    ? `<div class="anamx-perguntas anam-perguntas" data-secao-id="${secao.id}">${perguntasHTML}</div>${inativasHTML}`
    : `
      <div class="anamx-empty-state">
        <h3>Esta seção ainda não tem perguntas</h3>
        <p>Adicione a primeira pergunta abaixo. Você pode escolher o tipo (texto, opções, escala, sim/não).</p>
      </div>
      <div class="anam-perguntas" data-secao-id="${secao.id}" style="display:none"></div>
      ${inativasHTML}
    `;

  content.innerHTML = `
    <article class="anamx-secao-card anam-secao" data-secao-id="${secao.id}">
      <header class="anamx-secao-head">
        <h2 class="anamx-secao-titulo" contenteditable="true" spellcheck="false" data-anamx-edit="secao-titulo" data-secao-id="${secao.id}" data-orig="${_escAttr(secao.titulo || secao.chave)}">${_escAttr(secao.titulo || secao.chave)}</h2>
        <span class="anamx-secao-meta">${totalPerg} ${totalPerg === 1 ? 'pergunta' : 'perguntas'}</span>
        <div class="anamx-secao-actions">
          <button class="anamx-icon-btn danger" type="button" data-anamx-act="del-secao" data-secao-id="${secao.id}" title="Remover seção" aria-label="Remover seção">🗑</button>
        </div>
      </header>
      ${corpoPerguntas}
      <div class="anamx-add-perg-wrap">
        <button class="anamx-add-perg-btn" type="button" data-anamx-act="add-pergunta" data-secao-id="${secao.id}">
          <span aria-hidden="true">+</span> Adicionar pergunta
        </button>
      </div>
    </article>
  `;
}

function _anamxRenderPerguntaCard(q, idx, total, secaoId, inativa = false) {
  const tipoLabel = _ANAMX_TIPO_LABEL[q.tipo] || q.tipo;
  const tipoIco = _ANAMX_TIPO_ICO[q.tipo] || '◆';
  const obrigOn = !!q.obrigatoria;
  const legado = q.mapeia_campo_legado;
  const tagLegado = legado ? `<span class="anamx-perg-tag legado" title="Campo padrão do hotel (vinculado ao banco legado)">CAMPO PADRÃO</span>` : '';
  const opcoes = (q.opcoes && q.opcoes.length)
    ? `<div class="anamx-perg-opcoes"><b>Opções:</b> ${q.opcoes.map(o => _escAttr(o.rotulo || o.chave)).join(' · ')}</div>`
    : '';

  if (inativa) {
    return `
      <div class="anamx-pergunta anam-pergunta" data-perg-chave="${_escAttr(q.chave)}" data-assoc-id="${q.associacao_id || ''}" style="opacity:.55;pointer-events:auto">
        <div class="anamx-perg-drag" style="visibility:hidden"><span></span><span></span><span></span></div>
        <div class="anamx-perg-body">
          <div class="anamx-perg-num" style="color:var(--muted)">—</div>
          <div style="text-decoration:line-through;color:var(--muted);font-size:.92rem">${_escAttr(q.rotulo || q.chave)}</div>
          ${opcoes}
          <div class="anamx-perg-tags">
            <span class="anamx-perg-tag" style="background:#9e3832;color:#fff;font-weight:700;font-size:.66rem">INATIVA</span>
            <span class="anamx-perg-tag tipo"><span class="anamx-tipo-ico" aria-hidden="true">${tipoIco}</span> ${_escAttr(tipoLabel)}</span>
          </div>
        </div>
        <div class="anamx-perg-actions">
          <button class="anamx-icon-btn" type="button" data-anamx-act="ativar-perg" data-pergunta-id="${q.pergunta_id}" data-chave="${_escAttr(q.chave)}" title="Ativar pergunta" style="color:var(--gold,#9C5843);opacity:1">↺ Ativar</button>
        </div>
      </div>`;
  }

  const editOpcoesBtn = (q.tipo === 'unica' || q.tipo === 'multipla')
    ? `<button class="anamx-icon-btn" type="button" data-anamx-act="edit-opcoes" data-chave="${_escAttr(q.chave)}" title="Editar opções" aria-label="Editar opções">⋯</button>`
    : '';
  return `
    <div class="anamx-pergunta anam-pergunta" data-perg-chave="${_escAttr(q.chave)}" data-assoc-id="${q.associacao_id || ''}">
      <div class="anamx-perg-drag drag-handle" data-drag-prefix="anam" title="Arraste para reordenar" aria-label="Arraste para reordenar">
        <span></span><span></span><span></span>
      </div>
      <div class="anamx-perg-body">
        <div class="anamx-perg-num">#${idx + 1}</div>
        <div class="anamx-perg-rotulo" contenteditable="true" spellcheck="false" data-anamx-edit="perg-rotulo" data-chave="${_escAttr(q.chave)}" data-orig="${_escAttr(q.rotulo || q.chave)}">${_escAttr(q.rotulo || q.chave)}</div>
        ${opcoes}
        <div class="anamx-perg-tags">
          <span class="anamx-perg-tag tipo" title="Tipo de resposta"><span class="anamx-tipo-ico" aria-hidden="true">${tipoIco}</span> ${_escAttr(tipoLabel)}</span>
          <button type="button" class="anamx-perg-tag obrig${obrigOn ? ' on' : ''}" data-anamx-act="toggle-obrig" data-chave="${_escAttr(q.chave)}" title="Clique para alternar obrigatoriedade">
            ${obrigOn ? '✓ Obrigatória' : 'Opcional'}
          </button>
          ${tagLegado}
        </div>
      </div>
      <div class="anamx-perg-actions">
        ${editOpcoesBtn}
        <button class="anamx-icon-btn" type="button" data-anamx-act="edit-perg" data-chave="${_escAttr(q.chave)}" title="Editar pergunta (mais opções)" aria-label="Editar pergunta">✎</button>
        <button class="anamx-icon-btn danger" type="button" data-anamx-act="del-perg" data-chave="${_escAttr(q.chave)}" title="Remover pergunta" aria-label="Remover pergunta">🗑</button>
      </div>
    </div>
  `;
}

let _anamxAcoesWired = false;
function _wireAnamxAcoes() {
  if (_anamxAcoesWired) return;
  _anamxAcoesWired = true;

  // Header buttons
  document.getElementById('anamx-btn-historico')?.addEventListener('click', () => {
    _abrirModalHistorico({ slug: ANAMNESE_SLUG, titulo: 'Histórico — Anamnese' });
  });
  document.getElementById('anamx-btn-inativas')?.addEventListener('click', _anamxAbrirInativas);
  document.getElementById('anamx-btn-add-secao')?.addEventListener('click', _anamxAddSecaoFlow);

  // Delegacao global no body — cobre cliques nas pergunta cards
  document.addEventListener('click', _anamxOnClick);
  // Inline edit blur
  document.addEventListener('focusout', _anamxOnFocusOut);
  // Enter/Esc/Tab no inline edit
  document.addEventListener('keydown', _anamxOnKeyDown);
  // Paste sanitizado (texto plano) nos contenteditable
  document.addEventListener('paste', _anamxOnPaste);
}

function _anamxOnClick(e) {
  // Sidebar nav
  const navBtn = e.target.closest('[data-anamx-nav]');
  if (navBtn) {
    const id = parseInt(navBtn.dataset.anamxNav);
    if (!Number.isNaN(id) && id !== _anamxSecaoAtivaId) {
      _anamxSecaoAtivaId = id;
      _anamxRender();
    }
    return;
  }
  // Acoes [data-anamx-act]
  const actBtn = e.target.closest('[data-anamx-act]');
  if (!actBtn) return;
  const act = actBtn.dataset.anamxAct;
  const secaoId = actBtn.dataset.secaoId ? parseInt(actBtn.dataset.secaoId) : null;
  const chave = actBtn.dataset.chave;

  if (act === 'add-pergunta')      _anamxAddPergunta(secaoId);
  else if (act === 'edit-perg')    _anamEditPergunta(chave);
  else if (act === 'del-perg')     _anamDelPergunta(chave);
  else if (act === 'edit-opcoes')  _anamEditOpcoes(chave);
  else if (act === 'del-secao')    _anamDelSecao(secaoId);
  else if (act === 'toggle-obrig') _anamxToggleObrig(chave);
  else if (act === 'ativar-perg')  _anamxAtivarPergunta(parseInt(actBtn.dataset.perguntaId));
}

async function _anamxAtivarPergunta(perguntaId) {
  if (!perguntaId) return;
  try {
    const r = await apiSend('PUT', `/api/qualidade/admin/perguntas/${perguntaId}`, { ativo: 1, pesquisa_slug: ANAMNESE_SLUG });
    if (!r?.ok) { showToast('Erro ao ativar pergunta', 4000); return; }
    showToast('Pergunta ativada — formulário atualizado');
    await initAnamneseEditor();
  } catch (e) { showToast('Erro: ' + e.message, 4000); }
}

// Normaliza texto editado inline: trim, colapsa whitespace (\n, \t, etc),
// limita a 500 chars (limite generoso pra pergunta).
function _anamxNormalizarTexto(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

let _anamxSalvando = false;
function _anamxOnFocusOut(e) {
  const el = e.target.closest('[data-anamx-edit]');
  if (!el) return;
  // Se ja esta salvando, ignora — vai salvar quando o primeiro terminar.
  if (_anamxSalvando) return;
  const kind = el.dataset.anamxEdit;
  const orig = (el.dataset.orig || '').trim();
  const novo = _anamxNormalizarTexto(el.textContent || '');
  if (novo === orig) {
    // Mesmo conteudo apos normalizacao — atualiza textContent caso tenha HTML
    if (el.textContent !== novo) el.textContent = novo;
    return;
  }
  if (!novo) {
    el.textContent = orig;
    showToast('Texto nao pode ficar vazio');
    return;
  }
  // Reescreve o textContent ja normalizado (remove HTML do paste)
  el.textContent = novo;
  // NAO atualiza data-orig aqui — so' apos save bem-sucedido
  if (kind === 'secao-titulo') {
    const secaoId = parseInt(el.dataset.secaoId);
    _anamxSalvarSecaoTitulo(secaoId, novo, el);
  } else if (kind === 'perg-rotulo') {
    const chave = el.dataset.chave;
    _anamxSalvarPerguntaRotulo(chave, novo, el);
  }
}

function _anamxOnKeyDown(e) {
  const el = e.target.closest('[data-anamx-edit]');
  if (!el) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    el.blur();
  } else if (e.key === 'Escape' || e.key === 'Esc') {
    // Reverte para data-orig sem salvar
    e.preventDefault();
    el.textContent = el.dataset.orig || '';
    el.blur();
  } else if (e.key === 'Tab') {
    // Permite navegacao Tab (default) — nao insere literal \t.
    // (Browsers podem inserir \t em contenteditable; preventDefault evita)
    e.preventDefault();
    el.blur();
  }
}

// Sanitiza paste para texto plano — evita formatacao HTML herdada do Word.
function _anamxOnPaste(e) {
  const el = e.target.closest('[data-anamx-edit]');
  if (!el) return;
  e.preventDefault();
  const texto = (e.clipboardData || window.clipboardData).getData('text/plain');
  const limpo = _anamxNormalizarTexto(texto);
  // insertText respeita undo stack e cursor position
  try { document.execCommand('insertText', false, limpo); }
  catch { el.textContent = (el.textContent || '') + limpo; }
}

async function _anamxSalvarSecaoTitulo(secaoId, titulo, el) {
  if (_anamxSalvando) return;
  _anamxSalvando = true;
  if (el) el.setAttribute('contenteditable', 'false');
  try {
    const traducoes = await _anamTraduzirRotulo(titulo);
    await apiSend('PUT', `/api/qualidade/admin/secoes/${secaoId}`, { traducoes });
    if (el) el.dataset.orig = titulo;
    showToast('Seção renomeada');
    initAnamneseEditor();
  } catch (e) {
    showToast('Erro: ' + (e?.message || e), 4000);
    // Reverte UI para o valor anterior em caso de falha
    if (el && el.dataset.orig) el.textContent = el.dataset.orig;
  } finally {
    if (el) el.setAttribute('contenteditable', 'true');
    _anamxSalvando = false;
  }
}

async function _anamxSalvarPerguntaRotulo(chave, rotulo, el) {
  if (_anamxSalvando) return;
  _anamxSalvando = true;
  if (el) el.setAttribute('contenteditable', 'false');
  try {
    // Tenta primeiro achar a pergunta via estrutura local (mais confiavel —
    // GET /perguntas pode retornar duplicatas se a chave colidir entre
    // pesquisas diferentes). Fallback: GET /perguntas.
    let perguntaId = null;
    for (const sec of (_anamEstrutura?.secoes || [])) {
      const p = (sec.perguntas || []).find(q => q.chave === chave);
      if (p?.pergunta_id) { perguntaId = p.pergunta_id; break; }
    }
    if (!perguntaId) {
      const r = await api(`/api/qualidade/admin/perguntas?_=${Date.now()}`);
      if (!r) throw new Error('Sem auth ou rede');
      const d = await r.json();
      const p = (d.items || []).find(x => x.chave === chave);
      perguntaId = p?.id;
    }
    if (!perguntaId) { showToast('Pergunta não encontrada'); return; }
    const traducoes = await _anamTraduzirRotulo(rotulo);
    await apiSend('PUT', `/api/qualidade/admin/perguntas/${perguntaId}`, { rotulo, traducoes });
    if (el) el.dataset.orig = rotulo;
    showToast('Pergunta atualizada');
    initAnamneseEditor();
  } catch (e) {
    showToast('Erro: ' + (e?.message || e), 4000);
    if (el && el.dataset.orig) el.textContent = el.dataset.orig;
  } finally {
    if (el) el.setAttribute('contenteditable', 'true');
    _anamxSalvando = false;
  }
}

let _anamxTogglandoObrig = false;
async function _anamxToggleObrig(chave) {
  if (_anamxTogglandoObrig) return;
  const sec = (_anamEstrutura?.secoes || []).find(s => (s.perguntas || []).some(q => q.chave === chave));
  const q = sec?.perguntas?.find(x => x.chave === chave);
  if (!q?.associacao_id) return showToast('Associação não encontrada');
  _anamxTogglandoObrig = true;
  const novo = !q.obrigatoria;
  // Optimistic UI: atualiza o botao imediatamente. Reverte no catch.
  const btn = document.querySelector(`button[data-anamx-act="toggle-obrig"][data-chave="${CSS.escape(chave)}"]`);
  if (btn) {
    btn.disabled = true;
    btn.classList.toggle('on', novo);
    btn.textContent = novo ? '✓ Obrigatória' : 'Opcional';
  }
  try {
    await apiSend('PUT', `/api/qualidade/admin/pesquisa-pergunta/${q.associacao_id}`, { obrigatoria: novo ? 1 : 0 });
    showToast(novo ? 'Marcada como obrigatória' : 'Marcada como opcional');
    initAnamneseEditor();
  } catch (e) {
    // Reverte UI
    if (btn) {
      btn.classList.toggle('on', !novo);
      btn.textContent = !novo ? '✓ Obrigatória' : 'Opcional';
    }
    showToast('Erro: ' + (e?.message || e), 4000);
  } finally {
    if (btn) btn.disabled = false;
    _anamxTogglandoObrig = false;
  }
}

let _anamxCriandoSecao = false;
async function _anamxAddSecaoFlow() {
  if (_anamxCriandoSecao) return; // guard contra double-click
  _anamxCriandoSecao = true;
  try {
    const raw = await pedirTexto({
      titulo: 'Nova seção',
      mensagem: 'Uma seção agrupa perguntas relacionadas (ex: "Alergias", "Histórico").',
      placeholder: 'Nome da seção',
    });
    const titulo = (raw || '').trim();
    if (!titulo) return;
    const chave = _slugChave(titulo, 'sec_');
    try {
      const resp = await apiSend('POST', `/api/qualidade/admin/pesquisas/${_anamPesquisaId}/secoes`, {
        chave, ordem: 99, traducoes: { 'pt-BR': titulo },
      });
      if (resp?.id) {
        _anamxSecaoAtivaId = resp.id;
        _traduzirEAtualizarBg('secao', resp.id, titulo);
        showToast('Seção criada');
      }
      initAnamneseEditor();
    } catch (e) {
      showToast('Erro ao criar: ' + (e?.message || e), 4000);
    }
  } finally {
    _anamxCriandoSecao = false;
  }
}

let _anamxCriandoPergunta = false;
async function _anamxAddPergunta(secaoId) {
  if (_anamxCriandoPergunta) return; // guard double-click
  _anamxCriandoPergunta = true;
  try {
    const resp = await pedirPergunta({
      titulo: 'Nova pergunta',
      mensagem: 'Defina o rótulo e o tipo. Tradução para 6 idiomas é automática.',
      valorTipo: 'texto_livre',
      valorObrigatoria: false,
      tipos: _ANAM_TIPOS,
    });
    if (!resp) return;
    const rotulo = (resp.rotulo || '').trim();
    const { tipo, obrigatoria } = resp;
    if (!rotulo) return;

    // Calcula ordem dinamica: maior ordem da secao + 10. Evita varias
    // perguntas com ordem 99 que ficam empatadas.
    const secao = (_anamEstrutura?.secoes || []).find(s => s.id === secaoId);
    const perguntasSec = (secao?.perguntas || []).filter(p => p.ativo !== 0);
    const proximaOrdem = perguntasSec.length
      ? Math.max(...perguntasSec.map(p => (typeof p.ordem === 'number' ? p.ordem : 0))) + 10
      : 10;

    const chave = _slugChave(rotulo, 'anamnese_');
    let r1 = null;
    try {
      r1 = await apiSend('POST', '/api/qualidade/admin/perguntas', {
        chave, tipo, ativo: 1, traducoes: { 'pt-BR': { rotulo } },
      });
      if (!r1?.id) { showToast('Erro ao criar pergunta'); return; }

      // Tenta associar. Se falhar, faz rollback removendo a pergunta global
      // criada para nao deixar lixo orfao no banco.
      try {
        await apiSend('POST', `/api/qualidade/admin/pesquisas/${_anamPesquisaId}/perguntas`, {
          pergunta_id: r1.id, secao_id: secaoId, ordem: proximaOrdem, obrigatoria, ativo: 1,
        });
      } catch (assocErr) {
        // Rollback best-effort
        try { await apiSend('DELETE', `/api/qualidade/admin/perguntas/${r1.id}`); } catch {}
        throw assocErr;
      }

      // Tipo 'escala' cria Sim/Nao automaticamente — paralelo pra economizar
      // round-trips.
      if (tipo === 'escala') {
        const TRAD = { sim: { 'pt-BR': 'Sim' }, nao: { 'pt-BR': 'Não' } };
        await Promise.all([
          apiSend('POST', `/api/qualidade/admin/perguntas/${r1.id}/opcoes`, {
            chave: 'sim', ordem: 1, ativo: 1, traducoes: TRAD.sim,
          }),
          apiSend('POST', `/api/qualidade/admin/perguntas/${r1.id}/opcoes`, {
            chave: 'nao', ordem: 2, ativo: 1, traducoes: TRAD.nao,
          }),
        ]);
      }

      _traduzirEAtualizarBg('pergunta', r1.id, rotulo);
      showToast('Pergunta criada');

      // Para 'unica'/'multipla' SEM opcoes ainda — abre o modal de opcoes
      // automaticamente para nao deixar pergunta orfa no publico.
      if (tipo === 'unica' || tipo === 'multipla') {
        // Re-render primeiro, depois abre o modal pra editar opcoes da chave nova.
        await initAnamneseEditor();
        setTimeout(() => _anamEditOpcoes(chave), 100);
      } else {
        initAnamneseEditor();
      }
    } catch (e) {
      showToast('Erro: ' + (e?.message || e), 4000);
    }
  } finally {
    _anamxCriandoPergunta = false;
  }
}

async function _anamxAbrirInativas() {
  _abrirModalPerguntas({
    slug: ANAMNESE_SLUG,
    titulo: 'Perguntas — Anamnese',
    onChange: initAnamneseEditor,
  });
}

// Botao "Histórico" no header do editor — abre modal grande com a
// lista completa. Substitui o antigo bloco colapsavel inline.
async function _renderAnamHistorico() {
  await _renderBotaoHistorico({ slug: ANAMNESE_SLUG, hostId: 'anam-historico-btn-host', titulo: 'Histórico — Anamnese' });
}
async function _renderPesqHistorico() {
  await _renderBotaoHistorico({ slug: PESQUISA_SLUG, hostId: 'pesq-historico-btn-host', titulo: 'Histórico — Pesquisa de Satisfação' });
}

// Encontra o melhor lugar pra colocar o botao: tenta um host
// dedicado (#<hostId>), senao injeta no inicio da view do editor.
async function _renderBotaoHistorico({ slug, hostId, titulo }) {
  // Conta itens pra mostrar no badge (request leve, limite 1 — so pega count via length).
  // Como a API nao tem endpoint de count, pega limite=200 e usa length.
  let total = 0;
  try {
    const r = await api(`/api/qualidade/admin/anamnese/historico?slug=${slug}&limite=200`);
    if (r) { const d = await r.json(); if (d?.ok) total = (d.items || []).length; }
  } catch {}

  // Acha host ou cria proximo ao titulo do editor.
  let host = document.getElementById(hostId);
  if (!host) {
    const view = slug === ANAMNESE_SLUG
      ? document.getElementById('view-anamnese-editor')
      : document.getElementById('view-pesquisa-editor');
    if (!view) return;
    // Coloca como float-right no topo da view
    host = document.createElement('div');
    host.id = hostId;
    host.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:1rem';
    // Insere apos o primeiro filho (geralmente o header h2)
    if (view.firstElementChild?.nextSibling) {
      view.insertBefore(host, view.firstElementChild.nextSibling);
    } else {
      view.appendChild(host);
    }
  }

  host.innerHTML = `
    <button class="btn btn-outline btn-sm" data-act="abrir-historico" style="display:inline-flex;align-items:center;gap:.45rem;font-size:.85rem">
      <span>📜 Histórico</span>
      <span style="background:var(--gold,#b8935a);color:#fff;font-size:.7rem;padding:.1rem .5rem;border-radius:9999px;font-weight:600">${total}</span>
    </button>
  `;
  host.querySelector('[data-act="abrir-historico"]').addEventListener('click', () => _abrirModalHistorico({ slug, titulo }));
}

// Modal grande de historico — compartilhado por anamnese e pesquisa.
// Filtros por tipo de acao + busca + paginacao implicita (carrega 200).
async function _abrirModalHistorico({ slug, titulo }) {
  const ACAO_LABEL = {
    criar: '➕ Criou', editar: '✏ Editou', remover: '🗑 Removeu',
    associar: '🔗 Associou', desassociar: '✂ Desassociou',
    excluir_definitivo: '💥 Excluiu definitivamente',
  };
  const ACAO_COR = {
    criar: '#3a6b47', editar: '#8a6b35', remover: '#9e3832',
    associar: '#5d7555', desassociar: '#8c6f5a', excluir_definitivo: '#9e3832',
  };
  const ENTIDADE_LABEL = {
    pergunta: 'pergunta', secao: 'seção', opcao: 'opção',
    pesquisa_pergunta: 'pergunta na pesquisa',
  };

  // Carrega itens
  let itens = [];
  try {
    const r = await api(`/api/qualidade/admin/anamnese/historico?slug=${slug}&limite=200`);
    if (r) { const d = await r.json(); if (d?.ok) itens = d.items || []; }
  } catch {}

  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.76);backdrop-filter:blur(3px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  ov.innerHTML = `
    <style>.hist-row:hover{background:var(--bg)}</style>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;width:100%;max-width:760px;height:85vh;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.5);overflow:hidden">
      <header style="display:flex;align-items:center;justify-content:space-between;padding:1.1rem 1.4rem;border-bottom:1px solid var(--border)">
        <div>
          <h2 style="margin:0;font-family:var(--serif);font-weight:500;font-size:1.55rem;color:var(--text)">${escHtml(titulo)}</h2>
          <p style="margin:.25rem 0 0 0;color:var(--muted);font-size:.78rem">${itens.length} alterações registradas — mais recente primeiro</p>
        </div>
        <button class="btn btn-outline btn-sm" data-act="close" style="font-size:1rem">✕</button>
      </header>
      <div style="padding:.85rem 1.4rem;border-bottom:1px solid var(--border);display:flex;gap:.4rem;flex-wrap:wrap;background:var(--bg)">
        ${['todas','criar','editar','remover','associar','desassociar','excluir_definitivo'].map(f => `
          <button class="btn btn-outline btn-sm" data-filtro="${f}" style="font-size:.72rem;padding:.3rem .7rem${f === 'todas' ? ';background:var(--gold,#b8935a);color:#fff;border-color:var(--gold,#b8935a)' : ''}">${f === 'todas' ? 'Todas' : (ACAO_LABEL[f] || f)}</button>
        `).join('')}
      </div>
      <div data-lista style="flex:1;overflow-y:auto;padding:.5rem 0"></div>
      <footer style="padding:.7rem 1.4rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end">
        <button class="btn btn-outline" data-act="close">Fechar</button>
      </footer>
    </div>
  `;

  function renderLista(filtro) {
    const lista = ov.querySelector('[data-lista]');
    const filtrados = filtro === 'todas' ? itens : itens.filter(i => i.acao === filtro);
    if (!filtrados.length) {
      lista.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--muted);font-size:.88rem">Nenhuma alteração ${filtro === 'todas' ? 'registrada ainda' : 'com este filtro'}.</div>`;
      return;
    }
    lista.innerHTML = filtrados.map(it => {
      const dt = new Date(it.criado_em.replace(' ', 'T') + 'Z');
      const dtFmt = !isNaN(dt) ? dt.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : it.criado_em;
      const acaoLabel = ACAO_LABEL[it.acao] || it.acao;
      const cor = ACAO_COR[it.acao] || '#8c6f5a';
      const ent  = ENTIDADE_LABEL[it.entidade] || it.entidade;
      const who  = it.usuario || 'sistema';
      return `
        <div class="hist-row" style="display:flex;gap:.8rem;align-items:flex-start;padding:.85rem 1.4rem;border-bottom:1px solid var(--border-lt,#eee);transition:background .12s">
          <div style="flex-shrink:0;width:135px;font-size:.72rem;color:var(--muted);padding-top:.15rem">${dtFmt}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.25rem">
              <span style="background:${cor};color:#fff;font-size:.7rem;padding:.18rem .55rem;border-radius:9999px;font-weight:600">${acaoLabel}</span>
              <span style="color:var(--muted);font-size:.78rem">${ent} #${it.entidade_id ?? '?'}</span>
            </div>
            <div style="color:var(--text);font-size:.9rem;line-height:1.45;margin-bottom:.2rem">${escHtml(it.descricao || '—')}</div>
            <div style="color:var(--muted);font-size:.72rem">por <strong style="color:var(--text);font-weight:500">${escHtml(who)}</strong></div>
          </div>
        </div>
      `;
    }).join('');
  }
  renderLista('todas');

  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
  ov.addEventListener('click', e => {
    if (e.target.dataset.act === 'close') return close();
    const f = e.target.dataset.filtro;
    if (f) {
      ov.querySelectorAll('[data-filtro]').forEach(b => {
        const ativo = b.dataset.filtro === f;
        b.style.background = ativo ? 'var(--gold,#b8935a)' : '';
        b.style.color = ativo ? '#fff' : '';
        b.style.borderColor = ativo ? 'var(--gold,#b8935a)' : '';
      });
      renderLista(f);
    }
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}

// Botao "Perguntas" no header do editor — abre modal com abas
// Ativas / Inativas. Substitui o antigo painel inline.
async function _renderAnamInativas() {
  await _renderBotaoPerguntas({ slug: ANAMNESE_SLUG, hostId: 'anam-perguntas-btn-host', titulo: 'Perguntas — Anamnese', onChange: initAnamneseEditor });
}
async function _renderPesqInativas() {
  await _renderBotaoPerguntas({ slug: PESQUISA_SLUG, hostId: 'pesq-perguntas-btn-host', titulo: 'Perguntas — Pesquisa de Satisfação', onChange: initPesquisaEditor });
}

async function _renderBotaoPerguntas({ slug, hostId, titulo, onChange }) {
  // Conta ativas/inativas para o badge
  let totalAtivas = 0, totalInativas = 0;
  try {
    const r = await api(`/api/qualidade/admin/pesquisas/slug/${slug}/estrutura?_=${Date.now()}`);
    if (r) {
      const d = await r.json();
      if (d?.ok && d.estrutura) {
        for (const s of d.estrutura.secoes) for (const p of (s.perguntas || [])) {
          if (p.ativo === 0) totalInativas++; else totalAtivas++;
        }
      }
    }
  } catch {}

  let host = document.getElementById(hostId);
  if (!host) {
    const view = slug === ANAMNESE_SLUG
      ? document.getElementById('view-anamnese-editor')
      : document.getElementById('view-pesquisa-editor');
    if (!view) return;
    const histHost = document.getElementById(slug === ANAMNESE_SLUG ? 'anam-historico-btn-host' : 'pesq-historico-btn-host');
    host = document.createElement('div');
    host.id = hostId;
    host.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:.5rem';
    if (histHost) histHost.parentNode.insertBefore(host, histHost);
    else view.insertBefore(host, view.firstElementChild?.nextSibling || null);
  }

  host.innerHTML = `
    <button class="btn btn-outline btn-sm" data-act="abrir-perguntas" style="display:inline-flex;align-items:center;gap:.45rem;font-size:.85rem">
      <span>🗂 Perguntas</span>
      <span style="background:var(--success,#3a6b47);color:#fff;font-size:.7rem;padding:.1rem .5rem;border-radius:9999px;font-weight:600" title="Ativas">${totalAtivas}</span>
      <span style="background:#9e3832;color:#fff;font-size:.7rem;padding:.1rem .5rem;border-radius:9999px;font-weight:600" title="Inativas">${totalInativas}</span>
    </button>
  `;
  host.querySelector('[data-act="abrir-perguntas"]').addEventListener('click', () => _abrirModalPerguntas({ slug, titulo, onChange }));
}

// Modal de gerenciamento de perguntas — abas Ativas/Inativas.
// - Ativas: lista somente (informativo). Botoes de edicao continuam nas
//   secoes do editor (modal nao duplica esses fluxos).
// - Inativas: cada item tem botao Reativar. Se respostas_count === 0,
//   tambem botao 'Apagar definitivamente' que abre confirmacao integrada.
async function _abrirModalPerguntas({ slug, titulo, onChange }) {
  let secoes = [];
  try {
    const r = await api(`/api/qualidade/admin/pesquisas/slug/${slug}/estrutura?_=${Date.now()}`);
    if (r) { const d = await r.json(); if (d?.ok && d.estrutura) secoes = d.estrutura.secoes; }
  } catch {}

  const ativas = [], inativas = [];
  for (const s of secoes) for (const p of (s.perguntas || [])) {
    const item = { ...p, secao_titulo: s.titulo };
    if (p.ativo === 0) inativas.push(item); else ativas.push(item);
  }

  const _TIPO = window._TIPO_LABEL_AMIGAVEL || _TIPO_LABEL_AMIGAVEL;

  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.76);backdrop-filter:blur(3px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  ov.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;width:100%;max-width:760px;height:85vh;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.5);overflow:hidden">
      <header style="display:flex;align-items:center;justify-content:space-between;padding:1.1rem 1.4rem;border-bottom:1px solid var(--border)">
        <div>
          <h2 style="margin:0;font-family:var(--serif);font-weight:500;font-size:1.55rem;color:var(--text)">${escHtml(titulo)}</h2>
          <p style="margin:.25rem 0 0 0;color:var(--muted);font-size:.78rem">${ativas.length} ativas · ${inativas.length} inativas</p>
        </div>
        <button class="btn btn-outline btn-sm" data-act="close" style="font-size:1rem">✕</button>
      </header>
      <div style="display:flex;border-bottom:1px solid var(--border);background:var(--bg)">
        <button data-tab="ativas" class="tab-btn" style="flex:1;padding:.9rem;border:none;background:var(--surface);color:var(--text);font-family:inherit;font-size:.85rem;font-weight:600;cursor:pointer;border-bottom:2px solid var(--gold,#b8935a)">Ativas <span style="background:var(--success,#3a6b47);color:#fff;font-size:.68rem;padding:.1rem .45rem;border-radius:9999px;margin-left:.35rem">${ativas.length}</span></button>
        <button data-tab="inativas" class="tab-btn" style="flex:1;padding:.9rem;border:none;background:transparent;color:var(--muted);font-family:inherit;font-size:.85rem;font-weight:600;cursor:pointer;border-bottom:2px solid transparent">Inativas <span style="background:#9e3832;color:#fff;font-size:.68rem;padding:.1rem .45rem;border-radius:9999px;margin-left:.35rem">${inativas.length}</span></button>
      </div>
      <div data-lista style="flex:1;overflow-y:auto"></div>
      <footer style="padding:.7rem 1.4rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end">
        <button class="btn btn-outline" data-act="close">Fechar</button>
      </footer>
    </div>
  `;

  const lista = ov.querySelector('[data-lista]');
  function render(tab) {
    const arr = tab === 'inativas' ? inativas : ativas;
    if (!arr.length) {
      lista.innerHTML = `<div style="padding:2.5rem 1rem;text-align:center;color:var(--muted);font-size:.9rem">${tab === 'inativas' ? 'Nenhuma pergunta inativa. 🎉' : 'Nenhuma pergunta ativa.'}</div>`;
      return;
    }
    lista.innerHTML = arr.map(p => {
      const tipoLabel = _TIPO[p.tipo] || p.tipo;
      const podeExcluir = tab === 'inativas' && p.respostas_count === 0;
      const badgeRespostas = p.respostas_count > 0
        ? `<span style="background:#fdf0ef;color:#9e3832;font-size:.68rem;padding:.15rem .55rem;border-radius:9999px;border:1px solid #f2c4c0;font-weight:600">${p.respostas_count} resposta${p.respostas_count > 1 ? 's' : ''} — preserva histórico</span>`
        : '';
      const obrigBadge = p.obrigatoria
        ? '<span style="background:#9e3832;color:white;font-size:.66rem;padding:.1rem .4rem;border-radius:9999px;font-weight:600">OBRIGATÓRIA</span>'
        : '';
      return `
        <div data-pid="${p.pergunta_id}" data-rotulo="${escHtml(p.rotulo || p.chave)}" style="display:flex;justify-content:space-between;align-items:flex-start;gap:.8rem;padding:.85rem 1.4rem;border-bottom:1px solid var(--border-lt,#eee)">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.25rem">
              <span style="font-size:.95rem;color:var(--text)${tab === 'inativas' ? ';text-decoration:line-through;text-decoration-color:var(--muted)' : ''}">${escHtml(p.rotulo || p.chave)}</span>
              ${obrigBadge}
              <span style="background:var(--surface2,#eee);color:var(--muted);font-size:.68rem;padding:.15rem .5rem;border-radius:9999px">${escHtml(tipoLabel)}</span>
              ${badgeRespostas}
            </div>
            <div style="color:var(--muted);font-size:.72rem">Seção: ${escHtml(p.secao_titulo)}</div>
          </div>
          ${tab === 'inativas' ? `
            <div style="display:flex;gap:.35rem;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">
              <button class="btn btn-outline btn-sm" data-act="reativar">↺ Reativar</button>
              ${podeExcluir ? `<button class="btn btn-outline btn-sm" data-act="excluir" style="color:#9e3832;border-color:#9e3832">Apagar definitivamente</button>` : ''}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }
  render('ativas');

  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
  ov.addEventListener('click', async e => {
    if (e.target.dataset.act === 'close') return close();
    if (e.target.dataset.tab) {
      ov.querySelectorAll('.tab-btn').forEach(b => {
        const ativo = b.dataset.tab === e.target.dataset.tab;
        b.style.background = ativo ? 'var(--surface)' : 'transparent';
        b.style.color = ativo ? 'var(--text)' : 'var(--muted)';
        b.style.borderBottomColor = ativo ? 'var(--gold,#b8935a)' : 'transparent';
      });
      render(e.target.dataset.tab);
      return;
    }
    const wrap = e.target.closest('[data-pid]');
    if (!wrap) return;
    const pid = parseInt(wrap.dataset.pid);
    const rotulo = wrap.dataset.rotulo;
    const act = e.target.dataset.act;
    if (act === 'reativar') {
      try {
        await apiSend('PUT', `/api/qualidade/admin/perguntas/${pid}`, { ativo: 1, pesquisa_slug: slug });
        showToast(`✓ "${rotulo}" reativada`);
        close();
        if (typeof onChange === 'function') onChange();
      } catch (err) { showToast('Erro: ' + err.message, 5000); }
    } else if (act === 'excluir') {
      const ok = await confirmarAcao({
        titulo: `Apagar definitivamente "${rotulo}"?`,
        mensagem: 'A pergunta será removida PERMANENTEMENTE — apaga texto em todos os idiomas, opções e associações. Esta ação não pode ser desfeita.',
        btnConfirmar: 'Sim, apagar para sempre',
        btnCancelar: 'Cancelar',
        perigoso: true,
      });
      if (!ok) return;
      try {
        await apiSend('DELETE', `/api/qualidade/admin/perguntas/${pid}`);
        showToast(`✓ "${rotulo}" apagada definitivamente`);
        close();
        if (typeof onChange === 'function') onChange();
      } catch (err) { showToast('Não foi possível apagar: ' + err.message, 6000); }
    }
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}

// Helper: gera uma chave (slug) a partir de um texto pt-BR.
// Ex: "Possui alguma alergia?" -> "anamnese_possui_alguma_alergia"
function _slugChave(texto, prefixo = 'anamnese_') {
  const base = String(texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50) || 'pergunta';
  // Adiciona sufixo numérico aleatório curto para evitar colisão
  return prefixo + base + '_' + Math.random().toString(36).slice(2, 6);
}

const _TIPO_LABEL_AMIGAVEL = {
  texto_livre: 'Texto curto',
  unica:       'Escolha uma opção',
  multipla:    'Marcar várias opções',
  escala:      'Sim ou Não',
};

// Tipos especificos da PESQUISA de satisfacao. O 'rostos' usa a mesma escala
// (4pt_qualitativa: Ótimo/Bom/Regular/Ruim) das perguntas nativas s0-s3/f0-f2
// — visualmente renderiza com os rostinhos (smileys) no FormScreen.
const _TIPO_LABEL_PESQUISA = {
  ..._TIPO_LABEL_AMIGAVEL,
  rostos: 'Avaliação com rosto',
};

// Cache do escala_id de 4pt_qualitativa — busca uma vez do backend.
let _ESCALA_ID_ROSTOS = null;
async function _getEscalaIdRostos() {
  if (_ESCALA_ID_ROSTOS) return _ESCALA_ID_ROSTOS;
  try {
    const r = await api('/api/qualidade/admin/escalas');
    if (!r) return null;
    const d = await r.json();
    const esc = (d?.items || []).find(e => e.chave === '4pt_qualitativa');
    _ESCALA_ID_ROSTOS = esc?.id || null;
    return _ESCALA_ID_ROSTOS;
  } catch { return null; }
}

function _renderAnamEstrutura() {
  const wrap = document.getElementById('anam-secoes');
  const e = _anamEstrutura;
  // Filtra secoes ativas e perguntas globalmente ativas (admin endpoint
  // retorna todas, incluindo as desativadas via PUT ativo=0).
  const secoesAtivas = (e.secoes || []).filter(s => s.ativo !== 0 && s.ativo !== false);
  for (const s of secoesAtivas) {
    s.perguntas = (s.perguntas || []).filter(q => q.ativo !== 0 && q.ativo !== false);
  }
  wrap.innerHTML = secoesAtivas.map(s => `
    <section class="anam-secao" data-secao-id="${s.id}" style="border:1px solid var(--border);border-radius:10px;padding:1.1rem 1.3rem;margin-bottom:1.4rem;background:var(--surface)">
      <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.9rem;flex-wrap:wrap;gap:.6rem">
        <h3 style="margin:0;font-family:var(--serif);font-size:1.35rem;color:var(--text)">${escHtml(s.titulo)}</h3>
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-outline btn-sm" data-anam-act="edit-secao" data-secao-id="${s.id}">Renomear seção</button>
          <button class="btn btn-outline btn-sm" data-anam-act="del-secao"  data-secao-id="${s.id}" style="color:var(--danger);border-color:var(--danger)">Remover seção</button>
        </div>
      </header>
      <div class="anam-perguntas">
        ${s.perguntas.map((q, i) => _renderAnamPergunta(q, i, s.perguntas.length)).join('')}
      </div>
      <div style="margin-top:.9rem;padding-top:.9rem;border-top:1px dashed var(--border)">
        <div style="font-size:.78rem;color:var(--muted);margin-bottom:.4rem">Adicionar pergunta nesta seção:</div>
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <input data-anam-newperg-rotulo data-secao-id="${s.id}" placeholder="Escreva a pergunta em português…" style="padding:.55rem .7rem;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.92rem;flex:1;min-width:280px;border-radius:4px">
          <select data-anam-newperg-tipo data-secao-id="${s.id}" style="padding:.55rem;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.88rem;border-radius:4px">
            ${Object.entries(_TIPO_LABEL_AMIGAVEL).map(([v,l]) => `<option value="${v}">${escHtml(l)}</option>`).join('')}
          </select>
          <label style="display:inline-flex;align-items:center;gap:.35rem;font-size:.82rem;color:var(--text);cursor:pointer">
            <input type="checkbox" data-anam-newperg-obrig data-secao-id="${s.id}" style="width:1rem;height:1rem;accent-color:var(--gold,#9C5843)">
            Obrigatória
          </label>
          <button class="btn btn-primary btn-sm" data-anam-act="add-pergunta" data-secao-id="${s.id}">+ Adicionar</button>
        </div>
      </div>
    </section>
  `).join('');
  _wireAnamAcoes();
}

function _renderAnamPergunta(q, idx = 0, total = 1) {
  const tipoLabel = _TIPO_LABEL_AMIGAVEL[q.tipo] || q.tipo;
  const opcoes = q.opcoes && q.opcoes.length
    ? `<div style="margin-top:.35rem;color:var(--muted);font-size:.82rem"><strong style="color:var(--text);font-weight:500">Opções:</strong> ${q.opcoes.map(o => escHtml(o.rotulo)).join(' · ')}</div>`
    : '';
  const obrigBadge = q.obrigatoria
    ? '<span style="background:var(--danger);color:white;font-size:.66rem;padding:.1rem .4rem;border-radius:9999px;font-weight:600;letter-spacing:.04em">OBRIGATÓRIA</span>'
    : '';
  const tipoBadge = `<span style="background:var(--surface2,#eee);color:var(--muted);font-size:.7rem;padding:.15rem .5rem;border-radius:9999px">${escHtml(tipoLabel)}</span>`;
  const editOpcoesBtn = (q.tipo === 'unica' || q.tipo === 'multipla')
    ? `<button class="btn btn-outline btn-sm" data-anam-act="edit-opcoes" data-chave="${escHtml(q.chave)}">Opções</button>`
    : '';
  const moveBtns = _renderMoveBtns('anam', q.chave, idx, total);
  return `
    <div class="anam-pergunta" data-perg-chave="${escHtml(q.chave)}" data-assoc-id="${q.associacao_id || ''}" style="display:flex;justify-content:space-between;align-items:flex-start;gap:.8rem;padding:.85rem 1rem;margin-bottom:.5rem;border:1px solid var(--border);border-radius:6px;background:var(--bg)">
      ${moveBtns}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.15rem">
          <span style="font-size:.98rem;color:var(--text)">${escHtml(q.rotulo)}</span>
          ${obrigBadge}
          ${tipoBadge}
        </div>
        ${opcoes}
      </div>
      <div style="display:flex;gap:.3rem;flex-shrink:0">
        <button class="btn btn-outline btn-sm" data-anam-act="edit-perg" data-chave="${escHtml(q.chave)}">Editar</button>
        ${editOpcoesBtn}
        <button class="btn btn-outline btn-sm" data-anam-act="del-perg" data-chave="${escHtml(q.chave)}" style="color:var(--danger);border-color:var(--danger)" title="Remover esta pergunta">×</button>
      </div>
    </div>
  `;
}

// Handle de arrastar (3 traços horizontais) para reordenar perguntas.
// Compartilhado entre editores de anamnese ('anam') e pesquisa ('pesq').
// Funciona com pointer events — touch (tablet/celular) E mouse (desktop).
function _renderMoveBtns(prefix /*, chaveOrId, idx, total */) {
  return `
    <div class="drag-handle" data-drag-prefix="${prefix}" title="Arrastar para reordenar" aria-label="Arrastar para reordenar"
         style="display:flex;flex-direction:column;justify-content:center;gap:3px;flex-shrink:0;padding:.55rem .5rem;margin-right:.1rem;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;border-radius:5px;transition:background .15s">
      <span style="display:block;width:18px;height:2px;background:var(--muted);border-radius:1px"></span>
      <span style="display:block;width:18px;height:2px;background:var(--muted);border-radius:1px"></span>
      <span style="display:block;width:18px;height:2px;background:var(--muted);border-radius:1px"></span>
    </div>
  `;
}

let _anamAcoesWired = false;
function _wireAnamAcoes() {
  if (!_anamAcoesWired) {
    document.getElementById('btn-anam-add-secao')?.addEventListener('click', _anamAddSecao);
    document.getElementById('anamx-btn-historico')?.addEventListener('click', () => _abrirModalHistorico({ slug: ANAMNESE_SLUG, titulo: 'Histórico — Anamnese' }));
    document.getElementById('anamx-btn-inativas')?.addEventListener('click', _anamxAbrirInativas);
    _anamAcoesWired = true;
  }
  // Os botões dentro de cada seção são re-criados a cada render. Substituir
  // listeners é seguro (clone + replace).
  document.querySelectorAll('[data-anam-act]').forEach(btn => {
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    clone.addEventListener('click', () => {
      const act = clone.dataset.anamAct;
      const secaoId = clone.dataset.secaoId ? parseInt(clone.dataset.secaoId) : null;
      const chave = clone.dataset.chave;
      if (act === 'add-pergunta') _anamAddPergunta(secaoId);
      else if (act === 'edit-perg')   _anamEditPergunta(chave);
      else if (act === 'del-perg')    _anamDelPergunta(chave);
      else if (act === 'edit-opcoes') _anamEditOpcoes(chave);
      else if (act === 'edit-secao')  _anamEditSecao(secaoId);
      else if (act === 'del-secao')   _anamDelSecao(secaoId);
    });
  });
  _wireDragReorder('anam');
}

// Tradução pt-BR → 6 idiomas via Anthropic. Se a chamada falhar
// (ou se as traduções voltarem iguais ao pt-BR, indicando que o
// backend caiu no fallback por API key invalida/saldo zerado),
// mostra um toast warning para o admin saber.
// Dispara traducao + PUT em background para nao bloquear UI. tipo='secao' ou 'pergunta'.
function _traduzirEAtualizarBg(tipo, id, rotulo) {
  (async () => {
    try {
      const trad = await _anamTraduzirRotulo(rotulo);
      const traducoes = {};
      for (const [k, v] of Object.entries(trad)) traducoes[k] = v.rotulo;
      const ep = tipo === 'secao'
        ? `/api/qualidade/admin/secoes/${id}`
        : `/api/qualidade/admin/perguntas/${id}`;
      await apiSend('PUT', ep, { traducoes });
    } catch (e) { console.warn('[traduzir bg]', e.message); }
  })();
}

async function _anamTraduzirRotulo(rotuloPtBR) {
  try {
    const r = await api('/api/qualidade/admin/traduzir', {
      method: 'POST',
      body: JSON.stringify({ texto: rotuloPtBR, idiomas: ['pt-PT','en','es','fr','it','de'] }),
    });
    if (!r) {
      showToast('⚠ Traducao automatica indisponivel — salvando so em pt-BR', 5000);
      return { 'pt-BR': { rotulo: rotuloPtBR } };
    }
    const d = await r.json();
    const out = { 'pt-BR': { rotulo: rotuloPtBR } };
    if (d?.ok && d.traducoes) {
      let traduziuAlgum = false;
      for (const [idioma, texto] of Object.entries(d.traducoes)) {
        out[idioma] = { rotulo: texto };
        if (texto && texto.trim() !== rotuloPtBR.trim()) traduziuAlgum = true;
      }
      // Heuristica: se nenhuma traducao mudou o texto, backend caiu no
      // fallback (sem credito/erro na API). Alerta admin.
      if (!traduziuAlgum && Object.keys(d.traducoes).length > 0) {
        showToast('⚠ Traducao MyMemory falhou (rede lenta ou quota diaria 50k palavras esgotada) — salvando so em pt-BR. Tente de novo em alguns minutos.', 7000);
      }
    } else {
      showToast('⚠ Traducao automatica indisponivel — salvando so em pt-BR', 5000);
    }
    return out;
  } catch {
    showToast('⚠ Erro na traducao automatica — salvando so em pt-BR', 5000);
    return { 'pt-BR': { rotulo: rotuloPtBR } };
  }
}

async function _anamAddSecao() {
  if (!_anamPesquisaId) return showToast('Carregando estrutura, aguarde…', 3000);
  const tituloEl = document.getElementById('anam-nova-secao-titulo');
  const titulo = tituloEl?.value.trim();
  if (!titulo) { tituloEl?.focus(); return showToast('Digite o nome da nova seção'); }
  const chave = _slugChave(titulo, 'sec_');
  try {
    const resp = await apiSend('POST', `/api/qualidade/admin/pesquisas/${_anamPesquisaId}/secoes`, {
      chave, ordem: 99, traducoes: { 'pt-BR': titulo },
    });
    showToast('✓ Seção criada (traduzindo nos 7 idiomas em segundo plano…)');
    tituloEl.value = '';
    initAnamneseEditor();
    if (resp?.id) _traduzirEAtualizarBg('secao', resp.id, titulo);
  } catch (e) {
    showToast('Não foi possível criar: ' + e.message, 5000);
  }
}

async function _anamAddPergunta(secaoId) {
  if (!_anamPesquisaId) return showToast('Carregando estrutura, aguarde…');
  const rotuloInp = document.querySelector(`[data-anam-newperg-rotulo][data-secao-id="${secaoId}"]`);
  const tipoSel   = document.querySelector(`[data-anam-newperg-tipo][data-secao-id="${secaoId}"]`);
  const obrigInp  = document.querySelector(`[data-anam-newperg-obrig][data-secao-id="${secaoId}"]`);
  const rotulo = rotuloInp?.value.trim();
  const tipo   = tipoSel?.value || 'texto_livre';
  const obrigatoria = !!obrigInp?.checked;
  if (!rotulo) { rotuloInp?.focus(); return showToast('Escreva a pergunta antes'); }
  const chave = _slugChave(rotulo);
  try {
    const r1 = await apiSend('POST', '/api/qualidade/admin/perguntas', {
      chave, tipo, traducoes: { 'pt-BR': rotulo }, pesquisa_slug: ANAMNESE_SLUG,
    });
    await apiSend('POST', `/api/qualidade/admin/pesquisas/${_anamPesquisaId}/perguntas`, {
      pergunta_id: r1.id, secao_id: secaoId, ordem: 99, obrigatoria, ativo: 1,
    });
    if (tipo === 'escala') {
      try { await _criarOpcoesSimNao(r1.id); } catch (e) { console.warn('Falha ao criar opcoes Sim/Nao:', e.message); }
    }
    showToast('✓ Pergunta criada (traduzindo nos 7 idiomas em segundo plano…)');
    if (rotuloInp) rotuloInp.value = '';
    initAnamneseEditor();
    if (r1?.id) _traduzirEAtualizarBg('pergunta', r1.id, rotulo);
  } catch (e) {
    showToast('Não foi possível criar: ' + e.message, 5000);
  }
}

// Cria as opcoes 'Sim' e 'Nao' traduzidas nos 7 idiomas para uma pergunta
// do tipo 'Sim ou Não'. Usado por _anamAddPergunta e _pesqAddPergunta.
async function _criarOpcoesSimNao(perguntaId) {
  const TRAD = {
    sim: { 'pt-BR': 'Sim', 'pt-PT': 'Sim', en: 'Yes', es: 'Sí', fr: 'Oui', it: 'Sì', de: 'Ja' },
    nao: { 'pt-BR': 'Não', 'pt-PT': 'Não', en: 'No',  es: 'No', fr: 'Non', it: 'No', de: 'Nein' },
  };
  await apiSend('POST', `/api/qualidade/admin/perguntas/${perguntaId}/opcoes`, {
    chave: 'sim', ordem: 1, ativo: 1, traducoes: TRAD.sim,
  });
  await apiSend('POST', `/api/qualidade/admin/perguntas/${perguntaId}/opcoes`, {
    chave: 'nao', ordem: 2, ativo: 1, traducoes: TRAD.nao,
  });
}

async function _anamEditPergunta(chave) {
  const r = await api('/api/qualidade/admin/perguntas');
  if (!r) return;
  const d = await r.json();
  if (!d.ok) return;
  const p = d.items.find(x => x.chave === chave);
  if (!p) return showToast('Pergunta não encontrada');

  // Localiza a associacao desta pergunta na estrutura (pesquisa_pergunta.id +
  // flag obrigatoria) para que o usuario possa toggla-la no modal.
  let _assoc = null;
  for (const sec of (_anamEstrutura?.secoes || [])) {
    const q = (sec.perguntas || []).find(x => x.chave === chave);
    if (q) { _assoc = q; break; }
  }

  // Modal UNICO (texto + tipo + obrigatoria).
  const resp = await pedirPergunta({
    titulo: 'Editar pergunta',
    mensagem: 'Atualize o texto, tipo e/ou obrigatoriedade.',
    valorRotulo: p.rotulo || chave,
    valorTipo: p.tipo,
    valorObrigatoria: !!_assoc?.obrigatoria,
    tipos: Object.entries(_TIPO_LABEL_AMIGAVEL).map(([v,l]) => ({ value: v, label: l })),
  });
  if (!resp) return;

  // Skip total se nada mudou — evita re-traducao inutil e chamadas extras.
  const _assocId = _assoc?.associacao_id;
  const rotuloOriginal = (p.rotulo || chave).trim();
  const rotuloChanged  = (resp.rotulo || '').trim() !== rotuloOriginal;
  const tipoChanged    = resp.tipo !== p.tipo;
  const obrigChanged   = _assocId && resp.obrigatoria !== !!_assoc.obrigatoria;
  if (!rotuloChanged && !tipoChanged && !obrigChanged) {
    return showToast('Nada para salvar — nenhuma alteração detectada', 2500);
  }

  const msgs = [];
  if (rotuloChanged) msgs.push('traduzindo nos 7 idiomas');
  if (tipoChanged)   msgs.push('atualizando tipo');
  if (obrigChanged)  msgs.push('atualizando obrigatoriedade');
  showToast(`Salvando (${msgs.join(', ')})…`, 3000);

  try {
    if (rotuloChanged || tipoChanged) {
      const payload = {};
      if (tipoChanged)   payload.tipo = resp.tipo;
      if (rotuloChanged) payload.traducoes = await _anamTraduzirRotulo(resp.rotulo);
      await apiSend('PUT', `/api/qualidade/admin/perguntas/${p.id}`, payload);
    }
    if (obrigChanged) {
      try {
        await apiSend('PUT', `/api/qualidade/admin/pesquisa-pergunta/${_assocId}`, { obrigatoria: resp.obrigatoria ? 1 : 0 });
      } catch (e) { console.warn('[obrig assoc anam]', e.message); }
    }
    showToast('✓ Pergunta atualizada');
    initAnamneseEditor();
  } catch (e) { showToast('Erro: ' + e.message, 5000); }
}

// Setup de drag-and-drop por seção. prefix = 'anam' | 'pesq'.
// Cada handle (.drag-handle) escuta pointerdown; ao arrastar, a row
// vira position:fixed e segue o pointer; um placeholder mantem o espaço
// e indica onde a pergunta vai parar. Funciona com mouse + touch.
let _dragBusy = false;
function _wireDragReorder(prefix) {
  const containerSel = prefix === 'anam' ? '.anam-perguntas' : '.pesq-perguntas';
  document.querySelectorAll(containerSel).forEach(container => {
    container.querySelectorAll('.drag-handle').forEach(handle => {
      if (handle.dataset.dragWired === '1') return;
      handle.dataset.dragWired = '1';
      handle.addEventListener('pointerdown', (e) => _onDragStart(e, prefix, container, handle));
    });
  });
}

function _onDragStart(ev, prefix, container, handle) {
  if (_dragBusy) return;
  if (ev.button !== undefined && ev.button !== 0) return; // só left-click
  const row = handle.closest('[data-perg-chave],[data-perg-id]');
  if (!row) return;
  ev.preventDefault();
  ev.stopPropagation();

  const rect = row.getBoundingClientRect();
  const offsetY = ev.clientY - rect.top;
  const offsetX = ev.clientX - rect.left;
  const width = rect.width;
  const height = rect.height;
  handle.style.cursor = 'grabbing';

  // Placeholder no lugar original (com glow dourado pulsando)
  const placeholder = document.createElement('div');
  placeholder.style.cssText = `height:${height}px;background:linear-gradient(180deg, rgba(156,88,67,.14), rgba(156,88,67,.06));border:2px dashed var(--gold,#9C5843);border-radius:8px;margin-bottom:.5rem;box-sizing:border-box;pointer-events:none;transition:height .18s ease,opacity .18s ease;animation:_dragPulse 1.2s ease-in-out infinite`;
  container.insertBefore(placeholder, row);

  // "Sai da tela" — flutua, escala leve, rotaciona, sombra dramática.
  const origCss = row.style.cssText;
  const left = rect.left;
  row.style.cssText = origCss + `;position:fixed;top:${rect.top}px;left:${left}px;width:${width}px;z-index:9999;pointer-events:none;opacity:.96;background:var(--surface,#fff);box-shadow:0 22px 48px rgba(0,0,0,.32),0 6px 12px rgba(0,0,0,.18);transform:scale(1.03) rotate(-.6deg);transform-origin:${offsetX}px ${offsetY}px;transition:transform .18s cubic-bezier(.16,1,.3,1),box-shadow .18s ease;will-change:transform,top,left`;
  document.body.appendChild(row);

  // Insere CSS de pulse, transitions nas siblings e alerta fora-da-secao.
  if (!document.getElementById('_drag-style')) {
    const st = document.createElement('style');
    st.id = '_drag-style';
    st.textContent = `
      @keyframes _dragPulse {
        0%,100% { opacity: 1; box-shadow: 0 0 0 0 rgba(156,88,67,.0); }
        50%     { opacity: .88; box-shadow: 0 0 0 6px rgba(156,88,67,.18); }
      }
      @keyframes _dragShake {
        0%,100% { transform: translateX(0); }
        20%     { transform: translateX(-4px); }
        40%     { transform: translateX(4px); }
        60%     { transform: translateX(-3px); }
        80%     { transform: translateX(3px); }
      }
      .anam-pergunta, .pesq-pergunta {
        transition: transform .26s cubic-bezier(.16,1,.3,1);
      }
      .drag-out-bounds {
        outline: 2px solid var(--danger,#d86862) !important;
        outline-offset: -2px;
        box-shadow: 0 0 0 6px rgba(216,104,98,.16), 0 22px 48px rgba(0,0,0,.32) !important;
        animation: _dragShake .35s ease-in-out !important;
        transition: box-shadow .15s ease, outline-color .15s ease !important;
      }
      .drag-zone-warn {
        position: relative;
        outline: 2px dashed var(--danger,#d86862);
        outline-offset: 3px;
        border-radius: 10px;
        transition: outline-color .15s ease;
      }
      .drag-zone-warn::after {
        content: 'Solte dentro desta seção';
        position: absolute;
        top: -.6rem; right: 1rem;
        background: var(--danger,#d86862);
        color: #fff;
        font-size: .7rem; font-weight: 700; letter-spacing: .06em;
        padding: .18rem .55rem;
        border-radius: 9999px;
        box-shadow: 0 4px 12px rgba(216,104,98,.35);
        pointer-events: none;
        animation: _dragShake .35s ease-in-out;
      }
    `;
    document.head.appendChild(st);
  }

  // Descobre a SEÇÃO pai (.anam-secao ou .pesq-secao) para checar limites.
  const secaoEl = container.closest('.anam-secao, .pesq-secao');

  // Cache de posicao das siblings para FLIP animation.
  const _captureSiblingTops = () => {
    const sibs = Array.from(container.children).filter(c => c !== placeholder && c !== row);
    return new Map(sibs.map(s => [s, s.getBoundingClientRect().top]));
  };
  let beforeMap = _captureSiblingTops();

  const _animateFlip = (oldMap) => {
    // FLIP: para cada sibling, calcula delta entre old e new e anima
    requestAnimationFrame(() => {
      oldMap.forEach((oldTop, sib) => {
        if (!sib.isConnected) return;
        const newTop = sib.getBoundingClientRect().top;
        const dy = oldTop - newTop;
        if (Math.abs(dy) > 0.5) {
          sib.style.transition = 'none';
          sib.style.transform = `translateY(${dy}px)`;
          requestAnimationFrame(() => {
            sib.style.transition = 'transform .28s cubic-bezier(.16,1,.3,1)';
            sib.style.transform = '';
          });
        }
      });
    });
  };

  let outOfBounds = false;
  const _checkBounds = (x, y) => {
    if (!secaoEl) return true;
    const sr = secaoEl.getBoundingClientRect();
    const margin = 20; // tolerância em px
    return x >= sr.left - margin && x <= sr.right + margin
        && y >= sr.top - margin  && y <= sr.bottom + margin;
  };
  const _setOutOfBounds = (out) => {
    if (out === outOfBounds) return;
    outOfBounds = out;
    if (out) {
      row.classList.add('drag-out-bounds');
      secaoEl?.classList.add('drag-zone-warn');
    } else {
      row.classList.remove('drag-out-bounds');
      secaoEl?.classList.remove('drag-zone-warn');
    }
  };

  const onMove = (e) => {
    const y = e.clientY;
    const x = e.clientX;
    row.style.top = (y - offsetY) + 'px';
    row.style.left = (x - offsetX) + 'px';
    _setOutOfBounds(!_checkBounds(x, y));
    // Só move placeholder quando dentro dos limites da seção
    if (outOfBounds) return;
    const siblings = Array.from(container.children).filter(c => c !== placeholder && c !== row);
    let targetSibling = null;
    for (const sib of siblings) {
      const r = sib.getBoundingClientRect();
      if (y < r.top + r.height / 2) { targetSibling = sib; break; }
    }
    const currentNext = placeholder.nextElementSibling;
    if (targetSibling && targetSibling !== currentNext) {
      const oldMap = _captureSiblingTops();
      container.insertBefore(placeholder, targetSibling);
      _animateFlip(oldMap);
    } else if (!targetSibling && currentNext !== null) {
      const oldMap = _captureSiblingTops();
      container.appendChild(placeholder);
      _animateFlip(oldMap);
    }
  };

  const onEnd = async () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    handle.style.cursor = 'grab';

    // Se soltou FORA dos limites da seção: cancela — volta ao lugar original
    // (que e' a posicao do placeholder, mantida durante o drag), sem PUT.
    if (outOfBounds) {
      const phRect = placeholder.getBoundingClientRect();
      row.style.transition = 'top .22s cubic-bezier(.16,1,.3,1), left .22s cubic-bezier(.16,1,.3,1), transform .22s ease, box-shadow .22s ease, outline-color .22s ease';
      row.style.top = phRect.top + 'px';
      row.style.left = phRect.left + 'px';
      row.style.transform = 'scale(1) rotate(0)';
      row.style.boxShadow = '0 2px 6px rgba(0,0,0,.08)';
      row.classList.remove('drag-out-bounds');
      secaoEl?.classList.remove('drag-zone-warn');
      await new Promise(r => setTimeout(r, 220));
      row.style.cssText = origCss;
      container.insertBefore(row, placeholder);
      placeholder.remove();
      showToast('Operação cancelada — solte dentro da seção', 2200);
      return;
    }

    // Anima a row de volta ao "chão" suavemente antes de soltar
    const phRect = placeholder.getBoundingClientRect();
    row.style.transition = 'top .18s cubic-bezier(.16,1,.3,1), left .18s cubic-bezier(.16,1,.3,1), transform .18s ease, box-shadow .18s ease';
    row.style.top = phRect.top + 'px';
    row.style.left = phRect.left + 'px';
    row.style.transform = 'scale(1) rotate(0)';
    row.style.boxShadow = '0 2px 6px rgba(0,0,0,.08)';
    await new Promise(r => setTimeout(r, 170));

    row.style.cssText = origCss;
    container.insertBefore(row, placeholder);
    placeholder.remove();

    // Coleta nova ordem
    const ids = Array.from(container.children)
      .map(el => el.dataset.assocId)
      .filter(Boolean);
    if (!ids.length) return;

    _dragBusy = true;
    try {
      await Promise.all(ids.map((assocId, i) =>
        apiSend('PUT', `/api/qualidade/admin/pesquisa-pergunta/${assocId}`, { ordem: (i + 1) * 10 })
      ));
      if (prefix === 'anam') await initAnamneseEditor();
      else                    await initPesquisaEditor();
    } catch (e) {
      showToast('Erro ao reordenar: ' + (e?.message || e), 4000);
      if (prefix === 'anam') initAnamneseEditor();
      else                    initPesquisaEditor();
    } finally {
      _dragBusy = false;
    }
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);
}

async function _anamDelPergunta(chave) {
  // Pega o rotulo amigavel da estrutura local em vez de derivar da
  // chave tecnica (que tinha sufixo aleatorio do _slugChave).
  let rotuloAmigavel = chave.replace(/^anamnese_/,'').replace(/_[a-z0-9]{4}$/,'').replace(/_/g,' ');
  try {
    for (const s of (_anamEstrutura?.secoes || [])) {
      const q = (s.perguntas || []).find(x => x.chave === chave);
      if (q?.rotulo) { rotuloAmigavel = q.rotulo; break; }
    }
  } catch {}
  const ok = await confirmarAcao({
    titulo: 'Remover pergunta?',
    mensagem: `A pergunta "${rotuloAmigavel}" sai da anamnese. Os dados já respondidos por clientes anteriores continuam preservados.`,
    btnConfirmar: 'Sim, remover',
    btnCancelar: 'Voltar',
    perigoso: true,
  });
  if (!ok) return;
  // Busca associacao_id direto na estrutura local (mais robusto que
  // marcar a pergunta global como ativo=0, que afetaria outras pesquisas).
  let assocId = null;
  for (const sec of (_anamEstrutura?.secoes || [])) {
    const q = (sec.perguntas || []).find(x => x.chave === chave);
    if (q?.associacao_id) { assocId = q.associacao_id; break; }
  }
  if (!assocId) return showToast('Associação não encontrada');
  try {
    await apiSend('DELETE', `/api/qualidade/admin/pesquisa-pergunta/${assocId}`);
    showToast('✓ Pergunta removida');
    initAnamneseEditor();
  } catch (e) { showToast('Erro: ' + e.message, 5000); }
}

async function _anamEditOpcoes(chave) {
  const r = await api('/api/qualidade/admin/perguntas');
  if (!r) return;
  const d = await r.json();
  const p = d.items.find(x => x.chave === chave);
  if (!p) return showToast('Pergunta não encontrada');

  const rOp = await api(`/api/qualidade/admin/perguntas/${p.id}/opcoes`);
  if (!rOp) return;
  const dOp = await rOp.json();
  const opcoes = dOp.items || [];
  const textoAtual = opcoes.map(o => (o.traducoes?.['pt-BR'] || o.chave)).join('\n');

  const novo = await pedirTexto({
    titulo: 'Editar opções da pergunta',
    mensagem: 'Uma opção por linha. Remova ou adicione livremente. Traduzido automaticamente nos 7 idiomas.',
    valorInicial: textoAtual,
    placeholder: 'Opção 1\nOpção 2\nOpção 3',
    multilinhas: true,
  });
  if (novo === null) return;

  const linhas = novo.split('\n').map(l => l.trim()).filter(Boolean);
  if (!linhas.length) return showToast('Pelo menos uma opção é obrigatória');

  showToast('Salvando opções e traduzindo…', 3000);
  try {
    // Constrói novosByChave preservando chaves existentes quando o rótulo
    // bater com a tradução antiga; gera chave nova quando o rótulo é novo.
    const novosByChave = {};
    for (const rot of linhas) {
      const existing = opcoes.find(o => (o.traducoes?.['pt-BR'] || o.chave) === rot);
      const k = existing ? existing.chave : _slugChave(rot, '').replace(/_[a-z0-9]{4}$/, '');
      novosByChave[k || rot] = rot;
    }
    // Remove os que sumiram
    for (const o of opcoes) {
      if (!(o.chave in novosByChave)) {
        await apiSend('DELETE', `/api/qualidade/admin/opcoes/${o.id}`);
      }
    }
    // Insere/atualiza com tradução
    let ordem = 1;
    for (const [k, rot] of Object.entries(novosByChave)) {
      const existing = opcoes.find(o => o.chave === k);
      const trad = await _anamTraduzirRotulo(rot);
      const traducoesOp = {};
      for (const [idioma, v] of Object.entries(trad)) traducoesOp[idioma] = v.rotulo;
      await apiSend('POST', `/api/qualidade/admin/perguntas/${p.id}/opcoes`, {
        id: existing?.id || undefined,
        chave: k, ordem: ordem++, ativo: 1,
        traducoes: traducoesOp,
      });
    }
    showToast('✓ Opções atualizadas');
    initAnamneseEditor();
  } catch (e) { showToast('Erro: ' + e.message, 5000); }
}

async function _anamEditSecao(secaoId) {
  const sec = _anamEstrutura.secoes.find(s => s.id === secaoId);
  if (!sec) return;
  const novoTit = await pedirTexto({
    titulo: 'Renomear seção',
    mensagem: 'Novo nome da seção (em português). Traduzido automaticamente nos 7 idiomas.',
    valorInicial: sec.titulo,
    placeholder: 'Nome da seção',
  });
  if (novoTit === null) return;
  showToast('Salvando e traduzindo…', 3000);
  try {
    const trad = await _anamTraduzirRotulo(novoTit.trim());
    const traducoes = {};
    for (const [k, v] of Object.entries(trad)) traducoes[k] = v.rotulo;
    await apiSend('PUT', `/api/qualidade/admin/secoes/${secaoId}`, {
      ordem: sec.ordem,
      traducoes,
    });
    showToast('✓ Seção renomeada');
    initAnamneseEditor();
  } catch (e) { showToast('Erro: ' + e.message, 5000); }
}

async function _anamDelSecao(secaoId) {
  const sec = _anamEstrutura.secoes.find(s => s.id === secaoId);
  const nome = sec ? `"${sec.titulo}"` : 'esta seção';
  const ok = await confirmarAcao({
    titulo: `Remover seção ${nome}?`,
    mensagem: 'A seção e suas perguntas saem do formulário. Os dados já respondidos continuam preservados.',
    btnConfirmar: 'Sim, remover',
    btnCancelar: 'Voltar',
    perigoso: true,
  });
  if (!ok) return;
  try {
    await apiSend('DELETE', `/api/qualidade/admin/secoes/${secaoId}`);
    showToast('✓ Seção removida');
    initAnamneseEditor();
  } catch (e) { showToast('Erro: ' + e.message, 5000); }
}

// Prompt customizado (substitui prompt() nativo com estilo Gran Marquise).
// Retorna o texto digitado ou null se cancelado.
function pedirTexto({ titulo = 'Digite', mensagem = '', valorInicial = '', placeholder = '', multilinhas = false } = {}) {
  return new Promise(resolve => {
    document.querySelectorAll('.confirm-overlay').forEach(n => n.remove());
    const ov = document.createElement('div');
    ov.className = 'confirm-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.72);backdrop-filter:blur(2px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
    const inputHtml = multilinhas
      ? `<textarea id="_pedir-inp" rows="8" placeholder="${escHtml(placeholder)}" style="width:100%;padding:.7rem;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.92rem;border-radius:4px;font-family:inherit;resize:vertical">${escHtml(valorInicial)}</textarea>`
      : `<input id="_pedir-inp" value="${escHtml(valorInicial)}" placeholder="${escHtml(placeholder)}" style="width:100%;padding:.7rem;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.95rem;border-radius:4px">`;
    ov.innerHTML = `
      <div role="dialog" aria-modal="true" style="background:var(--surface);border:1px solid var(--border);border-radius:10px;max-width:560px;width:100%;padding:1.4rem 1.6rem;box-shadow:0 12px 40px rgba(0,0,0,.4)">
        <h3 style="margin:0 0 .4rem 0;font-family:var(--serif);font-size:1.4rem;font-weight:500">${escHtml(titulo)}</h3>
        ${mensagem ? `<p style="margin:0 0 1rem 0;color:var(--muted);font-size:.86rem;line-height:1.5">${escHtml(mensagem)}</p>` : ''}
        ${inputHtml}
        <div style="display:flex;gap:.6rem;justify-content:flex-end;margin-top:1.1rem">
          <button class="btn btn-outline" data-act="cancel">Cancelar</button>
          <button class="btn btn-gold" data-act="ok">Salvar</button>
        </div>
      </div>
    `;
    function close(result) { ov.remove(); document.removeEventListener('keydown', onKey); resolve(result); }
    function onKey(e) {
      if (e.key === 'Escape') close(null);
      else if (e.key === 'Enter' && !multilinhas) close(ov.querySelector('#_pedir-inp').value);
    }
    ov.addEventListener('click', e => {
      if (e.target.dataset.act === 'cancel') close(null);
      else if (e.target.dataset.act === 'ok') close(ov.querySelector('#_pedir-inp').value);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    setTimeout(() => { const i = ov.querySelector('#_pedir-inp'); i?.focus(); if (i && !multilinhas) i.select(); }, 30);
  });
}

// Modal de seleção em dropdown (substitui prompt com lista).
function pedirOpcao({ titulo, mensagem, opcoes = [], valorInicial = '' } = {}) {
  return new Promise(resolve => {
    document.querySelectorAll('.confirm-overlay').forEach(n => n.remove());
    const ov = document.createElement('div');
    ov.className = 'confirm-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.72);backdrop-filter:blur(2px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
    ov.innerHTML = `
      <div role="dialog" aria-modal="true" style="background:var(--surface);border:1px solid var(--border);border-radius:10px;max-width:460px;width:100%;padding:1.4rem 1.6rem;box-shadow:0 12px 40px rgba(0,0,0,.4)">
        <h3 style="margin:0 0 .4rem 0;font-family:var(--serif);font-size:1.4rem;font-weight:500">${escHtml(titulo)}</h3>
        ${mensagem ? `<p style="margin:0 0 1rem 0;color:var(--muted);font-size:.86rem;line-height:1.5">${escHtml(mensagem)}</p>` : ''}
        <select id="_pedir-sel" style="width:100%;padding:.7rem;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.95rem;border-radius:4px">
          ${opcoes.map(o => `<option value="${escHtml(o.value)}"${o.value === valorInicial ? ' selected' : ''}>${escHtml(o.label)}</option>`).join('')}
        </select>
        <div style="display:flex;gap:.6rem;justify-content:flex-end;margin-top:1.1rem">
          <button class="btn btn-outline" data-act="cancel">Cancelar</button>
          <button class="btn btn-gold" data-act="ok">Salvar</button>
        </div>
      </div>
    `;
    function close(r) { ov.remove(); document.removeEventListener('keydown', onKey); resolve(r); }
    function onKey(e) { if (e.key === 'Escape') close(null); else if (e.key === 'Enter') close(ov.querySelector('#_pedir-sel').value); }
    ov.addEventListener('click', e => {
      if (e.target.dataset.act === 'cancel') close(null);
      else if (e.target.dataset.act === 'ok') close(ov.querySelector('#_pedir-sel').value);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    setTimeout(() => ov.querySelector('#_pedir-sel')?.focus(), 30);
  });
}
window.pedirTexto = pedirTexto;
window.pedirOpcao = pedirOpcao;

// Modal unificado para editar/criar pergunta: texto + tipo + obrigatoria
// (evita o fluxo confuso de 2 modais sequenciais que o usuario fechava
// achando que tinha salvado).
// Retorna { rotulo, tipo, obrigatoria } ou null se cancelado.
function pedirPergunta({ titulo = 'Pergunta', mensagem = '', valorRotulo = '', valorTipo = 'texto_livre', valorObrigatoria = false, tipos = [] } = {}) {
  return new Promise(resolve => {
    document.querySelectorAll('.confirm-overlay').forEach(n => n.remove());
    const ov = document.createElement('div');
    ov.className = 'confirm-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.72);backdrop-filter:blur(2px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
    ov.innerHTML = `
      <div role="dialog" aria-modal="true" style="background:var(--surface);border:1px solid var(--border);border-radius:10px;max-width:560px;width:100%;padding:1.4rem 1.6rem;box-shadow:0 12px 40px rgba(0,0,0,.4)">
        <h3 style="margin:0 0 .4rem 0;font-family:var(--serif);font-size:1.4rem;font-weight:500">${escHtml(titulo)}</h3>
        ${mensagem ? `<p style="margin:0 0 1rem 0;color:var(--muted);font-size:.86rem;line-height:1.5">${escHtml(mensagem)}</p>` : ''}
        <label style="display:block;font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:.35rem">Texto da pergunta (português)</label>
        <input id="_pq-rot" value="${escHtml(valorRotulo)}" placeholder="Escreva a pergunta..." style="width:100%;padding:.7rem;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.95rem;border-radius:4px;margin-bottom:1rem">
        <label style="display:block;font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:.35rem">Tipo de resposta</label>
        <select id="_pq-tipo" style="width:100%;padding:.7rem;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.95rem;border-radius:4px">
          ${tipos.map(o => `<option value="${escHtml(o.value)}"${o.value === valorTipo ? ' selected' : ''}>${escHtml(o.label)}</option>`).join('')}
        </select>
        <label style="display:flex;align-items:center;gap:.5rem;margin-top:.95rem;padding:.55rem .75rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);cursor:pointer;user-select:none">
          <input type="checkbox" id="_pq-obrig"${valorObrigatoria ? ' checked' : ''} style="width:1.05rem;height:1.05rem;accent-color:var(--gold,#9C5843)">
          <span style="font-size:.88rem;color:var(--text)"><strong>Obrigatória</strong> — bloqueia o envio se nao for respondida</span>
        </label>
        <p style="margin:.8rem 0 0 0;color:var(--muted);font-size:.78rem;line-height:1.5">A tradução para os outros 6 idiomas é automática ao salvar.</p>
        <div style="display:flex;gap:.6rem;justify-content:flex-end;margin-top:1.2rem">
          <button class="btn btn-outline" data-act="cancel">Cancelar</button>
          <button class="btn btn-gold" data-act="ok">Salvar pergunta</button>
        </div>
      </div>
    `;
    function close(r) { ov.remove(); document.removeEventListener('keydown', onKey); resolve(r); }
    function _collect() {
      const rot = ov.querySelector('#_pq-rot').value.trim();
      const tip = ov.querySelector('#_pq-tipo').value;
      const obr = !!ov.querySelector('#_pq-obrig')?.checked;
      return { rotulo: rot, tipo: tip, obrigatoria: obr };
    }
    function onKey(e) {
      if (e.key === 'Escape') close(null);
      else if (e.key === 'Enter' && e.target?.id === '_pq-rot') {
        const r = _collect();
        if (r.rotulo) close(r);
      }
    }
    ov.addEventListener('click', e => {
      if (e.target.dataset.act === 'cancel') close(null);
      else if (e.target.dataset.act === 'ok') {
        const r = _collect();
        if (!r.rotulo) { ov.querySelector('#_pq-rot').focus(); return; }
        close(r);
      }
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    setTimeout(() => { const i = ov.querySelector('#_pq-rot'); i?.focus(); i?.select(); }, 30);
  });
}
window.pedirPergunta = pedirPergunta;

// ────────────────────────────────────────────────────────────────────────────
// EDITOR DA PESQUISA DE SATISFAÇÃO — gerencia perguntas do spa-locc-v1.
// Clone parametrizado do editor de anamnese: mesma lógica, IDs e slug
// diferentes. Reusa helpers globais (_slugChave, _TIPO_LABEL_AMIGAVEL,
// _anamTraduzirRotulo, pedirTexto, pedirOpcao, confirmarAcao, apiSend).
// ────────────────────────────────────────────────────────────────────────────

// PESQUISA_SLUG hoisted pro topo do arquivo (TDZ fix).
let _pesqPesquisaId = null;
let _pesqEstrutura  = null;

document.getElementById('btn-open-pesquisa-editor')?.addEventListener('click', () => showView('view-pesquisa-editor'));
document.getElementById('btn-pesq-reload')?.addEventListener('click', () => initPesquisaEditor());

async function initPesquisaEditor() {
  const wrap = document.getElementById('pesq-secoes');
  const empty = document.getElementById('pesq-empty');
  empty.style.display = 'block';
  empty.textContent = 'Carregando…';
  wrap.innerHTML = '';

  try {
    const rE = await api(`/api/qualidade/admin/pesquisas/slug/${PESQUISA_SLUG}/estrutura?_=${Date.now()}`);
    if (!rE) return;
    const dE = await rE.json();
    if (!dE.ok || !dE.estrutura) { empty.textContent = `Pesquisa "${PESQUISA_SLUG}" não encontrada.`; return; }
    _pesqPesquisaId = dE.estrutura.id;
    _pesqEstrutura  = dE.estrutura;
  } catch (e) { empty.textContent = 'Erro: ' + e.message; return; }

  empty.style.display = 'none';
  _renderPesqEstrutura();
  _renderPesqInativas();
  _renderPesqHistorico();
}

// _renderPesqHistorico foi unificado com _renderAnamHistorico via
// _renderBotaoHistorico — botao no header + modal grande compartilhado.

function _renderPesqEstrutura() {
  const wrap = document.getElementById('pesq-secoes');
  const e = _pesqEstrutura;
  // Filtra secoes/perguntas inativas (consistencia com fluxo de delete).
  const secoesAtivas = (e.secoes || []).filter(s => s.ativo !== 0 && s.ativo !== false);
  for (const s of secoesAtivas) {
    s.perguntas = (s.perguntas || []).filter(q => q.ativo !== 0 && q.ativo !== false);
  }
  wrap.innerHTML = secoesAtivas.map(s => `
    <section class="pesq-secao" data-secao-id="${s.id}" style="border:1px solid var(--border);border-radius:10px;padding:1.1rem 1.3rem;margin-bottom:1.4rem;background:var(--surface)">
      <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.9rem;flex-wrap:wrap;gap:.6rem">
        <h3 style="margin:0;font-family:var(--serif);font-size:1.35rem;color:var(--text)">${escHtml(s.titulo)}</h3>
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-outline btn-sm" data-pesq-act="edit-secao" data-secao-id="${s.id}">Renomear seção</button>
          <button class="btn btn-outline btn-sm" data-pesq-act="del-secao"  data-secao-id="${s.id}" style="color:var(--danger);border-color:var(--danger)">Remover seção</button>
        </div>
      </header>
      <div class="pesq-perguntas">
        ${s.perguntas.map((q, i) => _renderPesqPergunta(q, i, s.perguntas.length)).join('')}
      </div>
      <div style="margin-top:.9rem;padding-top:.9rem;border-top:1px dashed var(--border)">
        <div style="font-size:.78rem;color:var(--muted);margin-bottom:.4rem">Adicionar pergunta nesta seção:</div>
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <input data-pesq-newperg-rotulo data-secao-id="${s.id}" placeholder="Escreva a pergunta em português…" style="padding:.55rem .7rem;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.92rem;flex:1;min-width:280px;border-radius:4px">
          <select data-pesq-newperg-tipo data-secao-id="${s.id}" style="padding:.55rem;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.88rem;border-radius:4px">
            ${Object.entries(_TIPO_LABEL_PESQUISA).map(([v,l]) => `<option value="${v}">${escHtml(l)}</option>`).join('')}
          </select>
          <label style="display:inline-flex;align-items:center;gap:.35rem;font-size:.82rem;color:var(--text);cursor:pointer">
            <input type="checkbox" data-pesq-newperg-obrig data-secao-id="${s.id}" style="width:1rem;height:1rem;accent-color:var(--gold,#9C5843)">
            Obrigatória
          </label>
          <button class="btn btn-primary btn-sm" data-pesq-act="add-pergunta" data-secao-id="${s.id}">+ Adicionar</button>
        </div>
      </div>
    </section>
  `).join('');
  _wirePesqAcoes();
}

function _renderPesqPergunta(q, idx = 0, total = 1) {
  // Detecta tipo 'rostos' por heuristica: tipo='escala' com escala_id setada
  // (4 opcoes otimo/bom/regular/ruim vindas da escala). Sim/Nao tem opcoes
  // sim/nao sem escala_id.
  let tipoEffective = q.tipo;
  if (q.tipo === 'escala' && q.opcoes?.length === 4 && q.opcoes.every(o => ['otimo','bom','regular','ruim'].includes(o.chave))) {
    tipoEffective = 'rostos';
  }
  const tipoLabel = _TIPO_LABEL_PESQUISA[tipoEffective] || _TIPO_LABEL_AMIGAVEL[q.tipo] || q.tipo;
  const opcoes = q.opcoes && q.opcoes.length
    ? `<div style="margin-top:.35rem;color:var(--muted);font-size:.82rem"><strong style="color:var(--text);font-weight:500">Opções:</strong> ${q.opcoes.map(o => escHtml(o.rotulo)).join(' · ')}</div>`
    : '';
  const obrigBadge = q.obrigatoria
    ? '<span style="background:var(--danger);color:white;font-size:.66rem;padding:.1rem .4rem;border-radius:9999px;font-weight:600;letter-spacing:.04em">OBRIGATÓRIA</span>'
    : '';
  const tipoBadge = `<span style="background:var(--surface2,#eee);color:var(--muted);font-size:.7rem;padding:.15rem .5rem;border-radius:9999px">${escHtml(tipoLabel)}</span>`;
  const editOpcoesBtn = (q.tipo === 'unica' || q.tipo === 'multipla')
    ? `<button class="btn btn-outline btn-sm" data-pesq-act="edit-opcoes" data-pid="${q.pergunta_id}">Opções</button>`
    : '';
  const moveBtns = _renderMoveBtns('pesq', q.pergunta_id, idx, total);
  return `
    <div class="pesq-pergunta" data-perg-id="${q.pergunta_id}" data-assoc-id="${q.associacao_id}" style="display:flex;justify-content:space-between;align-items:flex-start;gap:.8rem;padding:.85rem 1rem;margin-bottom:.5rem;border:1px solid var(--border);border-radius:6px;background:var(--bg)">
      ${moveBtns}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.15rem">
          <span style="font-size:.98rem;color:var(--text)">${escHtml(q.rotulo)}</span>
          ${obrigBadge}
          ${tipoBadge}
        </div>
        ${opcoes}
      </div>
      <div style="display:flex;gap:.3rem;flex-shrink:0">
        <button class="btn btn-outline btn-sm" data-pesq-act="edit-perg" data-pid="${q.pergunta_id}">Editar</button>
        ${editOpcoesBtn}
        <button class="btn btn-outline btn-sm" data-pesq-act="del-perg" data-assoc-id="${q.associacao_id}" data-rotulo="${escHtml(q.rotulo)}" style="color:var(--danger);border-color:var(--danger)" title="Remover pergunta">×</button>
      </div>
    </div>
  `;
}

let _pesqAcoesWired = false;
function _wirePesqAcoes() {
  if (!_pesqAcoesWired) {
    document.getElementById('btn-pesq-add-secao')?.addEventListener('click', _pesqAddSecao);
    _pesqAcoesWired = true;
  }
  document.querySelectorAll('[data-pesq-act]').forEach(btn => {
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    clone.addEventListener('click', () => {
      const act = clone.dataset.pesqAct;
      const secaoId = clone.dataset.secaoId ? parseInt(clone.dataset.secaoId) : null;
      const pid = clone.dataset.pid ? parseInt(clone.dataset.pid) : null;
      const assocId = clone.dataset.assocId ? parseInt(clone.dataset.assocId) : null;
      const rotulo = clone.dataset.rotulo;
      if (act === 'add-pergunta') _pesqAddPergunta(secaoId);
      else if (act === 'edit-perg')   _pesqEditPergunta(pid);
      else if (act === 'del-perg')    _pesqDelPergunta(assocId, rotulo);
      else if (act === 'edit-opcoes') _pesqEditOpcoes(pid);
      else if (act === 'edit-secao')  _pesqEditSecao(secaoId);
      else if (act === 'del-secao')   _pesqDelSecao(secaoId);
    });
  });
  _wireDragReorder('pesq');
}

async function _pesqAddSecao() {
  if (!_pesqPesquisaId) return showToast('Carregando estrutura, aguarde…', 3000);
  const tituloEl = document.getElementById('pesq-nova-secao-titulo');
  const titulo = tituloEl?.value.trim();
  if (!titulo) { tituloEl?.focus(); return showToast('Digite o nome da nova seção'); }
  const chave = _slugChave(titulo, 'sec_');
  try {
    const resp = await apiSend('POST', `/api/qualidade/admin/pesquisas/${_pesqPesquisaId}/secoes`, {
      chave, ordem: 99, traducoes: { 'pt-BR': titulo },
    });
    showToast('✓ Seção criada (traduzindo nos 7 idiomas em segundo plano…)');
    tituloEl.value = '';
    initPesquisaEditor();
    if (resp?.id) _traduzirEAtualizarBg('secao', resp.id, titulo);
  } catch (e) { showToast('Não foi possível criar: ' + e.message, 5000); }
}

async function _pesqAddPergunta(secaoId) {
  if (!_pesqPesquisaId) return showToast('Carregando estrutura, aguarde…');
  const rotuloInp = document.querySelector(`[data-pesq-newperg-rotulo][data-secao-id="${secaoId}"]`);
  const tipoSel   = document.querySelector(`[data-pesq-newperg-tipo][data-secao-id="${secaoId}"]`);
  const obrigInp  = document.querySelector(`[data-pesq-newperg-obrig][data-secao-id="${secaoId}"]`);
  const rotulo = rotuloInp?.value.trim();
  let tipo     = tipoSel?.value || 'texto_livre';
  const obrigatoria = !!obrigInp?.checked;
  if (!rotulo) { rotuloInp?.focus(); return showToast('Escreva a pergunta antes'); }
  const chave = _slugChave(rotulo, 'pesq_');

  // Tipo especial 'rostos': salva como 'escala' atrelada a escala 4pt_qualitativa
  // (mesma das perguntas nativas s0-s3/f0-f2). O FormScreen detecta e renderiza
  // com smileys ao inves de pills.
  let escala_id = null;
  if (tipo === 'rostos') {
    escala_id = await _getEscalaIdRostos();
    if (!escala_id) {
      return showToast('Erro: escala "Ótimo→Ruim" não encontrada no backend.', 5000);
    }
    tipo = 'escala';
  }

  try {
    const r1 = await apiSend('POST', '/api/qualidade/admin/perguntas', {
      chave, tipo, escala_id, traducoes: { 'pt-BR': rotulo }, pesquisa_slug: PESQUISA_SLUG,
    });
    await apiSend('POST', `/api/qualidade/admin/pesquisas/${_pesqPesquisaId}/perguntas`, {
      pergunta_id: r1.id, secao_id: secaoId, ordem: 99, obrigatoria, ativo: 1,
    });
    // Cria opcoes Sim/Nao APENAS quando tipo='escala' SEM escala_id (Sim/Não puro).
    // Se escala_id ja foi setado (caso 'rostos'), as opcoes vem da escala_opcao.
    if (tipo === 'escala' && !escala_id) {
      try { await _criarOpcoesSimNao(r1.id); } catch (e) { console.warn('Falha opcoes Sim/Nao:', e.message); }
    }
    showToast('✓ Pergunta criada (traduzindo nos 7 idiomas em segundo plano…)');
    if (rotuloInp) rotuloInp.value = '';
    initPesquisaEditor();
    if (r1?.id) _traduzirEAtualizarBg('pergunta', r1.id, rotulo);
  } catch (e) { showToast('Não foi possível criar: ' + e.message, 5000); }
}

function _pesqFindPerg(pid) {
  for (const s of (_pesqEstrutura?.secoes || [])) {
    const q = s.perguntas.find(x => x.pergunta_id === pid);
    if (q) return q;
  }
  return null;
}

async function _pesqEditPergunta(pid) {
  const p = _pesqFindPerg(pid);
  if (!p) return showToast('Pergunta não encontrada');

  const resp = await pedirPergunta({
    titulo: 'Editar pergunta',
    mensagem: 'Atualize o texto, tipo de resposta e/ou obrigatoriedade.',
    valorRotulo: p.rotulo || p.chave,
    valorTipo: p.tipo,
    valorObrigatoria: !!p.obrigatoria,
    tipos: Object.entries(_TIPO_LABEL_AMIGAVEL).map(([v,l]) => ({ value: v, label: l })),
  });
  if (!resp) return;

  // Skip total se nada mudou — evita re-traducao inutil.
  const _assocId = p.associacao_id;
  const rotuloOriginal = (p.rotulo || p.chave).trim();
  const rotuloChanged  = (resp.rotulo || '').trim() !== rotuloOriginal;
  const tipoChanged    = resp.tipo !== p.tipo;
  const obrigChanged   = _assocId && resp.obrigatoria !== !!p.obrigatoria;
  if (!rotuloChanged && !tipoChanged && !obrigChanged) {
    return showToast('Nada para salvar — nenhuma alteração detectada', 2500);
  }

  const msgs = [];
  if (rotuloChanged) msgs.push('traduzindo nos 7 idiomas');
  if (tipoChanged)   msgs.push('atualizando tipo');
  if (obrigChanged)  msgs.push('atualizando obrigatoriedade');
  showToast(`Salvando (${msgs.join(', ')})…`, 3000);

  try {
    if (rotuloChanged || tipoChanged) {
      const payload = {};
      if (tipoChanged)   payload.tipo = resp.tipo;
      if (rotuloChanged) payload.traducoes = await _anamTraduzirRotulo(resp.rotulo);
      await apiSend('PUT', `/api/qualidade/admin/perguntas/${pid}`, payload);
    }
    if (obrigChanged) {
      try {
        await apiSend('PUT', `/api/qualidade/admin/pesquisa-pergunta/${_assocId}`, { obrigatoria: resp.obrigatoria ? 1 : 0 });
      } catch (e) { console.warn('[obrig assoc]', e.message); }
    }
    showToast('✓ Pergunta atualizada');
    initPesquisaEditor();
  } catch (e) { showToast('Erro: ' + e.message, 5000); }
}

async function _pesqDelPergunta(assocId, rotulo) {
  if (!assocId) return showToast('ID de associação ausente');
  const ok = await confirmarAcao({
    titulo: 'Remover pergunta?',
    mensagem: `A pergunta ${rotulo ? `"${rotulo}" ` : ''}sai da pesquisa de satisfação. Respostas anteriores continuam preservadas e a pergunta continua disponível em outras pesquisas.`,
    btnConfirmar: 'Sim, remover',
    btnCancelar: 'Voltar',
    perigoso: true,
  });
  if (!ok) return;
  try {
    await apiSend('DELETE', `/api/qualidade/admin/pesquisa-pergunta/${assocId}`);
    showToast('✓ Pergunta removida da pesquisa');
    initPesquisaEditor();
  } catch (e) { showToast('Erro: ' + e.message, 5000); }
}

async function _pesqEditOpcoes(pid) {
  const p = _pesqFindPerg(pid);
  if (!p) return showToast('Pergunta não encontrada');

  const rOp = await api(`/api/qualidade/admin/perguntas/${pid}/opcoes`);
  if (!rOp) return;
  const dOp = await rOp.json();
  const opcoes = dOp.items || [];
  const textoAtual = opcoes.map(o => (o.traducoes?.['pt-BR'] || o.chave)).join('\n');

  const novo = await pedirTexto({
    titulo: 'Editar opções da pergunta',
    mensagem: 'Uma opção por linha. Remova ou adicione livremente. Traduzido automaticamente nos 7 idiomas.',
    valorInicial: textoAtual,
    placeholder: 'Opção 1\nOpção 2\nOpção 3',
    multilinhas: true,
  });
  if (novo === null) return;
  const linhas = novo.split('\n').map(l => l.trim()).filter(Boolean);
  if (!linhas.length) return showToast('Pelo menos uma opção é obrigatória');

  showToast('Salvando opções e traduzindo…', 3000);
  try {
    const novosByChave = {};
    for (const rot of linhas) {
      const existing = opcoes.find(o => (o.traducoes?.['pt-BR'] || o.chave) === rot);
      const k = existing ? existing.chave : _slugChave(rot, '').replace(/_[a-z0-9]{4}$/, '');
      novosByChave[k || rot] = rot;
    }
    for (const o of opcoes) {
      if (!(o.chave in novosByChave)) {
        await apiSend('DELETE', `/api/qualidade/admin/opcoes/${o.id}`);
      }
    }
    let ordem = 1;
    for (const [k, rot] of Object.entries(novosByChave)) {
      const existing = opcoes.find(o => o.chave === k);
      const trad = await _anamTraduzirRotulo(rot);
      const traducoesOp = {};
      for (const [idioma, v] of Object.entries(trad)) traducoesOp[idioma] = v.rotulo;
      await apiSend('POST', `/api/qualidade/admin/perguntas/${pid}/opcoes`, {
        id: existing?.id || undefined,
        chave: k, ordem: ordem++, ativo: 1,
        traducoes: traducoesOp,
      });
    }
    showToast('✓ Opções atualizadas');
    initPesquisaEditor();
  } catch (e) { showToast('Erro: ' + e.message, 5000); }
}

async function _pesqEditSecao(secaoId) {
  const sec = _pesqEstrutura.secoes.find(s => s.id === secaoId);
  if (!sec) return;
  const novoTit = await pedirTexto({
    titulo: 'Renomear seção',
    mensagem: 'Novo nome da seção (em português). Traduzido automaticamente nos 7 idiomas.',
    valorInicial: sec.titulo,
    placeholder: 'Nome da seção',
  });
  if (novoTit === null) return;
  showToast('Salvando e traduzindo…', 3000);
  try {
    const trad = await _anamTraduzirRotulo(novoTit.trim());
    const traducoes = {};
    for (const [k, v] of Object.entries(trad)) traducoes[k] = v.rotulo;
    await apiSend('PUT', `/api/qualidade/admin/secoes/${secaoId}`, { ordem: sec.ordem, traducoes });
    showToast('✓ Seção renomeada');
    initPesquisaEditor();
  } catch (e) { showToast('Erro: ' + e.message, 5000); }
}

async function _pesqDelSecao(secaoId) {
  const sec = _pesqEstrutura.secoes.find(s => s.id === secaoId);
  const nome = sec ? `"${sec.titulo}"` : 'esta seção';
  const ok = await confirmarAcao({
    titulo: `Remover seção ${nome}?`,
    mensagem: 'A seção e suas perguntas saem da pesquisa. Respostas anteriores continuam preservadas.',
    btnConfirmar: 'Sim, remover',
    btnCancelar: 'Voltar',
    perigoso: true,
  });
  if (!ok) return;
  try {
    await apiSend('DELETE', `/api/qualidade/admin/secoes/${secaoId}`);
    showToast('✓ Seção removida');
    initPesquisaEditor();
  } catch (e) { showToast('Erro: ' + e.message, 5000); }
}

// ═══════════════════════════════════════════════════════
// GESTÃO DE SALAS
// ═══════════════════════════════════════════════════════

let _salasData = [];
let _bloqueioEmEdicao = null;
let _reservasConflito = [];
let _bloqueioConflito = null;

async function loadSalas() {
  try {
    const r = await api('/api/admin/salas');
    const d = await r.json();
    if (!d.ok) return;
    _salasData = d.salas || [];
    renderSalas();
  } catch (e) {
    console.error('loadSalas:', e);
  }
}

const TIPO_SALA_LABEL = {
  individual: 'Individual',
  conjugada:  'Conjugada',
  beleza:     'Beleza',
  evento:     'Evento',
};
const TIPO_SALA_CAP = {
  individual: '1 pessoa',
  conjugada:  '2 pessoas',
  beleza:     'Múltiplos',
  evento:     'Múltiplos',
};

function renderSalas() {
  const grid = document.getElementById('salas-grid');
  if (!grid) return;
  const hoje = new Date().toISOString().slice(0, 10);

  const bloqueadasCount = _salasData.filter(s => (s.bloqueios || []).some(b => b.data_fim >= hoje)).length;
  const elById = id => document.getElementById(id);
  if (elById('sala-stat-total'))       elById('sala-stat-total').textContent       = _salasData.length;
  if (elById('sala-stat-disponiveis')) elById('sala-stat-disponiveis').textContent = _salasData.length - bloqueadasCount;
  if (elById('sala-stat-bloqueadas'))  elById('sala-stat-bloqueadas').textContent  = bloqueadasCount;

  if (_salasData.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--muted);font-size:.9rem">Nenhuma sala cadastrada.</div>';
    return;
  }

  grid.innerHTML = _salasData.map(s => {
    const bloqueiosAtivos = (s.bloqueios || []).filter(b => b.data_fim >= hoje);
    const estaBloqueada = bloqueiosAtivos.length > 0;
    const bloqAtual = estaBloqueada ? bloqueiosAtivos[0] : null;
    const tipoLabel = TIPO_SALA_LABEL[s.tipo] || s.tipo;
    const capLabel  = TIPO_SALA_CAP[s.tipo]   || '—';
    return `
    <div class="sc3-card s${s.id}${estaBloqueada ? ' sc3-bloq' : ''}">
      <div class="sc3-wm">${s.id}</div>
      <div class="sc3-head">
        <span class="sc3-lbl">Sala ${s.id}</span>
        ${estaBloqueada
          ? `<span class="sc3-pill sc3-pill-danger">⛔ Bloqueada</span>`
          : `<span class="sc3-pill sc3-pill-ok">● Disponível</span>`
        }
      </div>
      <div class="sc3-nome">${escHtml(s.nome)}</div>
      <div class="sc3-chips">
        <span class="sc3-chip">${tipoLabel}</span>
        <span class="sc3-chip">${capLabel}</span>
      </div>
      ${s.observacao ? `<div class="sc3-obs">${escHtml(s.observacao)}</div>` : ''}
      ${estaBloqueada && bloqAtual ? `
        <div class="sc3-bloq-banner">
          <div class="sc3-bloq-banner-lbl">⚠ Motivo</div>
          <div class="sc3-bloq-banner-motivo">${escHtml(bloqAtual.motivo)}</div>
          <div class="sc3-bloq-banner-date">${fmtDate(bloqAtual.data_inicio)} → ${fmtDate(bloqAtual.data_fim)}${bloqAtual.bloqueado_por ? ` · ${escHtml(bloqAtual.bloqueado_por)}` : ''}</div>
        </div>
      ` : ''}
      <div class="sc3-div"></div>
      <div class="sc3-actions">
        ${estaBloqueada && bloqAtual ? `
          <button type="button" class="btn btn-gold btn-sm" style="flex:1" data-action="desbloquear-sala" data-bloqueio-id="${bloqAtual.id}" data-sala-id="${s.id}">🔓 Desbloquear</button>
          <button type="button" class="btn btn-outline btn-sm" data-action="editar-sala" data-sala-id="${s.id}">✎ Editar</button>
          ${bloqueiosAtivos.length > 1 ? `<button type="button" class="btn btn-outline btn-sm" style="width:100%" data-action="lista-bloqueios" data-sala-id="${s.id}">Outros bloqueios (${bloqueiosAtivos.length - 1})</button>` : ''}
        ` : `
          <button type="button" class="btn btn-outline btn-sm" data-action="lista-bloqueios" data-sala-id="${s.id}">📋 Bloqueios</button>
          <button type="button" class="btn btn-outline btn-sm" data-action="editar-sala" data-sala-id="${s.id}">✎ Editar</button>
          <button type="button" class="btn btn-outline btn-sm btn-danger-outline" style="flex:1" data-action="bloquear-sala" data-sala-id="${s.id}">⛔ Bloquear</button>
        `}
      </div>
    </div>`;
  }).join('');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ─── Editar sala ─────────────────────────────────────

function abrirEditarSala(salaId) {
  const s = _salasData.find(x => x.id === salaId);
  if (!s) return;
  document.getElementById('edit-sala-id').value = s.id;
  document.getElementById('edit-sala-nome').value = s.nome;
  document.getElementById('edit-sala-tipo').value = s.tipo;
  document.getElementById('edit-sala-obs').value = s.observacao || '';
  document.getElementById('modal-sala-edit').style.display = 'flex';
}

document.getElementById('btn-fechar-sala-edit')?.addEventListener('click', fecharModalSalaEdit);

function fecharModalSalaEdit() {
  document.getElementById('modal-sala-edit').style.display = 'none';
}

document.getElementById('form-sala-edit')?.addEventListener('submit', async e => {
  e.preventDefault();
  const id = Number(document.getElementById('edit-sala-id').value);
  const nome = document.getElementById('edit-sala-nome').value.trim();
  const tipo = document.getElementById('edit-sala-tipo').value;
  const observacao = document.getElementById('edit-sala-obs').value.trim();
  if (!nome) return;
  try {
    const r = await api(`/api/admin/salas/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, tipo, observacao: observacao || null }) });
    const d = await r.json();
    if (d.ok) { fecharModalSalaEdit(); loadSalas(); }
    else alert('Erro: ' + d.error);
  } catch (e2) { alert('Erro de rede'); }
});

// ─── Novo bloqueio ───────────────────────────────────

function abrirNovoBloqueio(salaId) {
  _bloqueioEmEdicao = { sala: salaId };
  const s = _salasData.find(x => x.id === salaId);
  document.getElementById('bloqueio-sala-label').textContent = s?.nome || `Sala ${salaId}`;
  document.getElementById('bloqueio-data-inicio').value = '';
  document.getElementById('bloqueio-data-fim').value = '';
  document.getElementById('bloqueio-motivo').value = '';
  document.getElementById('bloqueio-err').style.display = 'none';
  document.getElementById('modal-sala-bloqueio').style.display = 'flex';
}

document.getElementById('btn-fechar-sala-bloqueio')?.addEventListener('click', fecharModalBloqueio);

function fecharModalBloqueio() {
  document.getElementById('modal-sala-bloqueio').style.display = 'none';
  _bloqueioEmEdicao = null;
}

document.getElementById('form-sala-bloqueio')?.addEventListener('submit', async e => {
  e.preventDefault();
  if (!_bloqueioEmEdicao) return;
  const sala = _bloqueioEmEdicao.sala;
  const data_inicio = document.getElementById('bloqueio-data-inicio').value;
  const data_fim = document.getElementById('bloqueio-data-fim').value;
  const motivo = document.getElementById('bloqueio-motivo').value.trim();
  const errEl = document.getElementById('bloqueio-err');
  errEl.style.display = 'none';
  if (!data_inicio || !data_fim || !motivo) { errEl.textContent = 'Preencha todos os campos'; errEl.style.display = 'block'; return; }
  if (data_fim < data_inicio) { errEl.textContent = 'Data fim deve ser ≥ data início'; errEl.style.display = 'block'; return; }
  try {
    const r = await api(`/api/admin/salas/${sala}/bloqueios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_inicio, data_fim, motivo }),
    });
    const d = await r.json();
    if (r.status === 409 && d.tipo === 'reservas_no_periodo') {
      // Há reservas — mostrar modal de conflito
      _reservasConflito = d.reservas;
      _bloqueioConflito = { sala, data_inicio, data_fim, motivo };
      fecharModalBloqueio();
      renderModalConflito(d.total);
      document.getElementById('modal-bloqueio-conflito').style.display = 'flex';
      return;
    }
    if (!d.ok) { errEl.textContent = d.error || 'Erro ao salvar'; errEl.style.display = 'block'; return; }
    fecharModalBloqueio();
    loadSalas();
  } catch (e2) { errEl.textContent = 'Erro de rede'; errEl.style.display = 'block'; }
});

// ─── Modal conflito de reservas ──────────────────────

function renderModalConflito(total) {
  const s = _salasData.find(x => x.id === _bloqueioConflito?.sala);
  document.getElementById('conflito-sala-nome').textContent = s?.nome || '';
  document.getElementById('conflito-total').textContent = total;
  const lista = document.getElementById('conflito-lista');
  lista.innerHTML = _reservasConflito.map(r => `
    <div class="conflito-item">
      <strong>${escHtml(r.cliente)}</strong>
      <span>${fmtDate(r.data)} · ${escHtml(r.hora_inicio)}–${escHtml(r.hora_fim)}</span>
    </div>`).join('');
}

document.getElementById('btn-conflito-cancelar')?.addEventListener('click', fecharModalConflito);

function fecharModalConflito() {
  document.getElementById('modal-bloqueio-conflito').style.display = 'none';
  _reservasConflito = [];
  _bloqueioConflito = null;
}

// Botão "Transferir automaticamente"
document.getElementById('btn-conflito-transferir')?.addEventListener('click', async () => {
  if (!_bloqueioConflito) return;
  const { sala, data_inicio, data_fim, motivo } = _bloqueioConflito;
  try {
    // 1. Criar bloqueio confirmado
    const rb = await api(`/api/admin/salas/${sala}/bloqueios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_inicio, data_fim, motivo, confirmar: true }),
    });
    const db = await rb.json();
    if (!db.ok) { alert('Erro ao criar bloqueio: ' + db.error); return; }
    // 2. Transferir reservas
    const rt = await api(`/api/admin/salas/${sala}/bloqueios/${db.id}/transferir`, { method: 'POST' });
    const dt = await rt.json();
    fecharModalConflito();
    if (dt.sem_disponibilidade > 0) {
      alert(`Bloqueio criado. ${dt.transferidas} reserva(s) transferida(s).\n⚠️ ${dt.sem_disponibilidade} reserva(s) SEM sala disponível — ajuste manualmente.`);
    } else {
      alert(`Bloqueio criado. ${dt.transferidas} reserva(s) transferida(s) automaticamente.`);
    }
    loadSalas();
  } catch (e) { alert('Erro: ' + e.message); }
});

// Botão "Editar uma por uma"
let _indexReservaManual = 0;
document.getElementById('btn-conflito-manual')?.addEventListener('click', async () => {
  if (!_bloqueioConflito) return;
  const { sala, data_inicio, data_fim, motivo } = _bloqueioConflito;
  // 1. Criar bloqueio
  const rb = await api(`/api/admin/salas/${sala}/bloqueios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data_inicio, data_fim, motivo, confirmar: true }),
  });
  const db = await rb.json();
  if (!db.ok) { alert('Erro: ' + db.error); return; }
  fecharModalConflito();
  // 2. Abrir editor para a primeira reserva
  _indexReservaManual = 0;
  abrirEditorReservaManual();
});

async function abrirEditorReservaManual() {
  if (_indexReservaManual >= _reservasConflito.length) {
    alert('Todas as reservas foram verificadas.');
    loadSalas();
    return;
  }
  const r = _reservasConflito[_indexReservaManual];
  const s = _salasData.find(x => x.id === _bloqueioConflito?.sala);
  // Buscar salas disponíveis
  const rd = await api(`/api/admin/salas/disponiveis?data=${r.data}&hora_inicio=${r.hora_inicio}&hora_fim=${r.hora_fim}&excluir=${s?.id || ''}`);
  const dd = await rd.json();
  const disponivel = dd.salas || [];
  document.getElementById('reserva-manual-info').innerHTML = `
    <strong>${escHtml(r.cliente)}</strong> — ${fmtDate(r.data)} ${escHtml(r.hora_inicio)}–${escHtml(r.hora_fim)}
    <br><small>Reserva #${r.id}</small>`;
  const sel = document.getElementById('reserva-manual-sala-select');
  sel.innerHTML = '<option value="">Escolha uma sala…</option>' +
    disponivel.map(sv => `<option value="${sv.id}">${escHtml(sv.nome)} (${TIPO_SALA_LABEL[sv.tipo] || sv.tipo})</option>`).join('') +
    (disponivel.length === 0 ? '<option disabled>Sem salas disponíveis neste horário</option>' : '');
  document.getElementById('reserva-manual-idx').textContent = `${_indexReservaManual + 1} de ${_reservasConflito.length}`;
  document.getElementById('modal-reserva-manual').style.display = 'flex';
}

document.getElementById('btn-reserva-manual-salvar')?.addEventListener('click', async () => {
  const r = _reservasConflito[_indexReservaManual];
  const novaSala = Number(document.getElementById('reserva-manual-sala-select').value);
  if (!novaSala) { alert('Selecione uma sala'); return; }
  try {
    const resp = await api(`/api/admin/salas/reservas/${r.id}/sala`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sala: novaSala }),
    });
    const d = await resp.json();
    if (!d.ok) { alert('Erro: ' + d.error); return; }
    document.getElementById('modal-reserva-manual').style.display = 'none';
    _indexReservaManual++;
    abrirEditorReservaManual();
  } catch (e) { alert('Erro de rede'); }
});

document.getElementById('btn-reserva-manual-pular')?.addEventListener('click', () => {
  document.getElementById('modal-reserva-manual').style.display = 'none';
  _indexReservaManual++;
  abrirEditorReservaManual();
});

// ─── Lista de bloqueios de uma sala ──────────────────

async function abrirListaBloqueios(salaId) {
  const s = _salasData.find(x => x.id === salaId);
  document.getElementById('lista-bloqueios-sala-nome').textContent = s?.nome || `Sala ${salaId}`;
  const r = await api(`/api/admin/salas/${salaId}/bloqueios`);
  const d = await r.json();
  const lista = document.getElementById('lista-bloqueios-items');
  const hoje = new Date().toISOString().slice(0, 10);
  lista.innerHTML = (d.bloqueios || []).map(b => `
    <div class="bloqueio-item">
      <div>
        <strong>${fmtDate(b.data_inicio)} → ${fmtDate(b.data_fim)}</strong>
        <span class="${b.data_fim >= hoje ? 'bloqueio-ativo' : 'bloqueio-passado'}">${b.data_fim >= hoje ? 'Ativo' : 'Expirado'}</span>
      </div>
      <div class="bloqueio-motivo">${escHtml(b.motivo)}</div>
      ${b.bloqueado_por ? `<div class="bloqueio-por">Por: ${escHtml(b.bloqueado_por)}</div>` : ''}
      ${b.data_fim >= hoje ? `<button type="button" class="btn btn-outline btn-sm btn-danger-outline" data-action="remover-bloqueio" data-bloqueio-id="${b.id}">Remover bloqueio</button>` : ''}
    </div>`).join('') || '<p style="color:var(--muted)">Sem bloqueios cadastrados</p>';
  document.getElementById('modal-lista-bloqueios').style.display = 'flex';
}

document.getElementById('btn-fechar-lista-bloqueios')?.addEventListener('click', () => {
  document.getElementById('modal-lista-bloqueios').style.display = 'none';
});

async function removerBloqueioUI(id) {
  if (!await confirmarAcao({ titulo: 'Remover bloqueio?', mensagem: 'O período de bloqueio será cancelado e a sala ficará disponível.', btnConfirmar: 'Remover', perigoso: true })) return;
  const r = await api(`/api/admin/salas/bloqueios/${id}`, { method: 'DELETE' });
  const d = await r.json();
  if (d.ok) {
    document.getElementById('modal-lista-bloqueios').style.display = 'none';
    loadSalas();
  } else alert('Erro: ' + d.error);
}

async function desbloquearSala(bloqueioId, salaId) {
  const s = _salasData.find(x => x.id === salaId);
  const nome = s?.nome || `Sala ${salaId}`;
  if (!await confirmarAcao({ titulo: `Desbloquear "${nome}"?`, mensagem: 'O bloqueio atual será removido e a sala ficará disponível para novas reservas.', btnConfirmar: '🔓 Desbloquear' })) return;
  try {
    const r = await api(`/api/admin/salas/bloqueios/${bloqueioId}`, { method: 'DELETE' });
    if (!r) return;
    const d = await r.json();
    if (d.ok) {
      showToast(`✓ ${nome} desbloqueada`);
      loadSalas();
    } else {
      showToast('Erro ao desbloquear: ' + (d.error || ''), 5000);
    }
  } catch (e) {
    showToast('Erro: ' + e.message, 5000);
  }
}

// ── Delegação de eventos — Gestão de Salas ────────────────────────────────
// Cobre botões estáticos (admin.html) e dinâmicos (renderSalas / abrirListaBloqueios).
// CSP script-src-attr 'none' bloqueia onclick inline; data-action contorna isso.
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const salaId = btn.dataset.salaId ? Number(btn.dataset.salaId) : null;
  const bloqueioId = btn.dataset.bloqueioId ? Number(btn.dataset.bloqueioId) : null;
  switch (action) {
    case 'reload-salas':      loadSalas(); break;
    case 'editar-sala':       abrirEditarSala(salaId); break;
    case 'bloquear-sala':     abrirNovoBloqueio(salaId); break;
    case 'desbloquear-sala':  desbloquearSala(bloqueioId, salaId); break;
    case 'lista-bloqueios':   abrirListaBloqueios(salaId); break;
    case 'remover-bloqueio':  removerBloqueioUI(bloqueioId); break;
    case 'fechar-sala-edit':  fecharModalSalaEdit(); break;
    case 'fechar-sala-bloqueio': fecharModalBloqueio(); break;
  }
});

// Deep-link via ?open=: gerado por shared-header.js quando context !== 'admin'
// (ex: escala-spa.html). Roda após todos os addEventListener estarem registrados
// para poder delegar via .click(). Allowlist impede valores arbitrários.
(function () {
  const open = new URLSearchParams(location.search).get('open');
  if (!open) return;
  const ALLOW = new Set([
    'btn-open-massagistas', 'btn-open-tipos', 'btn-open-relatorios',
    'btn-open-qualidade', 'btn-open-anamnese-editor', 'btn-open-pesquisa-editor',
    'btn-open-clientes', 'btn-open-usuarios', 'btn-open-salas', 'btn-open-auditoria',
  ]);
  if (!ALLOW.has(open)) return;
  if (document.getElementById('app-screen')?.style.display !== 'block') return;
  const btn = document.getElementById(open);
  if (btn) {
    btn.click();
    history.replaceState(null, '', '/admin');
  }
}());
