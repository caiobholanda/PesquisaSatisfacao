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

const LANGS_PRE = [
  { code: 'pt-BR', flag: '🇧🇷', name: 'Português (Brasil)' },
  { code: 'pt-PT', flag: '🇵🇹', name: 'Português (Portugal)' },
  { code: 'en',    flag: '🇺🇸', name: 'English' },
  { code: 'fr',    flag: '🇫🇷', name: 'Français' },
  { code: 'es',    flag: '🇪🇸', name: 'Español' },
  { code: 'it',    flag: '🇮🇹', name: 'Italiano' },
  { code: 'de',    flag: '🇩🇪', name: 'Deutsch' },
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
  return `<span class="gc-badge" style="display:inline-flex;align-items:center;gap:.25rem;padding:.18rem .55rem;border:1px solid #c9a86a;border-radius:9999px;background:linear-gradient(180deg,#fbe9c5,#e7c682);color:#5b3d10;font-family:'Cormorant Garamond',Georgia,serif;font-weight:600;font-size:.74rem;letter-spacing:.08em;text-transform:uppercase">★ ${label}</span>`;
}
window.isGranClassCli = isGranClassCli;
window.badgeGranClassHtml = badgeGranClassHtml;

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

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
  ['btn-open-massagistas', 'btn-open-escala', 'btn-open-tipos'].forEach(id => {
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
  const st = JSON.parse(sessionStorage.getItem('_vst') || '{}');
  const view = st.view || 'view-reservas';
  showView(view);
  if (view === 'view-massagistas') { loadMassagistas(); }
  else if (view === 'view-tipos') { loadTipos(); }
  else if (view === 'view-historico' && st.histId) { showHistoricoMassagista(st.histId, st.histNome); }
  else if (view === 'view-historico-clientes') { loadHistoricoClientes(); }
  else if (view === 'view-relatorio-mensal') { loadRelatorioMensal(); }
  else if (view === 'view-qualidade') { loadQualidade(); }
  else if (view === 'view-clientes') { initClienteView(); }
  else if (view === 'view-auditoria') { initAuditoriaView(); }
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

async function openDrawer(id) {
  const drawerEl = document.getElementById('drawer');
  const content  = document.getElementById('drawer-content');
  content.innerHTML = '<div class="detail-section"><div class="skeleton-line" style="width:60%"></div><div class="skeleton-line" style="width:40%"></div><div class="skeleton-line" style="width:75%"></div></div>';
  drawerEl.classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
  _modalOpen = true;

  const res = await api(`/api/feedback/item/${id}`);
  if (!res) return;
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
  };
  _offset = 0;
  loadAll();
});

// Botão "Exportar CSV" removido a pedido: relatórios consultados apenas
// na tela. Endpoint /api/feedback?format=csv continua disponível pra uso
// externo se necessário.

function loadAll() { loadStats(); loadTable(); }

// ── Navegação entre views ──
function showView(id) {
  // Lista completa de views. Adicoes anteriores (view-relatorio-mensal,
  // view-qualidade) tinham que entrar aqui — sem isso o display nunca
  // virava 'block' e a view ficava invisivel.
  ['view-main', 'view-massagistas', 'view-escala', 'view-tipos', 'view-historico', 'view-reservas', 'view-historico-clientes', 'view-usuarios', 'view-relatorio-mensal', 'view-qualidade', 'view-clientes', 'view-auditoria', 'view-anamnese-editor', 'view-pesquisa-editor'].forEach(v => {
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
  if (id === 'view-relatorio-mensal') loadRelatorioMensal();
  if (id === 'view-historico-clientes') loadHistoricoClientes();
  if (id === 'view-anamnese-editor') initAnamneseEditor();
  if (id === 'view-pesquisa-editor') initPesquisaEditor();
}

// ── Sub-abas de Relatórios ──
// Mantém 3 views fisicamente separadas no DOM (view-main, view-relatorio-mensal
// e view-historico-clientes) mas apresenta uma barra de abas única no topo
// para o usuário alternar entre elas como se fossem uma só página.
const REL_TABS = [
  { view: 'view-main',                 label: 'Avaliações' },
  { view: 'view-relatorio-mensal',     label: 'Visão Mensal' },
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
      border-bottom:2px solid ${ativo ? 'var(--gold,#bf9a55)' : 'transparent'};
      color:${ativo ? 'var(--text)' : 'var(--muted)'};
      font-family:'Cormorant Garamond',Georgia,serif;font-size:1.08rem;
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

// ── Liberar Pesquisa de Satisfação ──
const _pesquisasLiberadas = new Set();

const _fichasEnviadas = new Set();

function _estadoBtnFicha(r) {
  if (_fichasEnviadas.has(r.id)) return 'enviada';
  const inicio = new Date(`${r.data}T${r.hora_inicio}:00`).getTime();
  if (Date.now() > inicio) return 'fora_prazo';
  return 'ok';
}

function _aplicarEstadoBtnFicha(btn, estado) {
  if (!btn) return;
  btn.disabled = estado !== 'ok';
  btn.dataset.estadoFicha = estado;
  if (estado === 'enviada') {
    btn.textContent = 'Ficha já enviada';
  } else if (estado === 'fora_prazo') {
    btn.textContent = 'Prazo encerrado';
  } else {
    btn.textContent = 'Enviar Ficha';
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
    btn.textContent = 'Disponível ao fim do tratamento';
  } else {
    btn.textContent = 'Liberar Pesquisa';
  }
  btn.style.opacity = '';
  btn.style.cursor = '';
  btn.style.fontSize = '';
}

function _estadoBtnLiberar(r) {
  if (_pesquisasLiberadas.has(r.id)) return 'liberada';
  const now = Date.now();
  const fim = new Date(`${r.data}T${r.hora_fim}:00`).getTime();
  if (now < fim) return 'antes_fim';
  if (now > fim + 30 * 60 * 1000) return 'fora_prazo';
  return 'ok';
}

async function liberarPesquisaReserva(id) {
  const btn = document.getElementById('resdet-liberar');
  if (btn?.dataset.estado === 'fora_prazo' || btn?.dataset.estado === 'liberada' || btn?.dataset.estado === 'antes_fim') return;
  if (btn) { btn.disabled = true; btn.textContent = 'Liberando…'; }
  try {
    const res = await api(`/api/reservas/${id}/liberar-pesquisa`, { method: 'POST', body: '{}' });
    if (!res) { _aplicarEstadoLiberada(btn, false); return; }
    const d = await res.json();
    if (!d.ok) { alert('Erro ao liberar pesquisa: ' + (d.error || '')); _aplicarEstadoLiberada(btn, false); return; }
    _pesquisasLiberadas.add(id);
    _aplicarEstadoLiberada(btn, true);

    // Reserva CASAL: mostra modal com os 2 links de pesquisa, um por hospede.
    if (d.casal) {
      _modalLinksCasal({
        titulo: 'Pesquisa liberada — 2 links (casal)',
        descricao: 'Cada hóspede recebe seu próprio link de pesquisa. Envie um para cada pessoa.',
        h1: d.hospede1, h2: d.hospede2,
        msgFn: (nome, url) => `Olá, *${nome || 'hóspede'}*! 🌿\n\nObrigado pelo seu tratamento no *Gran SPA by L'Occitane*. Sua opinião é muito importante — leva menos de 1 minuto:\n\n👉 ${url}\n\n*Hotel Gran Marquise*`,
      });
    } else {
      showToast('✓ Pesquisa liberada — o botão já apareceu na tela do hóspede');
    }
  } catch {
    _aplicarEstadoLiberada(btn, false);
  }
}

// Modal generico de 2 links para reservas casal. Compartilhado por
// liberarPesquisaReserva e o fluxo de Gerar Ficha (anamnese).
function _modalLinksCasal({ titulo, descricao, h1, h2, msgFn }) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.72);backdrop-filter:blur(2px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  const card = ({ idx, h }) => {
    const tRaw = (h.telefone || '').replace(/\D/g, '');
    const tPhone = tRaw.startsWith('55') ? tRaw : '55' + tRaw;
    const msg = msgFn(h.nome, h.url);
    return `
      <div style="border:1px solid var(--border);border-radius:8px;padding:.9rem 1rem;margin-bottom:.7rem">
        <div style="font-weight:600;margin-bottom:.4rem">Hóspede ${idx}: ${escHtml(h.nome || '(sem nome)')}</div>
        <div style="font-size:.78rem;color:var(--muted);word-break:break-all;background:var(--bg);padding:.4rem .6rem;border-radius:4px;margin-bottom:.55rem">${escHtml(h.url)}</div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
          ${tRaw ? `<button class="btn btn-gold btn-sm" data-zap="${tPhone}" data-msg="${escHtml(msg)}">📱 WhatsApp</button>` : ''}
          <button class="btn btn-outline btn-sm" data-copy="${escHtml(h.url)}">📋 Copiar link</button>
        </div>
      </div>
    `;
  };
  ov.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;max-width:520px;width:100%;padding:1.5rem 1.7rem;box-shadow:0 12px 40px rgba(0,0,0,.4)">
      <h3 style="margin:0 0 .8rem 0;font-family:'Cormorant Garamond',Georgia,serif;font-size:1.4rem">${escHtml(titulo)}</h3>
      <p style="color:var(--muted);font-size:.85rem;margin-bottom:1.1rem;line-height:1.5">${escHtml(descricao)}</p>
      ${card({ idx: 1, h: h1 })}
      ${card({ idx: 2, h: h2 })}
      <div style="display:flex;justify-content:flex-end;margin-top:.8rem">
        <button class="btn btn-outline" data-act="close">Fechar</button>
      </div>
    </div>
  `;
  ov.addEventListener('click', e => {
    if (e.target === ov || e.target.dataset.act === 'close') ov.remove();
    else if (e.target.dataset.zap) {
      window.open(`https://wa.me/${e.target.dataset.zap}?text=${encodeURIComponent(e.target.dataset.msg)}`, '_blank');
    } else if (e.target.dataset.copy) {
      try { navigator.clipboard.writeText(e.target.dataset.copy); showToast('Link copiado!'); } catch {}
    }
  });
  document.body.appendChild(ov);
}

function enviarPreMassagemReserva() {
  if (!_resDetAtual) return;
  const estado = _estadoBtnFicha(_resDetAtual);
  if (estado !== 'ok') return;
  _langSelected = 'pt-BR';
  const grid = document.getElementById('lang-grid');
  grid.innerHTML = LANGS_PRE.map(l => `
    <div class="lang-card${l.code === _langSelected ? ' selected' : ''}" data-action="sel-lang" data-lang="${l.code}">
      <span class="lang-card-flag">${l.flag}</span>
      <span class="lang-card-name">${l.name}</span>
      <span class="lang-card-code">${l.code}</span>
    </div>
  `).join('');
  document.getElementById('lang-overlay').style.display = 'flex';
}

// ── Event delegation ──
function setupDelegation() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'open-drawer')   { openDrawer(+el.dataset.id); }
    else if (action === 'ver-hist') { showHistoricoMassagista(+el.dataset.id, el.dataset.nome); }
    else if (action === 'edit-mass'){ openEditMassagista(+el.dataset.id, el.dataset.nome, +el.dataset.ativo); }
    else if (action === 'edit-tipo') {
      const { id, nome, dur, preco, ativo, desc } = el.dataset;
      openEditTipo(+id, nome, dur ? +dur : null, preco ? +preco : null, +ativo, desc);
    }
    else if (action === 'cal-day')     { calSelectDay(el.dataset.ds); }
    else if (action === 'cal-ver')     { calVerDetalhes(+el.dataset.id); }
    else if (action === 'cal-cancelar'){ e.stopPropagation(); calCancelar(+el.dataset.id); }
    else if (action === 'cal-open')    { calOpenModal(+el.dataset.sala, el.dataset.ds, el.dataset.hora); }
    else if (action === 'page')        { goPage(+el.dataset.off); }
    else if (action === 'hc-page')     { loadHistoricoClientes(+el.dataset.p); }
    else if (action === 'edit-user')         { editarUsuario(+el.dataset.id); }
    else if (action === 'del-user')          { deletarUsuario(+el.dataset.id, el.dataset.nome); }
    else if (action === 'liberar-pesquisa')  { liberarPesquisaReserva(+el.dataset.id); }
    else if (action === 'enviar-pre-massagem'){ enviarPreMassagemReserva(); }
    else if (action === 'sel-lang') {
      _langSelected = el.dataset.lang;
      document.querySelectorAll('.lang-card').forEach(c => c.classList.toggle('selected', c.dataset.lang === _langSelected));
    }
  });
}

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
document.getElementById('btn-back-massagistas').addEventListener('click', () => showView('view-main'));
document.getElementById('btn-back-historico').addEventListener('click', () => showView('view-massagistas'));

document.getElementById('btn-open-escala').addEventListener('click', () => { showView('view-escala'); loadEscala(); });
document.getElementById('btn-back-escala').addEventListener('click', () => showView('view-main'));

document.getElementById('btn-open-tipos').addEventListener('click', () => { showView('view-tipos'); loadTipos(); });
document.getElementById('btn-back-tipos').addEventListener('click', () => showView('view-main'));

// Botão "Início" no header — atalho direto pra view-main, fica visível só em subpáginas
document.getElementById('btn-header-home')?.addEventListener('click', () => { showView('view-reservas'); loadReservas(); });

// "Resetar & Demo" foi removido. Para popular dados de teste, use os
// scripts em /scripts ou as telas de cadastro convencionais.

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
  let res, d;
  try {
    res = await api('/api/massagistas');
    if (!res) return;
    d = await res.json();
  } catch {
    document.getElementById('list-massagistas').innerHTML = '<div class="mgmt-empty">Erro ao carregar profissionais.</div>';
    return;
  }
  _massagistas = d.items || [];
  renderMassagistas();
  if (document.getElementById('view-escala')?.style.display !== 'none') renderEscala(_massagistas);
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
      ? `<span class="mgmt-item-stat">${tot} ${tot !== 1 ? 'avaliações' : 'avaliação'}${pctRec != null ? ` · ${pctRec}% recomendam` : ''}</span>`
      : `<span class="mgmt-item-stat sem-aval">Sem avaliações</span>`;
    const badges = [];
    if (m.funcao) badges.push(`<span class="mgmt-badge mgmt-badge-funcao">${escHtml(m.funcao)}</span>`);
    if (m.matricula) badges.push(`<span class="mgmt-badge mgmt-badge-mat">Mat. ${escHtml(m.matricula)}</span>`);
    if (m.vinculo) badges.push(`<span class="mgmt-badge mgmt-badge-vinculo">${escHtml(m.vinculo)}</span>`);
    if (m.bilingue) badges.push(`<span class="mgmt-badge mgmt-badge-bilingue">Bilíngue</span>`);
    return `
      <div class="mgmt-item${m.ativo ? '' : ' mgmt-item-inativo'}">
        <div class="mgmt-item-info">
          <span class="mgmt-item-nome">${escHtml(m.nome)}</span>
          ${badges.length ? `<div class="mgmt-item-badges">${badges.join('')}</div>` : ''}
          ${m.especialidade_original ? `<span class="mgmt-item-esp">${escHtml(m.especialidade_original)}</span>` : ''}
          ${statHtml}
        </div>
        <button class="btn btn-outline btn-sm" data-action="ver-hist" data-id="${m.id}" data-nome="${escHtml(m.nome)}">Ver histórico</button>
        <button class="btn btn-outline btn-sm" data-action="edit-mass" data-id="${m.id}" data-nome="${escHtml(m.nome)}" data-ativo="${m.ativo?1:0}">Editar</button>
      </div>`;
  }).join('') + '</div>';
}

function toggleFormMassagista(show) {
  const wrap = document.getElementById('form-massagista-wrap');
  wrap.style.display = show ? 'block' : 'none';
  if (show) document.getElementById('inp-m-nome').focus();
  else {
    document.getElementById('inp-m-nome').value = '';
    document.getElementById('inp-m-cargo').value = '';
    document.getElementById('inp-m-matricula').value = '';
    document.getElementById('inp-m-vinculo').value = '';
    document.getElementById('inp-m-bilingue').checked = false;
    document.getElementById('err-massagista').textContent = '';
  }
}

document.getElementById('btn-toggle-form-massagista').addEventListener('click', () => {
  const open = document.getElementById('form-massagista-wrap').style.display !== 'none';
  toggleFormMassagista(!open);
});

document.getElementById('btn-cancel-form-massagista').addEventListener('click', () => toggleFormMassagista(false));

document.getElementById('btn-add-massagista').addEventListener('click', async () => {
  const nome = document.getElementById('inp-m-nome').value.trim();
  const funcao = document.getElementById('inp-m-cargo').value.trim();
  const matricula = document.getElementById('inp-m-matricula').value.trim();
  const vinculo = document.getElementById('inp-m-vinculo').value || null;
  const bilingue = document.getElementById('inp-m-bilingue').checked;
  const err = document.getElementById('err-massagista');
  err.textContent = '';
  if (!nome) { err.textContent = 'Informe o nome.'; return; }
  if (!funcao) { err.textContent = 'Informe o cargo.'; return; }
  if (!matricula) { err.textContent = 'Informe a matrícula.'; return; }
  const res = await api('/api/massagistas', { method: 'POST', body: JSON.stringify({ nome, funcao, matricula, vinculo, bilingue }) });
  if (!res) return;
  const d = await res.json();
  if (!d.ok) { err.textContent = d.error; return; }
  toggleFormMassagista(false);
  loadMassagistas();
});

const DISP_DAYS = [
  { key: 'seg', label: 'Segunda' },
  { key: 'ter', label: 'Terça'   },
  { key: 'qua', label: 'Quarta'  },
  { key: 'qui', label: 'Quinta'  },
  { key: 'sex', label: 'Sexta'   },
  { key: 'sab', label: 'Sábado'  },
  { key: 'dom', label: 'Domingo' },
];

function _renderDispGrid(disp) {
  const grid = document.getElementById('mgmt-m-disp-grid');
  if (!grid) return;
  grid.innerHTML = DISP_DAYS.map(({ key, label }) => {
    const faixa = disp?.[key] || '';
    const [ini, fim] = faixa ? faixa.split('-') : ['08:00', '17:00'];
    const on = !!faixa;
    return `<div class="disp-row" data-day="${key}">
      <input type="checkbox" class="disp-chk" data-day="${key}" ${on ? 'checked' : ''}>
      <span class="disp-row-label">${label}</span>
      <div class="disp-row-times">
        <input type="time" class="disp-ini" data-day="${key}" value="${ini || '08:00'}" min="08:00" max="22:00" ${on ? '' : 'disabled'}>
        <span class="disp-row-sep">–</span>
        <input type="time" class="disp-fim" data-day="${key}" value="${fim || '17:00'}" min="08:00" max="22:00" ${on ? '' : 'disabled'}>
      </div>
      ${!on ? '<span class="disp-row-off">Não trabalha</span>' : ''}
    </div>`;
  }).join('');
  grid.querySelectorAll('.disp-chk').forEach(chk => {
    chk.addEventListener('change', function() {
      const row = this.closest('.disp-row');
      row.querySelectorAll('input[type=time]').forEach(t => { t.disabled = !this.checked; });
      let off = row.querySelector('.disp-row-off');
      if (!this.checked) {
        if (!off) { off = document.createElement('span'); off.className = 'disp-row-off'; off.textContent = 'Não trabalha'; row.appendChild(off); }
      } else if (off) off.remove();
    });
  });
}

function _coletarDisp() {
  const grid = document.getElementById('mgmt-m-disp-grid');
  if (!grid) return null;
  const disp = {};
  const DAY_LABELS = { seg:'Segunda',ter:'Terça',qua:'Quarta',qui:'Quinta',sex:'Sexta',sab:'Sábado',dom:'Domingo' };
  for (const row of grid.querySelectorAll('.disp-row')) {
    const day = row.dataset.day;
    if (!row.querySelector('.disp-chk').checked) continue;
    const ini = row.querySelector('.disp-ini').value || '08:00';
    const fim = row.querySelector('.disp-fim').value || '17:00';
    const iniMin = _hmToMin(ini), fimMin = _hmToMin(fim);
    if (iniMin < 8 * 60) return { erro: `${DAY_LABELS[day]}: início não pode ser antes das 08:00.` };
    if (fimMin > 22 * 60) return { erro: `${DAY_LABELS[day]}: fim não pode ser depois das 22:00.` };
    if (fimMin <= iniMin) return { erro: `${DAY_LABELS[day]}: horário de fim deve ser após o início.` };
    disp[day] = `${ini}-${fim}`;
  }
  return disp;
}

window.openEditMassagista = (id, nome, ativo) => {
  _editMId = id;
  document.getElementById('mgmt-m-sub').textContent = nome;
  document.getElementById('mgmt-m-nome').value = nome;
  const chk = document.getElementById('mgmt-m-ativo');
  chk.checked = !!ativo;
  document.getElementById('mgmt-m-ativo-txt').textContent = ativo ? 'Ativa' : 'Inativa';
  document.getElementById('mgmt-m-err').textContent = '';
  const m = _massagistas.find(x => x.id === id);
  document.getElementById('mgmt-m-cargo').value = m?.funcao || '';
  document.getElementById('mgmt-m-vinculo').value = m?.vinculo || '';
  document.getElementById('mgmt-m-bilingue').checked = !!m?.bilingue;
  const disp = m?.disponibilidade ? (typeof m.disponibilidade === 'string' ? JSON.parse(m.disponibilidade) : m.disponibilidade) : null;
  _renderDispGrid(disp);
  _modalOpen = true;
  document.getElementById('mgmt-m-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('mgmt-m-nome').focus(), 50);
};

document.getElementById('mgmt-m-ativo').addEventListener('change', function() {
  document.getElementById('mgmt-m-ativo-txt').textContent = this.checked ? 'Ativa' : 'Inativa';
});
function closeMgmtM() { _modalOpen = false; document.getElementById('mgmt-m-overlay').style.display = 'none'; _editMId = null; }
document.getElementById('mgmt-m-x').addEventListener('click', closeMgmtM);
document.getElementById('mgmt-m-cancelar').addEventListener('click', closeMgmtM);
document.getElementById('mgmt-m-salvar').addEventListener('click', async () => {
  const err = document.getElementById('mgmt-m-err');
  err.textContent = '';
  const nome = document.getElementById('mgmt-m-nome').value.trim();
  if (!nome) { err.textContent = 'Informe o nome.'; return; }
  const funcao = document.getElementById('mgmt-m-cargo').value.trim() || null;
  const vinculo = document.getElementById('mgmt-m-vinculo').value || null;
  const bilingue = document.getElementById('mgmt-m-bilingue').checked;
  const ativo = document.getElementById('mgmt-m-ativo').checked ? 1 : 0;
  const btn = document.getElementById('mgmt-m-salvar');
  btn.disabled = true;
  try {
    const disponibilidade = _coletarDisp();
    if (disponibilidade?.erro) { err.textContent = disponibilidade.erro; btn.disabled = false; return; }
    const res = await api(`/api/massagistas/${_editMId}`, { method: 'PUT', body: JSON.stringify({ nome, ativo, funcao, vinculo, bilingue, disponibilidade }) });
    if (!res) return;
    const d = await res.json();
    if (!d.ok) { err.textContent = d.error || 'Erro ao salvar.'; return; }
    _massagistasModal = [];
    closeMgmtM(); loadMassagistas();
  } finally { btn.disabled = false; }
});

// ── Escala de Trabalho ──
async function loadEscala() {
  let res, d;
  try {
    res = await api('/api/massagistas');
    if (!res) return;
    d = await res.json();
  } catch {
    document.getElementById('escala-table-wrap').innerHTML = '<div class="mgmt-empty">Erro ao carregar escala.</div>';
    return;
  }
  _massagistas = d.items || [];
  renderEscala(_massagistas);
}

function renderEscala(massagistas) {
  const wrap = document.getElementById('escala-table-wrap');
  if (!wrap) return;
  const ativas = massagistas.filter(m => m.ativo);
  if (!ativas.length) { wrap.innerHTML = '<div class="mgmt-empty">Nenhuma massoterapeuta ativa.</div>'; return; }
  const _faixa = (m, day) => {
    if (!m.disponibilidade) return null;
    const disp = typeof m.disponibilidade === 'string' ? JSON.parse(m.disponibilidade) : m.disponibilidade;
    return disp[day] || null;
  };
  const _cellHtml = (faixa) => faixa
    ? `<span class="escala-td-on">${faixa.replace('-', ' – ')}</span>`
    : `<span class="escala-td-off">—</span>`;
  wrap.innerHTML = `
    <table class="escala-table">
      <thead>
        <tr>
          <th>Profissional</th>
          <th>Seg</th><th>Ter</th><th>Qua</th><th>Qui</th><th>Sex</th><th>Sab</th><th>Dom</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${ativas.map(m => `
          <tr>
            <td title="${escHtml(m.nome)}">${escHtml(m.nome)}</td>
            ${['seg','ter','qua','qui','sex','sab','dom'].map(d => `<td>${_cellHtml(_faixa(m, d))}</td>`).join('')}
            <td><button class="btn btn-outline btn-sm" style="white-space:nowrap" data-action="edit-mass-escala" data-id="${m.id}">Editar</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  wrap.querySelectorAll('[data-action="edit-mass-escala"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = _massagistas.find(x => x.id === +btn.dataset.id);
      if (m) openEditMassagista(m.id, m.nome, m.ativo);
    });
  });
}

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
      <button class="btn btn-outline btn-sm" data-action="edit-tipo" data-id="${t.id}" data-nome="${escHtml(t.nome)}" data-dur="${t.duracao_min||''}" data-preco="${t.preco||''}" data-ativo="${t.ativo?1:0}" data-desc="${escHtml(t.descricao||'')}">Editar</button>
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
  _modalOpen = true;
  document.getElementById('mgmt-t-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('mgmt-t-nome').focus(), 50);
};

document.getElementById('mgmt-t-ativo').addEventListener('change', function() {
  document.getElementById('mgmt-t-ativo-txt').textContent = this.checked ? 'Ativo' : 'Inativo';
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
    const res = await api(`/api/tipos-massagem/${_editTId}`, { method: 'PUT', body: JSON.stringify({ nome, descricao, duracao_min, preco: preco_val, ativo }) });
    if (!res) return;
    const d = await res.json();
    if (!d.ok) { err.textContent = d.error || 'Erro ao salvar.'; return; }
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
  const massObj = _massagistas.find(m => m.id === id);
  const ehBilingue = !!(massObj?.bilingue);
  const avgs = items.map(r => avgRowMass(r, ehBilingue)).filter(v => v !== null).map(Number);
  const mediaGeral = avgs.length ? (avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(2) : null;
  const recSim = items.filter(r => r.recomenda === 'sim').length;
  const pctRec = total > 0 ? (recSim / total * 100).toFixed(0) : null;
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
    `<div class="q-row"><div class="q-label-row"><div class="q-label">${label}</div>${renderMediaBadge(avgCampo(items, campo))}</div>${renderDistBar(computeDist(campo))}</div>`
  ).join('');
  const instalacoesHtml = HIST_INSTALACOES.map(({ campo, label }) =>
    `<div class="q-row"><div class="q-label-row"><div class="q-label">${label}</div>${renderMediaBadge(avgCampo(items, campo))}</div>${renderDistBar(computeDist(campo))}</div>`
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
            <th>Data</th><th>Cliente</th><th>Idioma</th><th>Tratamento</th>
            <th>Expectativa</th><th>Atitude</th><th>Técnica</th>
            <th>Média</th><th>Recomenda</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${items.map(r => {
            const avg = avgRowMass(r, ehBilingue);
            const idiomaOk = ehBilingue || ehIdiomaPortugues(r.idioma_detectado);
            const idiomaBadge = r.idioma_detectado && !ehIdiomaPortugues(r.idioma_detectado)
              ? `<span class="badge" style="background:var(--warn-dim,#FEF3CD);color:var(--warn,#C49A2D);font-size:.68rem" title="Explicação excluída da média">${r.idioma_detectado.toUpperCase()}</span>`
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
};

// ── Reservas de Salas ────────────────────────────────────────

const CAL_ROOMS = [
  { id: 1, nome: 'Sala 1', tipo: 'Individual', cap: 1, cls: 's1' },
  { id: 2, nome: 'Sala 2', tipo: 'Individual', cap: 1, cls: 's2' },
  { id: 3, nome: 'Casal',  tipo: 'Casal',      cap: 2, cls: 's3' },
];
const CAL_H_START = 8;
const CAL_H_END   = 22;
const CAL_SLOT_PX = 76;
const MESES_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

let _reservas  = [];
let _resSala       = null;
let _resTipo       = null;
let _resHoraInicio = null;
let _resHoraFim    = null;
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
    const q = inp.value.trim().toLowerCase();
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
  const apto2El = document.getElementById('res2-fg-apto');
  if (apto2El) {
    apto2El.style.display = isHospede ? '' : 'none';
    const nome2Fg = apto2El.previousElementSibling;
    if (nome2Fg) nome2Fg.style.gridColumn = isHospede ? '' : '1 / -1';
    if (!isHospede) document.getElementById('res2-inp-apto').value = '';
  }
  // Mostra/esconde campo Quarto2 conforme tipo de cliente
  const quarto2El = document.getElementById('res2-fg-quarto');
  if (quarto2El) {
    quarto2El.style.display = isHospede ? '' : 'none';
    if (!isHospede) document.getElementById('res2-inp-quarto').value = '';
  }
}
document.querySelectorAll('[data-tipo2]').forEach(btn => btn.addEventListener('click', () => calSetTipo2(btn.dataset.tipo2)));

function _isCasal() { return _resSala === 3; }

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
  let lista = _massagistasModal.filter(m => _massagistaTrabalhaNoHorario(m, data, horaInicio, _resHoraFim));
  // Exclui a massagista já selecionada para pessoa 1
  if (mass1Id) lista = lista.filter(m => String(m.id) !== String(mass1Id));
  if (!lista.length) {
    list.innerHTML = '<div class="res-cb-opt cb-empty">Nenhuma massoterapeuta disponível</div>';
    return;
  }
  list.innerHTML = lista.map(m => {
    const suffix = m.vinculo ? ` · ${m.vinculo}` : '';
    return `<div class="res-cb-opt" data-val="${m.id}" data-label="${escHtml(m.nome)}">${escHtml(m.nome)}${suffix}${m.bilingue ? ' 🌍' : ''}</div>`;
  }).join('');
  if (prevId && !lista.find(m => String(m.id) === String(prevId))) {
    if (hid) hid.value = '';
    if (inp) inp.value = '';
    if (clr) clr.style.display = 'none';
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

function _hmToMin(s) {
  if (!s) return NaN;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function _massagistaTrabalhaNoHorario(m, data, horaInicio, horaFim) {
  if (!m.disponibilidade) return true;
  const disp = typeof m.disponibilidade === 'string' ? JSON.parse(m.disponibilidade) : m.disponibilidade;
  if (!data) return true;
  const DOW_KEYS = ['dom','seg','ter','qua','qui','sex','sab'];
  const dow = DOW_KEYS[new Date(data + 'T12:00:00').getDay()];
  const faixa = disp[dow];
  if (!faixa) return false;
  if (!horaInicio) return true;
  const parts = faixa.split('-');
  if (parts.length !== 2) return true;
  const escIni = _hmToMin(parts[0].trim());
  const escFim = _hmToMin(parts[1].trim());
  const resIni = _hmToMin(horaInicio);
  const resFim = horaFim ? _hmToMin(horaFim) : null;
  return resIni >= escIni && (resFim === null || resFim <= escFim);
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
  let lista = apenasBilingue ? _massagistasModal.filter(m => m.bilingue) : _massagistasModal;
  lista = lista.filter(m => _massagistaTrabalhaNoHorario(m, data, horaInicio, _resHoraFim));
  if (!lista.length) {
    list.innerHTML = `<div class="res-cb-opt cb-empty">${apenasBilingue ? 'Nenhuma bilíngue na escala deste horário' : 'Nenhuma massoterapeuta na escala deste horário'}</div>`;
    return;
  }
  list.innerHTML = lista.map(m => {
    const suffix = m.vinculo ? ` · ${m.vinculo}` : '';
    return `<div class="res-cb-opt" data-val="${m.id}" data-label="${escHtml(m.nome)}">${escHtml(m.nome)}${suffix}${m.bilingue ? ' 🌍' : ''}</div>`;
  }).join('');
  // Se seleção anterior saiu da lista, limpa
  if (prevId && !lista.find(m => String(m.id) === String(prevId))) {
    if (hid) hid.value = '';
    if (inp) { inp.value = ''; }
    if (clr) clr.style.display = 'none';
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

const TAXA_SERVICO = 0.15;

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
};

function renderCalDia() {
  if(!_calDiaSel)return;
  const ds=calDateStr(_calDiaSel);
  const dayRes=_reservas.filter(r=>r.data===ds);

  const MAX_SLOTS = Math.round(((CAL_H_END - CAL_H_START) * 60) / 30);
  document.getElementById('cal-rooms-header').innerHTML=
    `<div class="cal-time-col-head"><span class="cal-time-col-head-lbl">hora</span></div>`+
    CAL_ROOMS.map(room=>{
      const occ=dayRes.filter(r=>r.sala===room.id).length;
      const pct=Math.min(100, Math.round((occ/Math.max(1,Math.floor((CAL_H_END-CAL_H_START)*60/90)))*100));
      return `<div class="cal-room-col-head ${room.cls}">
        <div class="cal-room-col-name ${room.cls}">${room.nome}</div>
        <div class="cal-room-col-sub">${room.tipo} · ${room.cap} pessoa${room.cap>1?'s':''}</div>
        <div class="cal-room-occ">
          <div class="cal-room-occ-bar"><div class="cal-room-occ-fill" style="width:${pct}%"></div></div>
          <span class="cal-room-occ-lbl">${occ} reserva${occ!==1?'s':''}</span>
        </div>
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
      if(res){
        const rs=calTimeMin(res.hora_inicio), re=calTimeMin(res.hora_fim);
        const isFirst=rs>=slotS&&rs<slotE;
        if(isFirst){
          const topPx=((rs-slotS)/SLOT_MIN)*CAL_SLOT_PX+2;
          const ht=((re-rs)/SLOT_MIN)*CAL_SLOT_PX-4;
          const ehGC = res.quarto_categoria === 'gran_class';
          html+=`<div class="cal-slot occupied${halfClass}" style="overflow:visible;position:relative">
            <div class="cal-res-block ${room.cls}${ehGC ? ' is-gran-class' : ''}" style="position:absolute;left:0;right:4px;top:${topPx}px;height:${ht}px${ehGC ? ';box-shadow:inset 0 0 0 2px #d4a64a' : ''}" data-action="cal-ver" data-id="${res.id}" title="${escHtml(res.cliente)}${res.tratamento?' · '+escHtml(res.tratamento):''} · ${res.hora_inicio}–${res.hora_fim}${ehGC ? ' · GRAN CLASS' : ''}">
              <div class="cal-res-name">${ehGC ? '★ ' : ''}${escHtml(res.cliente)}${res.cliente2 ? ` & ${escHtml(res.cliente2)}` : ''}</div>
              ${res.tratamento?`<div class="cal-res-trat">${escHtml(res.tratamento)}${res.tratamento2?' / '+escHtml(res.tratamento2):''}</div>`:''}
              <div class="cal-res-time">${res.hora_inicio} – ${res.hora_fim}${res.quarto ? ` · qto ${escHtml(res.quarto)}` : ''}</div>
              ${res.massagista_nome?`<div class="cal-res-by">${escHtml(res.massagista_nome)}${res.massagista_nome2?' & '+escHtml(res.massagista_nome2):''}</div>`:''}
              <div class="cal-res-by">por ${res.criado_por ? escHtml(res.criado_por) : '—'}</div>
              <button class="cal-res-cancel" data-action="cal-cancelar" data-id="${res.id}" title="Cancelar reserva">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>`;
        } else {
          html+=`<div class="cal-slot occupied-cont${halfClass}"></div>`;
        }
      } else {
        html+=`<div class="cal-slot${halfClass}" data-action="cal-open" data-sala="${room.id}" data-ds="${ds}" data-hora="${timeStr}"></div>`;
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

window.calCancelar=async(id)=>{
  const ok = await confirmarAcao({
    titulo: 'Cancelar reserva?',
    mensagem: 'Esta ação remove a reserva da agenda. Não é possível desfazer.',
    btnConfirmar: 'Sim, cancelar',
    btnCancelar: 'Voltar',
    perigoso: true,
  });
  if (!ok) return;
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
    const cor = perigoso ? 'var(--danger,#b85a4a)' : 'var(--gold,#bf9a55)';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" style="background:var(--surface);border:1px solid var(--border);border-radius:10px;max-width:440px;width:100%;padding:1.4rem 1.6rem;box-shadow:0 12px 40px rgba(0,0,0,.4)">
        <h3 style="margin:0 0 .5rem 0;font-family:'Cormorant Garamond',Georgia,serif;font-size:1.4rem;font-weight:500;color:${cor}">${escHtml(titulo)}</h3>
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
      if (e.target === overlay) close(false);
      else if (e.target.dataset.act === 'ok') close(true);
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
  document.querySelectorAll('.res-tipo-btn').forEach(b => b.classList.toggle('active', b.dataset.tipo === tipo));
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
}

function calOpenModal(salaId, data, hora) {
  _resSala=salaId||1;
  _resTipo=null;
  _modalOpen = true;
  document.getElementById('res-modal-overlay').style.display='flex';
  document.getElementById('res-modal-err').textContent='';
  document.querySelectorAll('.res-tipo-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('res-fg-apto').style.display='none';
  const _nomeFg = document.getElementById('res-fg-nome');
  if (_nomeFg) _nomeFg.style.gridColumn = '1 / -1';
  ['res-inp-nome','res-inp-apto','res-inp-email','res-inp-tel','res-inp-cpf'].forEach(id=>{
    const el = document.getElementById(id); if (el) el.value='';
  });
  const _cpfInfo = document.getElementById('res-cpf-info');
  if (_cpfInfo) { _cpfInfo.style.display = 'none'; _cpfInfo.textContent = ''; }
  if (_cbTrat)  _cbTrat.clear();
  if (_cbMass)  _cbMass.clear();
  if (_cbTrat2) _cbTrat2.clear();
  if (_cbMass2) _cbMass2.clear();
  _resTipo2 = null;
  document.querySelectorAll('[data-tipo2]').forEach(b => b.classList.remove('active'));
  document.getElementById('res2-fg-apto').style.display = 'none';
  const _nome2Fg = document.getElementById('res2-fg-apto')?.previousElementSibling;
  if (_nome2Fg) _nome2Fg.style.gridColumn = '1 / -1';
  ['res2-inp-cpf','res2-inp-nome','res2-inp-apto','res2-inp-quarto','res2-inp-email','res2-inp-tel'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const _cpf2Info = document.getElementById('res2-cpf-info');
  if (_cpf2Info) { _cpf2Info.style.display = 'none'; _cpf2Info.textContent = ''; }
  const _quarto2Info = document.getElementById('res2-quarto-info');
  if (_quarto2Info) { _quarto2Info.style.display = 'none'; _quarto2Info.textContent = ''; }
  const _quarto2Fg = document.getElementById('res2-fg-quarto');
  if (_quarto2Fg) _quarto2Fg.style.display = 'none';
  const sec2 = document.getElementById('res-sec-pessoa2');
  if (sec2) sec2.style.display = _isCasal() ? '' : 'none';
  const _sep1 = document.getElementById('res-sep-pessoa1');
  if (_sep1) _sep1.style.display = _isCasal() ? '' : 'none';
  const _wrap1 = document.getElementById('res-pessoa1-wrap');
  if (_wrap1) _wrap1.classList.toggle('casal-ativo', _isCasal());
  _resHoraInicio = hora || '09:00';
  _resHoraFim = null;
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
  loadTratamentosModal();
  loadMassagistasModal();
  const flt = document.getElementById('res-flt-bilingue');
  if (flt) flt.checked = false;
  // CPF é o primeiro campo: foca para que, se já cadastrado, o autofill rode.
  setTimeout(()=>document.getElementById('res-inp-cpf')?.focus(),50);
}
window.calOpenModal=calOpenModal;

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
  host.innerHTML = opts.map(o => `
    <button type="button" class="btn btn-outline btn-sm" data-atalho-data="${o.val}" style="font-size:.72rem;padding:.25rem .6rem">${escHtml(o.label)}</button>
  `).join('') + `<span style="font-size:.72rem;color:var(--muted);padding:.3rem 0 0 .3rem">ou clique no campo acima para escolher outra data</span>`;
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

// Recalcula hora_fim sempre que hora_inicio ou tratamento mudam
function calAtualizarHoraFim() {
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
    tempoEl.innerHTML = `<span style="color:var(--danger);font-weight:600">⚠ ${inicio} fora do horário do spa (08:00–22:00)</span>`;
    stripEl.style.borderColor = 'var(--danger)';
    stripEl.style.background = 'var(--danger-dim)';
    return;
  }

  _resHoraInicio = inicio;
  if (!trat.value || !dur) {
    _resHoraFim = null;
    tempoEl.textContent = trat.value ? `${inicio} (tratamento sem duração)` : `início ${inicio} · selecione um tratamento`;
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
    return;
  }

  _resHoraFim = calMinTime(fimMin);
  tempoEl.innerHTML = `${inicio} – ${_resHoraFim} <span style="color:var(--muted);font-weight:400;margin-left:.4rem">· tratamento ${dur} min</span>`;
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

  // Preço: subtotal + taxa 15% + total
  if (t.preco) {
    const sub = Number(t.preco);
    const taxa = sub * TAXA_SERVICO;
    const total = sub + taxa;
    const fmt = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    html += `<div class="res-preco-box">
      <div class="res-preco-row"><span>Subtotal</span><span>R$ ${fmt(sub)}</span></div>
      <div class="res-preco-row"><span>Taxa de serviço (15%)</span><span>R$ ${fmt(taxa)}</span></div>
      <div class="res-preco-row total"><span>Total</span><span>R$ ${fmt(total)}</span></div>
    </div>`;
  }

  wrap.innerHTML = html;
}

// Detecta conflito local (sala ou profissional)
function calDetectarConflito(sala, massagistaId, data, horaInicio, horaFim, excluirId) {
  // Sala primeiro
  const conflitoSala = _reservas.find(r =>
    r.sala === sala &&
    r.data === data &&
    r.id !== excluirId &&
    !(r.hora_fim <= horaInicio || r.hora_inicio >= horaFim)
  );
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

function _precoDetHtml(r) {
  const tm = _tratamentos.find(t => t.id === r.tipo_massagem_id || t.nome === r.tratamento);
  let out = '';
  if (tm?.tipo === 'combo' && tm.componentes_nomes?.length) {
    out += `<div class="resdet-kv"><div class="resdet-kv-label">Inclusos</div><div class="resdet-kv-val">${tm.componentes_nomes.map(n => `<span style="display:inline-block;background:var(--gold-dim);color:var(--gold-dark);padding:.12rem .5rem;border-radius:999px;font-size:.75rem;font-weight:500;margin:.1rem .2rem .1rem 0">${n}</span>`).join('')}</div></div>`;
  }
  if (tm?.preco) {
    const sub = Number(tm.preco);
    const taxa = sub * 0.15;
    const total = sub + taxa;
    const fmt = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    out += `<div style="border-top:1px dashed var(--border);margin-top:.5rem;padding-top:.6rem">`;
    out += `<div class="resdet-kv"><div class="resdet-kv-label">Subtotal</div><div class="resdet-kv-val mono">R$ ${fmt(sub)}</div></div>`;
    out += `<div class="resdet-kv"><div class="resdet-kv-label">Taxa serviço 15%</div><div class="resdet-kv-val mono">R$ ${fmt(taxa)}</div></div>`;
    out += `<div class="resdet-kv" style="border-bottom:none"><div class="resdet-kv-label" style="font-weight:700;color:var(--text)">Total</div><div class="resdet-kv-val mono gold" style="font-size:1rem">R$ ${fmt(total)}</div></div>`;
    out += `</div>`;
  }
  return out;
}

function _precoDetHtml2(r) {
  const tm = _tratamentos.find(t => t.id === r.tipo_massagem_id2 || t.nome === r.tratamento2);
  let out = '';
  if (tm?.preco) {
    const sub = Number(tm.preco);
    const taxa = sub * 0.15;
    const total = sub + taxa;
    const fmt = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    out += `<div style="border-top:1px dashed var(--border);margin-top:.5rem;padding-top:.6rem">`;
    out += `<div class="resdet-kv"><div class="resdet-kv-label">Subtotal</div><div class="resdet-kv-val mono">R$ ${fmt(sub)}</div></div>`;
    out += `<div class="resdet-kv"><div class="resdet-kv-label">Taxa serviço 15%</div><div class="resdet-kv-val mono">R$ ${fmt(taxa)}</div></div>`;
    out += `<div class="resdet-kv" style="border-bottom:none"><div class="resdet-kv-label" style="font-weight:700;color:var(--text)">Total</div><div class="resdet-kv-val mono gold" style="font-size:1rem">R$ ${fmt(total)}</div></div>`;
    out += `</div>`;
  }
  return out;
}

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

document.getElementById('res-inp-hora-inicio').addEventListener('input', calAtualizarHoraFim);
document.getElementById('res-inp-hora-inicio').addEventListener('change', calAtualizarHoraFim);
document.getElementById('res-inp-hora-inicio').addEventListener('change', () => { _renderMassagistasModal(); _renderMassagistasModal2(); });
document.getElementById('res-inp-data')?.addEventListener('change', () => { _renderMassagistasModal(); _renderMassagistasModal2(); });
document.getElementById('res-flt-bilingue')?.addEventListener('change', () => { _renderMassagistasModal(); _renderMassagistasModal2(); });
document.getElementById('res-inp-massagista').addEventListener('change', _renderMassagistasModal2);
document.getElementById('res-inp-tratamento2').addEventListener('change', calAtualizarHoraFim);

// Modal de detalhes da reserva
function calVerDetalhes(id) {
  const r = _reservas.find(x => x.id === id);
  if (!r) return;
  _resDetAtual = r;
  const btnLib = document.getElementById('resdet-liberar');
  if (btnLib) { btnLib.dataset.id = r.id; _aplicarEstadoLiberada(btnLib, _estadoBtnLiberar(r)); }
  const btnFicha = document.getElementById('resdet-ficha');
  if (btnFicha) { btnFicha.dataset.id = r.id; _aplicarEstadoBtnFicha(btnFicha, _estadoBtnFicha(r)); }
  const sala = CAL_ROOMS.find(s => s.id === r.sala);
  const salaName = sala ? sala.nome : `Sala ${r.sala}`;
  const salaCls = sala ? sala.cls : 's1';
  const salaTipo = sala ? `${sala.tipo} · ${sala.cap} pessoa${sala.cap>1?'s':''}` : '';
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
  document.getElementById('resdet-body').innerHTML = `
    <div class="resdet-hero">
      <div>
        <div class="resdet-hero-time">${r.hora_inicio}</div>
        <div class="resdet-hero-sub">início</div>
      </div>
      <div class="resdet-hero-mid">
        <div class="resdet-hero-dash"></div>
        <div class="resdet-hero-dur">${dur} min</div>
      </div>
      <div class="resdet-hero-right">
        <div class="resdet-hero-time">${r.hora_fim}</div>
        <div class="resdet-hero-sub" style="text-align:right">${calFmtData(r.data)}</div>
      </div>
    </div>

    ${isCasal ? `<div style="display:flex;align-items:center;gap:.6rem;margin:.75rem 0 .5rem"><div style="height:1px;flex:1;background:var(--border)"></div><span style="font-size:.7rem;letter-spacing:.1em;color:var(--gold);font-weight:600;text-transform:uppercase;white-space:nowrap">Pessoa 1</span><div style="height:1px;flex:1;background:var(--border)"></div></div>` : ''}

    <div class="resdet-grid">
      <div class="resdet-card">
        <div class="resdet-card-title">${isCasal ? 'Pessoa 1' : 'Cliente'}</div>
        <div class="resdet-client-hd">
          <div class="resdet-avatar">${_iniciais(r.cliente)}</div>
          <div>
            <div class="resdet-client-name">${escHtml(r.cliente || '—')}</div>
            <div class="resdet-client-sub">
              <span class="resdet-pill-tipo ${tipoCliCls}">${tipoCli}</span>
              ${r.apto ? `<span>· Apto ${escHtml(r.apto)}</span>` : ''}
            </div>
          </div>
        </div>
        ${r.email ? `<div class="resdet-kv"><div class="resdet-kv-label">E-mail</div><div class="resdet-kv-val">${escHtml(r.email)}</div></div>` : ''}
        ${r.telefone ? `<div class="resdet-kv"><div class="resdet-kv-label">Telefone</div><div class="resdet-kv-val mono">${escHtml(r.telefone)}</div></div>` : ''}
        ${!r.email && !r.telefone ? `<div class="resdet-kv"><div class="resdet-kv-val empty">Sem contato informado</div></div>` : ''}
        <div class="resdet-kv"><div class="resdet-kv-label">Registrado por</div><div class="resdet-kv-val">${r.criado_por ? escHtml(r.criado_por) : '—'}</div></div>
      </div>

      <div class="resdet-card">
        <div class="resdet-card-title">Tratamento${isCasal ? ' 1' : ''}</div>
        <div class="resdet-tratamento-name">${r.tratamento ? escHtml(r.tratamento) : '<span style="font-style:italic;color:var(--muted);font-family:var(--font);font-size:.9rem">não informado</span>'}</div>
        ${r.linha ? `<div class="resdet-kv"><div class="resdet-kv-label">Linha</div><div class="resdet-kv-val">${escHtml(r.linha)}</div></div>` : ''}
        <div class="resdet-kv"><div class="resdet-kv-label">Profissional</div>${_massagistaDetHtml(r)}</div>
        <div class="resdet-kv"><div class="resdet-kv-label">Duração</div><div class="resdet-kv-val mono">${dur} min</div></div>
        ${_precoDetHtml(r)}
      </div>
    </div>

    ${isCasal ? `
    <div style="display:flex;align-items:center;gap:.6rem;margin:.75rem 0 .5rem"><div style="height:1px;flex:1;background:var(--border)"></div><span style="font-size:.7rem;letter-spacing:.1em;color:var(--gold);font-weight:600;text-transform:uppercase;white-space:nowrap">Pessoa 2</span><div style="height:1px;flex:1;background:var(--border)"></div></div>
    <div class="resdet-grid">
      <div class="resdet-card">
        <div class="resdet-card-title">Pessoa 2</div>
        <div class="resdet-client-hd">
          <div class="resdet-avatar">${_iniciais(r.cliente2)}</div>
          <div>
            <div class="resdet-client-name">${escHtml(r.cliente2 || '—')}</div>
            <div class="resdet-client-sub">
              <span class="resdet-pill-tipo ${r.tipo_cliente2 === 'hospede' ? 'hospede' : 'passante'}">${r.tipo_cliente2 === 'hospede' ? 'Hóspede' : 'Passante'}</span>
              ${r.apto2 ? `<span>· Apto ${escHtml(r.apto2)}</span>` : ''}
            </div>
          </div>
        </div>
        ${r.email2 ? `<div class="resdet-kv"><div class="resdet-kv-label">E-mail</div><div class="resdet-kv-val">${escHtml(r.email2)}</div></div>` : ''}
        ${r.telefone2 ? `<div class="resdet-kv"><div class="resdet-kv-label">Telefone</div><div class="resdet-kv-val mono">${escHtml(r.telefone2)}</div></div>` : ''}
        ${!r.email2 && !r.telefone2 ? `<div class="resdet-kv"><div class="resdet-kv-val empty">Sem contato informado</div></div>` : ''}
      </div>
      <div class="resdet-card">
        <div class="resdet-card-title">Tratamento 2</div>
        <div class="resdet-tratamento-name">${r.tratamento2 ? escHtml(r.tratamento2) : '<span style="font-style:italic;color:var(--muted);font-family:var(--font);font-size:.9rem">não informado</span>'}</div>
        <div class="resdet-kv"><div class="resdet-kv-label">Profissional</div>${_massagistaDetHtml2(r)}</div>
        ${_precoDetHtml2(r)}
      </div>
    </div>
    ` : ''}

    <div class="resdet-registro">
      <div class="resdet-registro-item">
        <div class="resdet-registro-label">Reserva</div>
        <div class="resdet-registro-val">#${r.id}</div>
      </div>
      <div class="resdet-registro-item">
        <div class="resdet-registro-label">Criado em</div>
        <div class="resdet-registro-val">${r.criado_em ? fmtDataHoraBR(r.criado_em) : '—'}</div>
      </div>
      <div class="resdet-registro-item">
        <div class="resdet-registro-label">Registrado por</div>
        <div class="resdet-registro-val">${r.criado_por ? escHtml(r.criado_por) : '—'}</div>
      </div>
      <div class="resdet-registro-item">
        <div class="resdet-registro-label">Sala</div>
        <div class="resdet-registro-val">${salaName}</div>
      </div>
    </div>
  `;

  const btnCancel = document.getElementById('resdet-cancelar-res');
  const inicioMs = new Date(`${r.data}T${r.hora_inicio}:00`).getTime();
  const cancelBloqueado = Date.now() > inicioMs + 30 * 60 * 1000;
  btnCancel.disabled = cancelBloqueado;
  btnCancel.textContent = cancelBloqueado ? 'Cancelamento expirado' : 'Cancelar Reserva';
  btnCancel.title = cancelBloqueado ? 'Só é possível cancelar até 30 min após o início' : '';
  btnCancel.style.opacity = '';
  btnCancel.style.cursor = '';
  btnCancel.onclick = cancelBloqueado ? null : () => {
    document.getElementById('resdet-overlay').style.display = 'none';
    calCancelar(r.id);
  };
  _modalOpen = true;
  document.getElementById('resdet-overlay').style.display = 'flex';
}
window.calVerDetalhes = calVerDetalhes;

document.getElementById('resdet-x').addEventListener('click', () => { _modalOpen = false; document.getElementById('resdet-overlay').style.display = 'none'; });
document.getElementById('resdet-fechar').addEventListener('click', () => { _modalOpen = false; document.getElementById('resdet-overlay').style.display = 'none'; });

// Modal idioma pré-massagem
const _closeLangOverlay = () => { document.getElementById('lang-overlay').style.display = 'none'; };
document.getElementById('lang-x').addEventListener('click', _closeLangOverlay);
document.getElementById('lang-cancelar').addEventListener('click', _closeLangOverlay);
document.getElementById('lang-confirmar').addEventListener('click', async () => {
  const r = _resDetAtual;
  if (!r) return;
  const btn = document.getElementById('lang-confirmar');
  btn.disabled = true; btn.textContent = 'Gerando…';
  try {
    const res = await api(`/api/reservas/${r.id}/gerar-ficha`, { method: 'POST', body: '{}' });
    if (!res) return;
    const d = await res.json();
    if (!d.ok) { alert('Erro ao gerar ficha: ' + (d.error || '')); return; }

    const baseMsg = (nome, url) =>
      `Olá, *${nome || 'hóspede'}*! 😊\n\nPara prepararmos sua experiência no *Gran SPA by L'Occitane*, pedimos que preencha a ficha de saúde antes do seu tratamento:\n\n👉 ${url}\n\n*Hotel Gran Marquise* 🌿`;

    _fichasEnviadas.add(r.id);
    _closeLangOverlay();
    const btnFicha = document.getElementById('resdet-ficha');
    _aplicarEstadoBtnFicha(btnFicha, 'enviada');

    if (d.casal) {
      // RESERVA CASAL: 2 links distintos, 1 por hospede. Cada um tem seu
      // proprio token amarrado ao slot (cliente1 ou cliente2) — nao
      // sobrescrevem a anamnese um do outro.
      const h1 = d.hospede1, h2 = d.hospede2;
      const url1 = `${h1.url}&lang=${_langSelected}`;
      const url2 = `${h2.url}&lang=${_langSelected}`;
      const msg1 = baseMsg(h1.nome, url1);
      const msg2 = baseMsg(h2.nome, url2);
      // Modal simples: 2 botoes WhatsApp + 2 copiar
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.72);backdrop-filter:blur(2px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
      ov.innerHTML = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;max-width:520px;width:100%;padding:1.5rem 1.7rem;box-shadow:0 12px 40px rgba(0,0,0,.4)">
          <h3 style="margin:0 0 .8rem 0;font-family:'Cormorant Garamond',Georgia,serif;font-size:1.4rem">Reserva CASAL — 2 links</h3>
          <p style="color:var(--muted);font-size:.85rem;margin-bottom:1.1rem;line-height:1.5">Cada hóspede tem seu próprio link de anamnese. Envie um para cada pessoa.</p>
          ${[
            { idx: 1, h: h1, url: url1, msg: msg1, tel: h1.telefone },
            { idx: 2, h: h2, url: url2, msg: msg2, tel: h2.telefone },
          ].map(({ idx, h, url, msg, tel }) => {
            const tRaw = (tel || '').replace(/\\D/g, '');
            const tPhone = tRaw.startsWith('55') ? tRaw : '55' + tRaw;
            return `
              <div style="border:1px solid var(--border);border-radius:8px;padding:.9rem 1rem;margin-bottom:.7rem">
                <div style="font-weight:600;margin-bottom:.4rem">Hóspede ${idx}: ${escHtml(h.nome || '(sem nome)')}</div>
                <div style="font-size:.78rem;color:var(--muted);word-break:break-all;background:var(--bg);padding:.4rem .6rem;border-radius:4px;margin-bottom:.55rem">${escHtml(url)}</div>
                <div style="display:flex;gap:.4rem;flex-wrap:wrap">
                  ${tRaw ? `<button class="btn btn-gold btn-sm" data-zap="${tPhone}" data-msg="${escHtml(msg)}">📱 WhatsApp</button>` : ''}
                  <button class="btn btn-outline btn-sm" data-copy="${escHtml(url)}">📋 Copiar link</button>
                </div>
              </div>
            `;
          }).join('')}
          <div style="display:flex;justify-content:flex-end;margin-top:.8rem">
            <button class="btn btn-outline" data-act="close">Fechar</button>
          </div>
        </div>
      `;
      ov.addEventListener('click', e => {
        if (e.target === ov || e.target.dataset.act === 'close') ov.remove();
        else if (e.target.dataset.zap) {
          window.open(`https://wa.me/${e.target.dataset.zap}?text=${encodeURIComponent(e.target.dataset.msg)}`, '_blank');
        } else if (e.target.dataset.copy) {
          try { navigator.clipboard.writeText(e.target.dataset.copy); showToast('Link copiado!'); } catch {}
        }
      });
      document.body.appendChild(ov);
    } else {
      // RESERVA INDIVIDUAL: 1 link
      const url = `${d.baseUrl}?t=${d.token}&lang=${_langSelected}`;
      const raw = (r.telefone || '').replace(/\D/g, '');
      const phone = raw.startsWith('55') ? raw : '55' + raw;
      const msg = baseMsg(r.cliente, url);
      if (raw) {
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
      } else {
        try { navigator.clipboard.writeText(url); } catch {}
        showToast(`Link copiado! ${url}`);
      }
    }
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar via WhatsApp';
  }
});

function calCloseModal(){
  _modalOpen = false;
  document.getElementById('res-modal-overlay').style.display='none';
  _resSala=null;
}

document.getElementById('btn-nova-reserva').addEventListener('click',()=>calOpenModal(1,_calDiaSel?calDateStr(_calDiaSel):null,'09:00'));
document.getElementById('btn-res-x').addEventListener('click',calCloseModal);
document.getElementById('btn-res-cancelar').addEventListener('click',calCloseModal);

document.querySelectorAll('.res-room-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    _resSala=+btn.dataset.sala;
    document.querySelectorAll('.res-room-btn').forEach(b=>b.classList.toggle('active',b===btn));
    const sec2 = document.getElementById('res-sec-pessoa2');
    if (sec2) sec2.style.display = _isCasal() ? '' : 'none';
    const sep1 = document.getElementById('res-sep-pessoa1');
    if (sep1) sep1.style.display = _isCasal() ? '' : 'none';
    const wrap1 = document.getElementById('res-pessoa1-wrap');
    if (wrap1) wrap1.classList.toggle('casal-ativo', _isCasal());
  });
});

document.querySelectorAll('.res-tipo-btn').forEach(btn=>{
  btn.addEventListener('click',()=>calSetTipo(btn.dataset.tipo));
});

document.getElementById('res-inp-tratamento').addEventListener('change', calAtualizarHoraFim);

document.getElementById('btn-res-salvar').addEventListener('click',async()=>{
  const err=document.getElementById('res-modal-err');
  err.textContent='';
  const sala=_resSala;
  const tipo=_resTipo;
  const cpfInpVal = (document.getElementById('res-inp-cpf')?.value || '').replace(/\D/g, '');
  const nome=document.getElementById('res-inp-nome').value.trim();
  const apto=document.getElementById('res-inp-apto').value.trim();
  const email=document.getElementById('res-inp-email').value.trim();
  const telefone=document.getElementById('res-inp-tel').value.trim();
  const tratamento=document.getElementById('res-inp-tratamento').value.trim();
  const data=document.getElementById('res-inp-data').value;
  const horaInicio=document.getElementById('res-inp-hora-inicio').value;
  if(!sala){err.textContent='Selecione uma sala.';return;}
  if(!cpfInpVal){err.textContent='Informe o CPF do cliente (obrigatório).';document.getElementById('res-inp-cpf')?.focus();return;}
  if(!validarCpfMod11(cpfInpVal)){err.textContent='CPF inválido.';document.getElementById('res-inp-cpf')?.focus();return;}
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
  if(!tratamento){err.textContent='Selecione o tratamento.';return;}
  if(!_resHoraFim){
    err.textContent='Horário inválido: o tratamento ultrapassaria o expediente do spa (fecha às 22:00).';
    return;
  }
  if(!data){err.textContent='Informe a data.';return;}
  // Bloqueia agendamento no passado. Comparação em hora de Fortaleza.
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

  // Massoterapeuta obrigatória
  const massagistaId = document.getElementById('res-inp-massagista')?.value ? +document.getElementById('res-inp-massagista').value : null;
  if (!massagistaId) { err.textContent = 'Selecione a massoterapeuta que vai atender.'; return; }

  // Casal: campos pessoa 2 — TODOS OPCIONAIS. Se NADA estiver preenchido,
  // pessoa 2 e' ignorada (sala 3 pode ser usada por uma pessoa so).
  // Se ALGUM campo for preenchido, valida o restante coerentemente.
  let cpf2 = null, nome2 = null, tipo2 = null, apto2 = null, quarto2 = null, email2 = null, tel2 = null;
  let tratamento2 = null, tratObj2 = null, massagistaId2 = null, _p2Preenchida = false;
  if (_isCasal()) {
    const cpf2InpVal = (document.getElementById('res2-inp-cpf')?.value || '').replace(/\D/g, '');
    nome2       = document.getElementById('res2-inp-nome')?.value.trim() || '';
    tipo2       = _resTipo2;
    apto2       = document.getElementById('res2-inp-apto')?.value.trim() || null;
    const quarto2Raw = (document.getElementById('res2-inp-quarto')?.value || '').trim();
    quarto2     = quarto2Raw ? _normNumQuarto(quarto2Raw) : null;
    email2      = document.getElementById('res2-inp-email')?.value.trim() || null;
    tel2        = document.getElementById('res2-inp-tel')?.value.trim() || null;
    tratamento2 = document.getElementById('res-inp-tratamento2')?.value.trim() || '';
    tratObj2    = _tratamentos.find(t => t.nome === tratamento2) || null;
    massagistaId2 = document.getElementById('res-inp-massagista2')?.value ? +document.getElementById('res-inp-massagista2').value : null;
    _p2Preenchida = !!(cpf2InpVal || nome2 || email2 || tel2 || tratamento2 || massagistaId2 || quarto2);
    if (_p2Preenchida) {
      // Pessoa 2 preenchida → exige coerencia
      if (!cpf2InpVal) { err.textContent = 'Pessoa 2: informe o CPF (autopreenche se ja cadastrado).'; document.getElementById('res2-inp-cpf')?.focus(); return; }
      if (!validarCpfMod11(cpf2InpVal)) { err.textContent = 'Pessoa 2: CPF invalido.'; document.getElementById('res2-inp-cpf')?.focus(); return; }
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
  const conflitoLocal = calDetectarConflito(sala, massagistaId, data, horaInicio, _resHoraFim);
  if (conflitoLocal) { calMostrarConflito(conflitoLocal); return; }
  if (_p2Preenchida && massagistaId2) {
    const c2 = calDetectarConflito(sala, massagistaId2, data, horaInicio, _resHoraFim, null);
    if (c2 && c2.tipo === 'massagista') { calMostrarConflito(c2); return; }
  }

  const btn=document.getElementById('btn-res-salvar');
  btn.disabled=true;
  try{
    // cpfInpVal já validado mais acima (obrigatório + módulo-11)
    const body = {
      sala, tipo_cliente: tipo, cliente: nome, apto, email, telefone, tratamento, data,
      hora_inicio: horaInicio, hora_fim: _resHoraFim,
      linha, tipo_massagem_id: tipoMassagemId, massagista_id: massagistaId,
      cpf: cpfInpVal,
      quarto: quartoInp || null,
    };
    if (_isCasal() && _p2Preenchida) {
      Object.assign(body, {
        cliente2: nome2, tipo_cliente2: tipo2 || null, apto2, email2, telefone2: tel2,
        tratamento2, tipo_massagem_id2: tratObj2?.id || null, massagista_id2: massagistaId2,
        cpf2, quarto2,
      });
    }
    const res=await api('/api/reservas',{method:'POST',body:JSON.stringify(body)});
    if(!res)return;
    const d=await res.json();
    if(!d.ok){
      // Conflito detectado pelo servidor
      if (res.status === 409 && d.conflito) {
        calMostrarConflito({ tipo: d.tipo, reserva: { ...d.conflito, data, sala, massagista_id: massagistaId } });
        await loadReservas();
        return;
      }
      if (res.status === 409) {
        await loadReservas();
        const c = calDetectarConflito(sala, massagistaId, data, horaInicio, _resHoraFim);
        if (c) { calMostrarConflito(c); return; }
      }
      err.textContent = d.error || 'Erro ao salvar.';
      return;
    }
    calCloseModal();
    loadReservas();
  }finally{btn.disabled=false;}
});

document.getElementById('btn-week-prev').addEventListener('click',()=>{_calWeekOffset--;_calDiaSel=null;loadReservas();});
document.getElementById('btn-week-next').addEventListener('click',()=>{_calWeekOffset++;_calDiaSel=null;loadReservas();});
document.getElementById('btn-week-hoje').addEventListener('click',()=>{_calWeekOffset=0;_calDiaSel=null;loadReservas();});

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
// btn-open-relatorio-mensal foi removido da dropdown — agora é a sub-aba
// "Visão Mensal" dentro de Relatórios (renderTabsRelatorios).
document.getElementById('btn-back-relatorio-mensal')?.addEventListener('click', () => showView('view-main'));
document.getElementById('btn-open-qualidade')?.addEventListener('click', () => { showView('view-qualidade'); loadQualidade(); });
document.getElementById('btn-back-qualidade')?.addEventListener('click', () => showView('view-main'));
document.getElementById('btn-ql-atualizar')?.addEventListener('click', () => loadQualidade());

// ── Abas Qualidade ─────────────────────────────────────────────────────────
document.querySelectorAll('.ql-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ql-tab').forEach(b => {
      b.classList.remove('is-active');
      b.style.borderBottomColor = 'transparent';
      b.style.color = 'var(--muted)';
    });
    btn.classList.add('is-active');
    btn.style.borderBottomColor = 'var(--accent)';
    btn.style.color = '';
    btn.style.fontWeight = '600';
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
    if (m.atingido === true)  badge = '<span style="color:var(--success);font-weight:600">✓ Atingida</span>';
    else if (m.atingido === false) badge = '<span style="color:var(--danger);font-weight:600">✗ Abaixo</span>';
    else                            badge = '<span style="color:var(--muted)">—</span>';
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
        <td><code style="font-size:.78rem">${escHtml(p.slug)}</code></td>
        <td>${escHtml(p.titulo)}</td>
        <td><span class="badge">${escHtml(p.app_escopo)}</span></td>
        <td style="text-align:center">v${p.versao}</td>
        <td style="text-align:center">${p.publicada_em ? '<span style="color:var(--success)">●</span>' : '<span style="color:var(--muted)">○</span>'}</td>
        <td style="text-align:center">${p.ativo ? 'Sim' : 'Não'}</td>
        <td style="text-align:right;white-space:nowrap">
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
    if (!confirm('Despublicar esta pesquisa? Apps que a consomem deixarão de recebê-la.')) return;
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
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
      <h3 style="margin:0">Editar pesquisa: <code>${escHtml(p.slug)}</code> v${p.versao}</h3>
      <button class="btn btn-outline btn-sm" id="qp-ed-close">Fechar</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin-bottom:1rem">
      <label style="display:flex;flex-direction:column;font-size:.8rem;color:var(--muted)">Título
        <input id="qp-ed-titulo" value="${escHtml(p.titulo || '')}" style="padding:.5rem;border:1px solid var(--border);background:var(--bg)">
      </label>
      <label style="display:flex;flex-direction:column;font-size:.8rem;color:var(--muted)">App escopo
        <input id="qp-ed-app" value="${escHtml(p.app_escopo || 'spa')}" style="padding:.5rem;border:1px solid var(--border);background:var(--bg)">
      </label>
      <label style="grid-column:span 2;display:flex;flex-direction:column;font-size:.8rem;color:var(--muted)">Descrição
        <textarea id="qp-ed-desc" rows="2" style="padding:.5rem;border:1px solid var(--border);background:var(--bg)">${escHtml(p.descricao || '')}</textarea>
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
  if (!cfg) {
    wrap.innerHTML = `
      <div class="empty">Esta pesquisa não está publicada ainda — publique-a para visualizar as seções e perguntas associadas.</div>
      <div style="margin-top:.8rem;display:flex;gap:.5rem">
        <input id="qp-novasecao-chave" placeholder="chave da seção" style="padding:.4rem;border:1px solid var(--border);background:var(--bg)">
        <input id="qp-novasecao-titulo" placeholder="título pt-BR" style="padding:.4rem;border:1px solid var(--border);background:var(--bg);flex:1">
        <button class="btn btn-outline btn-sm" id="qp-novasecao-add">+ Seção</button>
      </div>
    `;
  } else {
    wrap.innerHTML = `
      <h4 style="margin:0 0 .6rem 0">Seções e perguntas</h4>
      ${cfg.secoes.map(s => `
        <div style="border:1px solid var(--border);padding:.8rem;margin-bottom:.6rem;border-radius:6px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem">
            <strong>${escHtml(s.titulo)}</strong>
            <span style="color:var(--muted);font-size:.78rem">ordem ${s.ordem} · ${s.perguntas.length} pergunta(s)</span>
          </div>
          ${s.perguntas.length ? `
            <table style="width:100%;font-size:.85rem">
              <thead><tr><th style="text-align:left">Pergunta</th><th style="text-align:center">Tipo</th><th style="text-align:center">Obrig.</th></tr></thead>
              <tbody>
                ${s.perguntas.map(q => `
                  <tr>
                    <td>${escHtml(q.rotulo)} <code style="color:var(--muted);font-size:.72rem">${escHtml(q.chave)}</code></td>
                    <td style="text-align:center">${escHtml(q.tipo)}</td>
                    <td style="text-align:center">${q.obrigatoria ? '●' : '○'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div style="color:var(--muted);font-size:.85rem">Sem perguntas associadas.</div>'}
        </div>
      `).join('')}
      <div style="margin-top:.8rem;display:flex;gap:.5rem">
        <input id="qp-novasecao-chave" placeholder="chave da seção" style="padding:.4rem;border:1px solid var(--border);background:var(--bg)">
        <input id="qp-novasecao-titulo" placeholder="título pt-BR" style="padding:.4rem;border:1px solid var(--border);background:var(--bg);flex:1">
        <button class="btn btn-outline btn-sm" id="qp-novasecao-add">+ Seção</button>
      </div>
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
    <h4 style="margin:0 0 .6rem 0">Metas configuradas</h4>
    <div style="font-size:.85rem">
      <strong>Por questionário:</strong>
      ${mq.length ? '<ul style="margin:.3rem 0 .6rem 1rem">' + mq.map(m => `<li>${escHtml(m.tipo_meta)} ≥ ${m.valor_alvo}</li>`).join('') + '</ul>' : '<span style="color:var(--muted)"> nenhuma</span>'}
      <strong>Por pergunta:</strong>
      ${mp.length ? '<ul style="margin:.3rem 0 .6rem 1rem">' + mp.map(m => `<li><code style="font-size:.78rem">${escHtml(m.chave)}</code> — ${escHtml(m.tipo_meta)} ≥ ${m.valor_alvo}</li>`).join('') + '</ul>' : '<span style="color:var(--muted)"> nenhuma</span>'}
    </div>
    <div style="margin-top:.8rem;display:flex;gap:.4rem;align-items:end;flex-wrap:wrap">
      <label style="font-size:.78rem;color:var(--muted)">Meta de % recomenda
        <input id="qp-meta-reco" type="number" min="0" max="100" step="1" placeholder="90" style="display:block;padding:.4rem;border:1px solid var(--border);background:var(--bg);width:90px">
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
            <td><code style="font-size:.78rem">${escHtml(p.chave)}</code><div style="color:var(--muted);font-size:.72rem">${escHtml(p.rotulo || '')}</div></td>
            <td>${escHtml(p.tipo)}</td>
            <td>${escHtml(p.escala_chave || '—')}</td>
            <td style="text-align:center">${p.ativo ? '●' : '○'}</td>
          </tr>
        `).join('');
      }
    }
    if (re) {
      const de = await re.json();
      if (de.ok) {
        document.getElementById('qb-esc-list').innerHTML = de.items.map(e => `
          <tr>
            <td><code style="font-size:.78rem">${escHtml(e.chave)}</code></td>
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

// ── Relatorio Mensal (Fase 2): KPIs do mes + cruzamento sessao x pesquisa ──
function _ymAtualFortaleza() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
async function loadRelatorioMensal() {
  const ymInput = document.getElementById('rm-ym');
  if (ymInput && !ymInput.value) ymInput.value = _ymAtualFortaleza();
  const ym = ymInput?.value || _ymAtualFortaleza();
  // KPIs do mes
  try {
    const r = await api(`/api/relatorios/mensal?ym=${encodeURIComponent(ym)}`);
    if (r) {
      const d = await r.json();
      if (d.ok) {
        document.getElementById('rm-kpi-sessoes').textContent = d.sessoes;
        document.getElementById('rm-kpi-respondidas').textContent = d.respondidas;
        document.getElementById('rm-kpi-taxa').textContent = (d.taxa || 0) + '%';
        document.getElementById('rm-kpi-pendentes').textContent = d.pendentes + ' pendentes';
      }
    }
  } catch {}
  // Default do filtro: mes selecionado por inteiro
  const [yy, mm] = ym.split('-').map(Number);
  const fromEl = document.getElementById('rm-from');
  const toEl   = document.getElementById('rm-to');
  if (fromEl && !fromEl.value) fromEl.value = `${ym}-01`;
  if (toEl && !toEl.value)     toEl.value = new Date(yy, mm, 0).toISOString().slice(0, 10);
  await loadCruzamento();
}
async function loadCruzamento() {
  const from   = document.getElementById('rm-from')?.value || '';
  const to     = document.getElementById('rm-to')?.value || '';
  const status = document.getElementById('rm-status')?.value || 'todos';
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to)   params.set('to', to);
  params.set('status', status);
  let d;
  try {
    const r = await api(`/api/relatorios/cruzamento?${params}`);
    if (!r) return;
    d = await r.json();
  } catch { return; }
  if (!d.ok) return;
  const body  = document.getElementById('rm-body');
  const empty = document.getElementById('rm-empty');
  const count = document.getElementById('rm-count');
  if (count) count.textContent = d.total + (d.total === 1 ? ' sessão' : ' sessões');
  if (!d.items.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  const fmtData = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—';
  body.innerHTML = d.items.map(r => {
    const badge = r.respondeu_pesquisa
      ? '<span style="color:var(--success,#1f7a3d);font-weight:600">✓ respondeu</span>'
      : '<span style="color:var(--danger,#b33);font-weight:600">✗ pendente</span>';
    return `<tr>
      <td>${fmtData(r.data)}</td>
      <td style="font-variant-numeric:tabular-nums">${r.hora_inicio?.slice(0,5) || '—'} – ${r.hora_fim?.slice(0,5) || '—'}</td>
      <td>${escHtml(r.cliente || '—')}<div style="font-size:.72rem;color:var(--muted)">${escHtml(r.email || '')}</div></td>
      <td>${escHtml(r.massagista_nome || '—')}</td>
      <td>${escHtml(r.tratamento || '—')}</td>
      <td style="text-align:center">${badge}</td>
    </tr>`;
  }).join('');
}
document.getElementById('btn-rm-atualizar')?.addEventListener('click', loadRelatorioMensal);
document.getElementById('btn-rm-filtrar')?.addEventListener('click', loadCruzamento);
document.getElementById('btn-rm-limpar')?.addEventListener('click', () => {
  document.getElementById('rm-from').value = '';
  document.getElementById('rm-to').value = '';
  document.getElementById('rm-status').value = 'todos';
  loadCruzamento();
});
document.getElementById('btn-back-reservas').addEventListener('click',()=>showView('view-reservas'));

// Dropdowns SPA e Administrativo
(function setupDropdowns() {
  const allMenus = ['spa-dropdown-menu', 'admin-dropdown-menu'];
  function closeAll() { allMenus.forEach(id => document.getElementById(id).classList.remove('open')); }
  function makeDropdown(toggleId, menuId) {
    const toggle = document.getElementById(toggleId);
    const menu   = document.getElementById(menuId);
    toggle.addEventListener('click', e => {
      e.stopPropagation();
      const wasOpen = menu.classList.contains('open');
      closeAll();
      if (!wasOpen) menu.classList.add('open');
    });
    menu.addEventListener('click', () => menu.classList.remove('open'));
  }
  makeDropdown('btn-spa-toggle', 'spa-dropdown-menu');
  makeDropdown('btn-admin-toggle', 'admin-dropdown-menu');
  document.addEventListener('click', () => {
    document.getElementById('spa-dropdown-menu').classList.remove('open');
    document.getElementById('admin-dropdown-menu').classList.remove('open');
  });
})();

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
document.getElementById('btn-back-usuarios').addEventListener('click',()=>showView('view-main'));

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
  if (!confirm(`Remover usuário "${nome}"?`)) return;
  const r = await api(`/api/auth/usuarios/${id}`, { method:'DELETE' });
  if (!r) return;
  const d = await r.json();
  if (!d.ok) { alert(d.error || 'Erro ao remover.'); return; }
  loadUsuarios();
};

// btn-open-historico-clientes removido — sub-aba "Atendimentos" em Relatórios.
document.getElementById('btn-back-historico-clientes')?.addEventListener('click',()=>showView('view-main'));
document.getElementById('btn-hc-filtrar').addEventListener('click',()=>loadHistoricoClientes());
document.getElementById('btn-hc-limpar').addEventListener('click',()=>{
  document.getElementById('hc-from').value='';
  document.getElementById('hc-to').value='';
  document.getElementById('hc-sala').value='';
  document.getElementById('hc-busca').value='';
  loadHistoricoClientes();
});
document.getElementById('hc-busca').addEventListener('keydown', e=>{ if(e.key==='Enter') loadHistoricoClientes(); });
// Botão "Exportar CSV" removido a pedido. Função exportarHistoricoCSV
// mantida abaixo para uso futuro via console se necessário.

let _hcPage = 0;
const _hcLimit = 50;

const SALA_NOME = { 1: 'Sala 1 · Serenity', 2: 'Sala 2 · Tranquility', 3: 'Sala 3 · Harmony' };
const TIPO_CLIENTE_LABEL = { hospede: 'Hóspede', passante: 'Passante' };

function _hcParams(off=0) {
  const from  = document.getElementById('hc-from').value || '';
  const to    = document.getElementById('hc-to').value || '';
  const sala  = document.getElementById('hc-sala').value || '';
  const busca = document.getElementById('hc-busca').value.trim() || '';
  const p = new URLSearchParams({ limit: _hcLimit, offset: off });
  if (from)  p.set('from',  from);
  if (to)    p.set('to',    to);
  if (sala)  p.set('sala',  sala);
  if (busca) p.set('busca', busca);
  return p.toString();
}

async function loadHistoricoClientes(page=0) {
  _hcPage = page;
  const body   = document.getElementById('hc-body');
  const empty  = document.getElementById('hc-empty');
  const count  = document.getElementById('hc-count');
  const pag    = document.getElementById('hc-pagination');
  body.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--muted)">Carregando…</td></tr>';
  empty.style.display = 'none';
  pag.innerHTML = '';

  const r = await api(`/api/reservas/historico?${_hcParams(page * _hcLimit)}`);
  if (!r) return;
  const d = await r.json();
  if (!d.ok) { body.innerHTML=''; empty.textContent='Erro ao carregar dados.'; empty.style.display='block'; return; }

  const { total, items } = d;
  count.textContent = `${total} atendimento${total !== 1 ? 's' : ''}`;

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
    return `<tr>
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

async function exportarHistoricoCSV() {
  const r = await api(`/api/reservas/historico?${_hcParams(0)}&limit=9999`);
  if (!r) return;
  const d = await r.json();
  if (!d.ok || !d.items.length) return;
  const cols = ['Data','Horário','Cliente','Email','Tipo','Apto','Telefone','Sala','Tratamento','Massoterapeuta','Cadastrado em'];
  const rows = d.items.map(it => [
    it.data,
    `${it.hora_inicio}-${it.hora_fim}`,
    it.cliente,
    it.email||'',
    TIPO_CLIENTE_LABEL[it.tipo_cliente]||it.tipo_cliente||'',
    it.apto||'',
    it.telefone||'',
    SALA_NOME[it.sala]||`Sala ${it.sala}`,
    it.tipo_massagem_nome||it.tratamento||'',
    it.massoterapeuta_nome||'',
    it.criado_em||'',
  ].map(v=>`"${String(v).replace(/"/g,'""')}"`));
  const csv = [cols.join(','), ...rows.map(r=>r.join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'}));
  a.download = `historico-spa-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
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
document.getElementById('btn-back-clientes')?.addEventListener('click', () => showView('view-main'));

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
window.validarCpfMod11 = validarCpfMod11; // exposto para reuso (form de reserva)
window.fmtCpfMask = fmtCpfMask;

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
      style="display:block;width:100%;text-align:left;padding:.6rem .7rem;border:1px solid var(--border);background:${c.id === _cliSelId ? 'var(--surface2)' : 'var(--bg)'};border-radius:6px;cursor:pointer">
      <div style="font-weight:600;font-size:.92rem">${escHtml(c.nome)}</div>
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
        <h2 style="margin:0;font-family:Cormorant Garamond,serif;font-size:1.6rem">${escHtml(c.nome)}</h2>
        ${gran_class ? badgeGranClassHtml('Cliente Gran Class') : ''}
      </div>
      <div style="display:flex;gap:1rem;flex-wrap:wrap;font-size:.85rem;color:var(--muted)">
        ${c.cpf ? `<span>CPF: <strong>${escHtml(fmtCpfMask(c.cpf))}</strong></span>` : ''}
        ${c.email ? `<span>✉ ${escHtml(c.email)}</span>` : ''}
        ${c.telefone ? `<span>☎ ${escHtml(c.telefone)}</span>` : ''}
        ${c.locale_pref ? `<span>🌐 ${escHtml(c.locale_pref)}</span>` : ''}
      </div>
    </div>

    <!-- abas -->
    <div class="cli-tabs" style="display:flex;gap:.4rem;margin-bottom:1rem;border-bottom:1px solid var(--border)">
      <button class="cli-tab is-active" data-t="trat"  style="padding:.5rem .9rem;background:none;border:none;border-bottom:2px solid var(--accent);cursor:pointer;font-weight:600">Tratamentos <span class="badge">${reservas.length}</span></button>
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
    b.classList.add('is-active'); b.style.borderBottomColor = 'var(--accent)'; b.style.color = '';
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
  // Wire up botões dos produtos
  document.getElementById('btn-prod-add')?.addEventListener('click', () => adicionarProduto(c.id));
  det.querySelectorAll('button[data-prod-del]').forEach(b =>
    b.addEventListener('click', async () => {
      if (!confirm('Remover este produto?')) return;
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
    return `<tr${ehGC ? ' style="background:rgba(212,166,74,.06)"' : ''}>
      <td>${escHtml(r.data || '')}</td>
      <td>${escHtml((r.hora_inicio||'') + ' – ' + (r.hora_fim||''))}</td>
      <td style="text-align:center">${r.sala}</td>
      <td>${r.quarto ? escHtml(r.quarto) + (ehGC ? ' ★' : '') : '—'}</td>
      <td>${r.tipo_massagem_id ? '#' + r.tipo_massagem_id : '—'}</td>
      <td>${escHtml(r.cliente || '')}${r.cliente2 ? ' + ' + escHtml(r.cliente2) : ''}</td>
    </tr>`;
  }).join('')}</tbody></table></div>`;
}
function renderClienteAnamneses(as) {
  if (!as.length) return '<div class="empty">Cliente ainda não preencheu anamnese.</div>';
  return `<div style="color:var(--muted);font-size:.78rem;margin-bottom:.5rem">Cada linha é uma anamnese preenchida — pode ter mudado entre visitas. Clique "Ver" para conferir as respostas daquele momento.</div>
  <div class="table-wrap"><table style="font-size:.88rem"><thead>
    <tr><th>Data</th><th>Idioma</th><th>Reserva</th><th>Email</th><th>Telefone</th><th></th></tr>
  </thead><tbody>${as.map(a => `
    <tr>
      <td>${escHtml((a.criado_em || '').slice(0,10))}</td>
      <td>${escHtml(a.idioma || '')}</td>
      <td>${a.reserva_id ? '#' + a.reserva_id : '—'}</td>
      <td>${escHtml(a.email || '')}</td>
      <td>${escHtml(a.telefone || '')}</td>
      <td><button class="btn btn-outline btn-sm" data-act="ver-anamnese" data-id="${a.id}">Ver</button></td>
    </tr>
  `).join('')}</tbody></table></div>`;
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
  </thead><tbody>${ps.map(p => `
    <tr>
      <td>${escHtml((p.submitted_at || '').slice(0,16))}</td>
      <td>${escHtml(_nomeAmigavelPesquisa(p.slug, p.pesquisa_titulo))}</td>
      <td>${p.reserva_id ? '#' + p.reserva_id : '—'}</td>
      <td><button class="btn btn-outline btn-sm" data-act="ver-pesquisa" data-id="${p.id}">Ver</button></td>
    </tr>
  `).join('')}</tbody></table></div>`;
}

// Modal de visualizacao completa de uma anamnese preenchida (spa_perfil)
async function _abrirModalAnamnesePreenchida(perfilId) {
  let dados = null;
  try {
    const r = await api('/api/clientes/anamnese/' + perfilId);
    if (!r) return;
    const d = await r.json();
    if (!d.ok) { showToast('Erro ao carregar anamnese: ' + (d.error || ''), 5000); return; }
    dados = d.anamnese;
  } catch (e) { showToast('Erro: ' + e.message, 5000); return; }

  const a = dados;
  const dt = a.criado_em ? a.criado_em.slice(0, 16) : '';
  const linhaCampo = (label, valor) => `
    <div style="display:flex;gap:.7rem;padding:.45rem 0;border-bottom:1px solid var(--border-lt,#eee);font-size:.88rem">
      <div style="flex:0 0 200px;color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;padding-top:.1rem">${escHtml(label)}</div>
      <div style="flex:1;color:var(--text);line-height:1.5">${valor != null && valor !== '' ? escHtml(String(valor)) : '<em style="color:var(--muted)">— vazio —</em>'}</div>
    </div>`;
  const linhaLista = (label, arr) => {
    const items = (arr || []).filter(Boolean);
    const v = items.length ? items.map(i => `<span class="badge" style="background:var(--gold-lt,#f5ead8);color:var(--text);font-size:.78rem;padding:.15rem .55rem;border-radius:9999px">${escHtml(i)}</span>`).join(' ') : '<em style="color:var(--muted)">— vazio —</em>';
    return `<div style="display:flex;gap:.7rem;padding:.45rem 0;border-bottom:1px solid var(--border-lt,#eee);font-size:.88rem">
      <div style="flex:0 0 200px;color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.04em">${escHtml(label)}</div>
      <div style="flex:1;display:flex;gap:.3rem;flex-wrap:wrap">${v}</div>
    </div>`;
  };
  const linhaBool = (label, b) => `
    <div style="display:flex;gap:.7rem;padding:.45rem 0;border-bottom:1px solid var(--border-lt,#eee);font-size:.88rem">
      <div style="flex:0 0 200px;color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.04em">${escHtml(label)}</div>
      <div style="flex:1">${b ? '<span style="color:var(--success,#3a6b47);font-weight:600">✓ Sim</span>' : '<span style="color:var(--danger,#9e3832);font-weight:600">✗ Não</span>'}</div>
    </div>`;
  const secaoTitulo = t => `<h3 style="margin:1.3rem 0 .5rem 0;font-family:'Cormorant Garamond',serif;font-size:1.2rem;font-weight:500;color:var(--text);border-bottom:1px solid var(--gold,#b8935a);padding-bottom:.3rem">${escHtml(t)}</h3>`;
  const assinaturaHtml = a.assinatura_data_url
    ? `<img src="${a.assinatura_data_url}" alt="assinatura" style="max-width:280px;max-height:120px;border:1px solid var(--border);border-radius:6px;background:#fff;padding:.3rem">`
    : '<em style="color:var(--muted)">— sem assinatura —</em>';

  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.78);backdrop-filter:blur(3px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  ov.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;width:100%;max-width:760px;height:88vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.5);overflow:hidden">
      <header style="display:flex;align-items:center;justify-content:space-between;padding:1.1rem 1.4rem;border-bottom:1px solid var(--border)">
        <div>
          <h2 style="margin:0;font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:1.55rem;color:var(--text)">Anamnese preenchida</h2>
          <p style="margin:.25rem 0 0 0;color:var(--muted);font-size:.78rem">${escHtml(a.nome + ' ' + a.sobrenome)} · ${escHtml(dt)} · idioma ${escHtml(a.idioma || 'pt-BR')}${a.reserva_id ? ' · reserva #' + a.reserva_id : ''}</p>
        </div>
        <button class="btn btn-outline btn-sm" data-act="close" style="font-size:1rem">✕</button>
      </header>
      <div style="flex:1;overflow-y:auto;padding:1rem 1.4rem">
        ${secaoTitulo('1. Dados pessoais')}
        ${linhaCampo('Nome', a.nome)}
        ${linhaCampo('Sobrenome', a.sobrenome)}
        ${linhaCampo('Tipo de documento', a.tipo_documento)}
        ${linhaCampo('Número do documento', a.documento)}
        ${linhaCampo('E-mail', a.email)}
        ${linhaCampo('Telefone', a.telefone)}
        ${linhaCampo('Data de nascimento', a.data_nascimento)}
        ${linhaCampo('Quarto', a.quarto)}

        ${secaoTitulo('2. Rotina facial')}
        ${linhaLista('Itens usados', a.rotina_facial)}

        ${secaoTitulo('3. Rotina corporal')}
        ${linhaLista('Itens usados', a.rotina_corporal)}
        ${linhaCampo('Produto específico', a.produto_especifico)}

        ${secaoTitulo('4. Preferência de massagem')}
        ${linhaCampo('Pressão preferida', a.pressao_massagem)}

        ${secaoTitulo('5. Informações médicas')}
        ${linhaCampo('Info médica relevante', a.info_medica)}

        ${secaoTitulo('6. Consentimentos')}
        ${linhaBool('Apto a realizar tratamento', a.consentimento_saude)}
        ${linhaBool('Marketing autorizado', a.consentimento_marketing)}
        ${linhaLista('Canais autorizados', a.canais_marketing)}

        ${secaoTitulo('7. Assinatura')}
        <div style="padding:.6rem 0">${assinaturaHtml}</div>
      </div>
      <footer style="padding:.7rem 1.4rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end">
        <button class="btn btn-outline" data-act="close">Fechar</button>
      </footer>
    </div>
  `;
  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
  ov.addEventListener('click', e => { if (e.target === ov || e.target.dataset.act === 'close') close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}

// Modal de visualizacao das respostas de uma pesquisa de satisfacao
async function _abrirModalPesquisaRespondida(respostaId) {
  let resp = null, itens = [];
  try {
    const r = await api('/api/clientes/pesquisa/' + respostaId);
    if (!r) return;
    const d = await r.json();
    if (!d.ok) { showToast('Erro ao carregar pesquisa: ' + (d.error || ''), 5000); return; }
    resp = d.resposta; itens = d.itens || [];
  } catch (e) { showToast('Erro: ' + e.message, 5000); return; }

  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.78);backdrop-filter:blur(3px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  ov.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;width:100%;max-width:760px;height:88vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.5);overflow:hidden">
      <header style="display:flex;align-items:center;justify-content:space-between;padding:1.1rem 1.4rem;border-bottom:1px solid var(--border)">
        <div>
          <h2 style="margin:0;font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:1.55rem;color:var(--text)">Pesquisa respondida</h2>
          <p style="margin:.25rem 0 0 0;color:var(--muted);font-size:.78rem">${escHtml(_nomeAmigavelPesquisa(resp.pesquisa_slug, resp.pesquisa_titulo))} · ${escHtml((resp.submitted_at || '').slice(0,16))}${resp.reserva_id ? ' · reserva #' + resp.reserva_id : ''}</p>
        </div>
        <button class="btn btn-outline btn-sm" data-act="close" style="font-size:1rem">✕</button>
      </header>
      <div style="flex:1;overflow-y:auto;padding:1rem 1.4rem">
        ${itens.length === 0
          ? '<div style="padding:2rem;text-align:center;color:var(--muted)">Nenhuma resposta registrada.</div>'
          : itens.map(it => {
              let valor = '';
              if (it.escala_opcao_chave) {
                const cor = (it.valor_numerico >= 7) ? 'var(--success,#3a6b47)' : (it.valor_numerico >= 4 ? 'var(--gold-dark,#8a6b35)' : 'var(--danger,#9e3832)');
                valor = `<span style="background:${cor}1A;color:${cor};border:1px solid ${cor}40;font-size:.82rem;padding:.2rem .65rem;border-radius:9999px;font-weight:600">${escHtml(it.escala_opcao_rotulo || it.escala_opcao_chave)}</span>`;
              } else if (it.valor_texto) {
                valor = `<div style="background:var(--bg);border-left:3px solid var(--gold,#b8935a);padding:.5rem .8rem;font-style:italic;color:var(--text);font-size:.88rem;line-height:1.5">"${escHtml(it.valor_texto)}"</div>`;
              } else if (it.valor_numerico != null) {
                valor = `<strong>${escHtml(String(it.valor_numerico))}</strong>`;
              } else {
                valor = '<em style="color:var(--muted)">— sem resposta —</em>';
              }
              return `<div style="padding:.7rem 0;border-bottom:1px solid var(--border-lt,#eee)">
                <div style="font-size:.78rem;color:var(--muted);margin-bottom:.3rem;text-transform:uppercase;letter-spacing:.04em">${escHtml(it.pergunta_chave)}</div>
                <div style="font-size:.92rem;color:var(--text);margin-bottom:.45rem;line-height:1.4">${escHtml(it.rotulo)}</div>
                <div>${valor}</div>
              </div>`;
            }).join('')
        }
      </div>
      <footer style="padding:.7rem 1.4rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end">
        <button class="btn btn-outline" data-act="close">Fechar</button>
      </footer>
    </div>
  `;
  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
  ov.addEventListener('click', e => { if (e.target === ov || e.target.dataset.act === 'close') close(); });
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

async function adicionarProduto(cliId) {
  const produto_nome = prompt('Nome do produto:');
  if (!produto_nome) return;
  const categoria = prompt('Categoria (opcional):') || '';
  const valorRaw = prompt('Valor R$ (opcional):') || '';
  const valor = valorRaw ? parseFloat(valorRaw.replace(',', '.')) : null;
  const data_compra = prompt('Data da compra (YYYY-MM-DD, opcional):') || '';
  try {
    await apiSend('POST', `/api/clientes/${cliId}/produtos`, { produto_nome, categoria, valor, data_compra });
    showToast('Produto lançado'); selectCliente(cliId);
  } catch (e) { showToast('Erro: ' + e.message, 5000); }
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
  });
})();

// ────────────────────────────────────────────────────────────────────────────
// MÓDULO 3: máscara + autofill do CPF na Nova Reserva.
// Ao digitar 11 dígitos válidos, busca cliente existente e preenche
// nome/email/telefone. Não bloqueia o submit se for cliente novo.
// ────────────────────────────────────────────────────────────────────────────
// Wire generico de CPF (mascara + autofill) — usado por pessoa 1 e pessoa 2
function _wireCpfAutofill({ inpId, infoId, nomeId, emailId, telId }) {
  const inp = document.getElementById(inpId);
  if (!inp) return;
  inp.addEventListener('input', async function () {
    let v = this.value.replace(/\D/g, '').slice(0, 11);
    if (v.length > 9)      v = v.replace(/^(\d{3})(\d{3})(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
    else if (v.length > 6) v = v.replace(/^(\d{3})(\d{3})(\d{1,3})$/, '$1.$2.$3');
    else if (v.length > 3) v = v.replace(/^(\d{3})(\d{1,3})$/, '$1.$2');
    this.value = v;
    const info = document.getElementById(infoId);
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
        set(nomeId,  c.nome);
        set(emailId, c.email);
        set(telId,   c.telefone);
        if (info) { info.style.color = 'var(--success)'; info.textContent = '✓ Cliente já cadastrado — dados preenchidos (editáveis)'; info.style.display = ''; }
      } else {
        if (info) { info.style.color = 'var(--muted)'; info.textContent = 'CPF válido. Cliente novo será criado ao salvar.'; info.style.display = ''; }
      }
    } catch {}
  });
}
_wireCpfAutofill({ inpId: 'res-inp-cpf',  infoId: 'res-cpf-info',  nomeId: 'res-inp-nome',  emailId: 'res-inp-email',  telId: 'res-inp-tel'  });
_wireCpfAutofill({ inpId: 'res2-inp-cpf', infoId: 'res2-cpf-info', nomeId: 'res2-inp-nome', emailId: 'res2-inp-email', telId: 'res2-inp-tel' });

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
document.getElementById('btn-back-auditoria')?.addEventListener('click', () => {
  showView('view-usuarios');
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

const _ANAM_TIPOS = [
  { value: 'texto_livre', label: 'Texto livre' },
  { value: 'unica',       label: 'Escolha única (opções)' },
  { value: 'multipla',    label: 'Múltipla escolha (opções)' },
  { value: 'escala',      label: 'Escala (ex: sim/não, otimo/bom/...)' },
];

document.getElementById('btn-open-anamnese-editor')?.addEventListener('click', () => showView('view-anamnese-editor'));
document.getElementById('btn-back-anamnese-editor')?.addEventListener('click', () => showView('view-main'));
document.getElementById('btn-anam-reload')?.addEventListener('click', () => initAnamneseEditor());

async function initAnamneseEditor() {
  const wrap = document.getElementById('anam-secoes');
  const empty = document.getElementById('anam-empty');
  empty.style.display = 'block';
  empty.textContent = 'Carregando…';
  wrap.innerHTML = '';

  // 1) Descobre o id da pesquisa anamnese (slug fixo)
  try {
    const rL = await api('/api/qualidade/admin/pesquisas');
    if (!rL) return;
    const dL = await rL.json();
    if (!dL.ok) return;
    const p = dL.items
      .filter(x => x.slug === ANAMNESE_SLUG)
      .sort((a,b) => b.versao - a.versao)[0];
    if (!p) {
      empty.textContent = `Pesquisa "${ANAMNESE_SLUG}" não encontrada. Reinicie o servidor para rodar o seed.`;
      return;
    }
    _anamPesquisaId = p.id;
  } catch (e) {
    empty.textContent = 'Erro ao carregar lista de pesquisas: ' + e.message;
    return;
  }

  // 2) Busca a config pública (já agrupa seções + perguntas + opções traduzidas)
  try {
    const rC = await api(`/api/survey/config?slug=${ANAMNESE_SLUG}&idioma=pt-BR`);
    if (!rC) return;
    const dC = await rC.json();
    if (!dC.ok || !dC.pesquisa) {
      // Pesquisa pode estar despublicada — usa endpoint admin para montar estrutura
      empty.textContent = 'Anamnese não publicada. Publique-a em Gestão da Qualidade para editar.';
      return;
    }
    _anamEstrutura = dC.pesquisa;
  } catch (e) {
    empty.textContent = 'Erro ao carregar estrutura: ' + e.message;
    return;
  }

  empty.style.display = 'none';
  _renderAnamEstrutura();
  _renderAnamInativas();
  _renderAnamHistorico();
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
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;width:100%;max-width:760px;height:85vh;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.5);overflow:hidden">
      <header style="display:flex;align-items:center;justify-content:space-between;padding:1.1rem 1.4rem;border-bottom:1px solid var(--border)">
        <div>
          <h2 style="margin:0;font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:1.55rem;color:var(--text)">${escHtml(titulo)}</h2>
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
        <div style="display:flex;gap:.8rem;align-items:flex-start;padding:.85rem 1.4rem;border-bottom:1px solid var(--border-lt,#eee);transition:background .12s" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
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
    if (e.target === ov || e.target.dataset.act === 'close') return close();
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
          <h2 style="margin:0;font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:1.55rem;color:var(--text)">${escHtml(titulo)}</h2>
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
    if (e.target === ov || e.target.dataset.act === 'close') return close();
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

function _renderAnamEstrutura() {
  const wrap = document.getElementById('anam-secoes');
  const e = _anamEstrutura;
  wrap.innerHTML = e.secoes.map(s => `
    <section class="anam-secao" data-secao-id="${s.id}" style="border:1px solid var(--border);border-radius:10px;padding:1.1rem 1.3rem;margin-bottom:1.4rem;background:var(--surface)">
      <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.9rem;flex-wrap:wrap;gap:.6rem">
        <h3 style="margin:0;font-family:'Cormorant Garamond',serif;font-size:1.35rem;color:var(--text)">${escHtml(s.titulo)}</h3>
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-outline btn-sm" data-anam-act="edit-secao" data-secao-id="${s.id}">Renomear seção</button>
          <button class="btn btn-outline btn-sm" data-anam-act="del-secao"  data-secao-id="${s.id}" style="color:var(--danger);border-color:var(--danger)">Remover seção</button>
        </div>
      </header>
      <div class="anam-perguntas">
        ${s.perguntas.map(q => _renderAnamPergunta(q)).join('')}
      </div>
      <div style="margin-top:.9rem;padding-top:.9rem;border-top:1px dashed var(--border)">
        <div style="font-size:.78rem;color:var(--muted);margin-bottom:.4rem">Adicionar pergunta nesta seção:</div>
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <input data-anam-newperg-rotulo data-secao-id="${s.id}" placeholder="Escreva a pergunta em português…" style="padding:.55rem .7rem;border:1px solid var(--border);background:var(--bg);font-size:.92rem;flex:1;min-width:280px;border-radius:4px">
          <select data-anam-newperg-tipo data-secao-id="${s.id}" style="padding:.55rem;border:1px solid var(--border);background:var(--bg);font-size:.88rem;border-radius:4px">
            ${Object.entries(_TIPO_LABEL_AMIGAVEL).map(([v,l]) => `<option value="${v}">${escHtml(l)}</option>`).join('')}
          </select>
          <button class="btn btn-primary btn-sm" data-anam-act="add-pergunta" data-secao-id="${s.id}">+ Adicionar</button>
        </div>
      </div>
    </section>
  `).join('');
  _wireAnamAcoes();
}

function _renderAnamPergunta(q) {
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
  return `
    <div class="anam-pergunta" data-perg-chave="${escHtml(q.chave)}" style="display:flex;justify-content:space-between;align-items:flex-start;gap:.8rem;padding:.85rem 1rem;margin-bottom:.5rem;border:1px solid var(--border);border-radius:6px;background:var(--bg)">
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

let _anamAcoesWired = false;
function _wireAnamAcoes() {
  // Listener do botão + Criar seção: anexa UMA vez (sem { once }) e funciona
  // para múltiplas execuções. O elemento existe sempre (fora do template
  // dinâmico), então não precisa re-registrar a cada render.
  if (!_anamAcoesWired) {
    document.getElementById('btn-anam-add-secao')?.addEventListener('click', _anamAddSecao);
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
}

// Tradução pt-BR → 6 idiomas via Anthropic. Se a chamada falhar
// (ou se as traduções voltarem iguais ao pt-BR, indicando que o
// backend caiu no fallback por API key invalida/saldo zerado),
// mostra um toast warning para o admin saber.
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
        showToast('⚠ Traducao automatica falhou (sem credito Anthropic?) — salvando so pt-BR', 6000);
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
  showToast('Criando seção e traduzindo nos 7 idiomas…', 3000);
  try {
    const trad = await _anamTraduzirRotulo(titulo); // { idioma: {rotulo: '...'} }
    const traducoes = {};
    for (const [k, v] of Object.entries(trad)) traducoes[k] = v.rotulo;
    await apiSend('POST', `/api/qualidade/admin/pesquisas/${_anamPesquisaId}/secoes`, {
      chave, ordem: 99, traducoes,
    });
    showToast('✓ Seção criada');
    tituloEl.value = '';
    initAnamneseEditor();
  } catch (e) {
    showToast('Não foi possível criar: ' + e.message, 5000);
  }
}

async function _anamAddPergunta(secaoId) {
  if (!_anamPesquisaId) return showToast('Carregando estrutura, aguarde…');
  const rotuloInp = document.querySelector(`[data-anam-newperg-rotulo][data-secao-id="${secaoId}"]`);
  const tipoSel   = document.querySelector(`[data-anam-newperg-tipo][data-secao-id="${secaoId}"]`);
  const rotulo = rotuloInp?.value.trim();
  const tipo   = tipoSel?.value || 'texto_livre';
  if (!rotulo) { rotuloInp?.focus(); return showToast('Escreva a pergunta antes'); }
  const chave = _slugChave(rotulo);
  showToast('Criando e traduzindo nos 7 idiomas…', 3000);
  try {
    const traducoes = await _anamTraduzirRotulo(rotulo);
    const r1 = await apiSend('POST', '/api/qualidade/admin/perguntas', {
      chave, tipo, traducoes, pesquisa_slug: ANAMNESE_SLUG,
    });
    await apiSend('POST', `/api/qualidade/admin/pesquisas/${_anamPesquisaId}/perguntas`, {
      pergunta_id: r1.id, secao_id: secaoId, ordem: 99, obrigatoria: false, ativo: 1,
    });
    // BUG-R: pergunta 'Sim ou Não' do editor salva como tipo='escala'.
    // Aqui criamos as opcoes Sim/Não no backend pra evitar o caso de
    // opcoes=null no front (que cai no fallback frágil).
    if (tipo === 'escala') {
      try {
        await _criarOpcoesSimNao(r1.id);
      } catch (e) { console.warn('Falha ao criar opcoes Sim/Nao:', e.message); }
    }
    showToast('✓ Pergunta criada');
    if (rotuloInp) rotuloInp.value = '';
    initAnamneseEditor();
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

  // Modal UNICO (texto + tipo). Antes era um modal de texto seguido
  // de outro modal de tipo — usuario clicava Salvar no primeiro
  // achando que tinha terminado e o segundo ficava orfao, resultando
  // em zero requests dispatched.
  const resp = await pedirPergunta({
    titulo: 'Editar pergunta',
    mensagem: 'Atualize o texto e/ou o tipo de resposta.',
    valorRotulo: p.rotulo || chave,
    valorTipo: p.tipo,
    tipos: Object.entries(_TIPO_LABEL_AMIGAVEL).map(([v,l]) => ({ value: v, label: l })),
  });
  if (!resp) return;

  showToast('Salvando e traduzindo nos 7 idiomas…', 3000);
  try {
    const traducoes = await _anamTraduzirRotulo(resp.rotulo);
    await apiSend('PUT', `/api/qualidade/admin/perguntas/${p.id}`, {
      tipo: resp.tipo,
      traducoes,
    });
    showToast('✓ Pergunta atualizada');
    initAnamneseEditor();
  } catch (e) { showToast('Erro: ' + e.message, 5000); }
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
  // Busca id da pergunta
  const rL = await api('/api/qualidade/admin/perguntas');
  if (!rL) return;
  const dL = await rL.json();
  const p = dL.items?.find(x => x.chave === chave);
  if (!p) return showToast('Pergunta não encontrada');
  // Busca pp_id (associação pesquisa_pergunta) — não temos endpoint direto,
  // então marcamos a pergunta como ativo=0 (deixa de aparecer no formulário).
  try {
    await apiSend('PUT', `/api/qualidade/admin/perguntas/${p.id}`, { ativo: 0 });
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
      ? `<textarea id="_pedir-inp" rows="8" placeholder="${escHtml(placeholder)}" style="width:100%;padding:.7rem;border:1px solid var(--border);background:var(--bg);font-size:.92rem;border-radius:4px;font-family:inherit;resize:vertical">${escHtml(valorInicial)}</textarea>`
      : `<input id="_pedir-inp" value="${escHtml(valorInicial)}" placeholder="${escHtml(placeholder)}" style="width:100%;padding:.7rem;border:1px solid var(--border);background:var(--bg);font-size:.95rem;border-radius:4px">`;
    ov.innerHTML = `
      <div role="dialog" aria-modal="true" style="background:var(--surface);border:1px solid var(--border);border-radius:10px;max-width:560px;width:100%;padding:1.4rem 1.6rem;box-shadow:0 12px 40px rgba(0,0,0,.4)">
        <h3 style="margin:0 0 .4rem 0;font-family:'Cormorant Garamond',Georgia,serif;font-size:1.4rem;font-weight:500">${escHtml(titulo)}</h3>
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
      if (e.target === ov) close(null);
      else if (e.target.dataset.act === 'cancel') close(null);
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
        <h3 style="margin:0 0 .4rem 0;font-family:'Cormorant Garamond',Georgia,serif;font-size:1.4rem;font-weight:500">${escHtml(titulo)}</h3>
        ${mensagem ? `<p style="margin:0 0 1rem 0;color:var(--muted);font-size:.86rem;line-height:1.5">${escHtml(mensagem)}</p>` : ''}
        <select id="_pedir-sel" style="width:100%;padding:.7rem;border:1px solid var(--border);background:var(--bg);font-size:.95rem;border-radius:4px">
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
      if (e.target === ov || e.target.dataset.act === 'cancel') close(null);
      else if (e.target.dataset.act === 'ok') close(ov.querySelector('#_pedir-sel').value);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    setTimeout(() => ov.querySelector('#_pedir-sel')?.focus(), 30);
  });
}
window.pedirTexto = pedirTexto;
window.pedirOpcao = pedirOpcao;

// Modal unificado para editar/criar pergunta: texto + tipo num so dialog
// (evita o fluxo confuso de 2 modais sequenciais que o usuario fechava
// achando que tinha salvado).
// Retorna { rotulo, tipo } ou null se cancelado.
function pedirPergunta({ titulo = 'Pergunta', mensagem = '', valorRotulo = '', valorTipo = 'texto_livre', tipos = [] } = {}) {
  return new Promise(resolve => {
    document.querySelectorAll('.confirm-overlay').forEach(n => n.remove());
    const ov = document.createElement('div');
    ov.className = 'confirm-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.72);backdrop-filter:blur(2px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
    ov.innerHTML = `
      <div role="dialog" aria-modal="true" style="background:var(--surface);border:1px solid var(--border);border-radius:10px;max-width:560px;width:100%;padding:1.4rem 1.6rem;box-shadow:0 12px 40px rgba(0,0,0,.4)">
        <h3 style="margin:0 0 .4rem 0;font-family:'Cormorant Garamond',Georgia,serif;font-size:1.4rem;font-weight:500">${escHtml(titulo)}</h3>
        ${mensagem ? `<p style="margin:0 0 1rem 0;color:var(--muted);font-size:.86rem;line-height:1.5">${escHtml(mensagem)}</p>` : ''}
        <label style="display:block;font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:.35rem">Texto da pergunta (português)</label>
        <input id="_pq-rot" value="${escHtml(valorRotulo)}" placeholder="Escreva a pergunta..." style="width:100%;padding:.7rem;border:1px solid var(--border);background:var(--bg);font-size:.95rem;border-radius:4px;margin-bottom:1rem">
        <label style="display:block;font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:.35rem">Tipo de resposta</label>
        <select id="_pq-tipo" style="width:100%;padding:.7rem;border:1px solid var(--border);background:var(--bg);font-size:.95rem;border-radius:4px">
          ${tipos.map(o => `<option value="${escHtml(o.value)}"${o.value === valorTipo ? ' selected' : ''}>${escHtml(o.label)}</option>`).join('')}
        </select>
        <p style="margin:.8rem 0 0 0;color:var(--muted);font-size:.78rem;line-height:1.5">A tradução para os outros 6 idiomas é automática ao salvar.</p>
        <div style="display:flex;gap:.6rem;justify-content:flex-end;margin-top:1.2rem">
          <button class="btn btn-outline" data-act="cancel">Cancelar</button>
          <button class="btn btn-gold" data-act="ok">Salvar pergunta</button>
        </div>
      </div>
    `;
    function close(r) { ov.remove(); document.removeEventListener('keydown', onKey); resolve(r); }
    function onKey(e) {
      if (e.key === 'Escape') close(null);
      else if (e.key === 'Enter' && e.target?.id === '_pq-rot') {
        const rot = ov.querySelector('#_pq-rot').value.trim();
        const tip = ov.querySelector('#_pq-tipo').value;
        if (rot) close({ rotulo: rot, tipo: tip });
      }
    }
    ov.addEventListener('click', e => {
      if (e.target === ov || e.target.dataset.act === 'cancel') close(null);
      else if (e.target.dataset.act === 'ok') {
        const rot = ov.querySelector('#_pq-rot').value.trim();
        const tip = ov.querySelector('#_pq-tipo').value;
        if (!rot) { ov.querySelector('#_pq-rot').focus(); return; }
        close({ rotulo: rot, tipo: tip });
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
document.getElementById('btn-back-pesquisa-editor')?.addEventListener('click', () => showView('view-main'));
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
  wrap.innerHTML = e.secoes.map(s => `
    <section class="pesq-secao" data-secao-id="${s.id}" style="border:1px solid var(--border);border-radius:10px;padding:1.1rem 1.3rem;margin-bottom:1.4rem;background:var(--surface)">
      <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.9rem;flex-wrap:wrap;gap:.6rem">
        <h3 style="margin:0;font-family:'Cormorant Garamond',serif;font-size:1.35rem;color:var(--text)">${escHtml(s.titulo)}</h3>
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-outline btn-sm" data-pesq-act="edit-secao" data-secao-id="${s.id}">Renomear seção</button>
          <button class="btn btn-outline btn-sm" data-pesq-act="del-secao"  data-secao-id="${s.id}" style="color:var(--danger);border-color:var(--danger)">Remover seção</button>
        </div>
      </header>
      <div class="pesq-perguntas">
        ${s.perguntas.map(q => _renderPesqPergunta(q)).join('')}
      </div>
      <div style="margin-top:.9rem;padding-top:.9rem;border-top:1px dashed var(--border)">
        <div style="font-size:.78rem;color:var(--muted);margin-bottom:.4rem">Adicionar pergunta nesta seção:</div>
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <input data-pesq-newperg-rotulo data-secao-id="${s.id}" placeholder="Escreva a pergunta em português…" style="padding:.55rem .7rem;border:1px solid var(--border);background:var(--bg);font-size:.92rem;flex:1;min-width:280px;border-radius:4px">
          <select data-pesq-newperg-tipo data-secao-id="${s.id}" style="padding:.55rem;border:1px solid var(--border);background:var(--bg);font-size:.88rem;border-radius:4px">
            ${Object.entries(_TIPO_LABEL_AMIGAVEL).map(([v,l]) => `<option value="${v}">${escHtml(l)}</option>`).join('')}
          </select>
          <button class="btn btn-primary btn-sm" data-pesq-act="add-pergunta" data-secao-id="${s.id}">+ Adicionar</button>
        </div>
      </div>
    </section>
  `).join('');
  _wirePesqAcoes();
}

function _renderPesqPergunta(q) {
  const tipoLabel = _TIPO_LABEL_AMIGAVEL[q.tipo] || q.tipo;
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
  return `
    <div class="pesq-pergunta" data-perg-id="${q.pergunta_id}" data-assoc-id="${q.associacao_id}" style="display:flex;justify-content:space-between;align-items:flex-start;gap:.8rem;padding:.85rem 1rem;margin-bottom:.5rem;border:1px solid var(--border);border-radius:6px;background:var(--bg)">
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
}

async function _pesqAddSecao() {
  if (!_pesqPesquisaId) return showToast('Carregando estrutura, aguarde…', 3000);
  const tituloEl = document.getElementById('pesq-nova-secao-titulo');
  const titulo = tituloEl?.value.trim();
  if (!titulo) { tituloEl?.focus(); return showToast('Digite o nome da nova seção'); }
  const chave = _slugChave(titulo, 'sec_');
  showToast('Criando seção e traduzindo nos 7 idiomas…', 3000);
  try {
    const trad = await _anamTraduzirRotulo(titulo);
    const traducoes = {};
    for (const [k, v] of Object.entries(trad)) traducoes[k] = v.rotulo;
    await apiSend('POST', `/api/qualidade/admin/pesquisas/${_pesqPesquisaId}/secoes`, {
      chave, ordem: 99, traducoes,
    });
    showToast('✓ Seção criada');
    tituloEl.value = '';
    initPesquisaEditor();
  } catch (e) { showToast('Não foi possível criar: ' + e.message, 5000); }
}

async function _pesqAddPergunta(secaoId) {
  if (!_pesqPesquisaId) return showToast('Carregando estrutura, aguarde…');
  const rotuloInp = document.querySelector(`[data-pesq-newperg-rotulo][data-secao-id="${secaoId}"]`);
  const tipoSel   = document.querySelector(`[data-pesq-newperg-tipo][data-secao-id="${secaoId}"]`);
  const rotulo = rotuloInp?.value.trim();
  const tipo   = tipoSel?.value || 'texto_livre';
  if (!rotulo) { rotuloInp?.focus(); return showToast('Escreva a pergunta antes'); }
  const chave = _slugChave(rotulo, 'pesq_');
  showToast('Criando e traduzindo nos 7 idiomas…', 3000);
  try {
    const traducoes = await _anamTraduzirRotulo(rotulo);
    const r1 = await apiSend('POST', '/api/qualidade/admin/perguntas', {
      chave, tipo, traducoes, pesquisa_slug: PESQUISA_SLUG,
    });
    await apiSend('POST', `/api/qualidade/admin/pesquisas/${_pesqPesquisaId}/perguntas`, {
      pergunta_id: r1.id, secao_id: secaoId, ordem: 99, obrigatoria: false, ativo: 1,
    });
    if (tipo === 'escala') {
      try { await _criarOpcoesSimNao(r1.id); } catch (e) { console.warn('Falha opcoes Sim/Nao:', e.message); }
    }
    showToast('✓ Pergunta criada');
    if (rotuloInp) rotuloInp.value = '';
    initPesquisaEditor();
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
    mensagem: 'Atualize o texto e/ou o tipo de resposta.',
    valorRotulo: p.rotulo || p.chave,
    valorTipo: p.tipo,
    tipos: Object.entries(_TIPO_LABEL_AMIGAVEL).map(([v,l]) => ({ value: v, label: l })),
  });
  if (!resp) return;

  showToast('Salvando e traduzindo nos 7 idiomas…', 3000);
  try {
    const traducoes = await _anamTraduzirRotulo(resp.rotulo);
    await apiSend('PUT', `/api/qualidade/admin/perguntas/${pid}`, { tipo: resp.tipo, traducoes });
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
