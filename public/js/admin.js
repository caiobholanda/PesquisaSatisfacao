const TOKEN_KEY = 'granspa_token';
const LIMIT = 30;
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

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function api(url, opts = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token()}` },
      ...opts,
    });
    if (res.status === 401) { logout(); return null; }
    return res;
  } catch (e) {
    if (e.name === 'AbortError') return null;
    throw e;
  }
}

function logout() { pararPollingStats?.(); clearToken(); sessionStorage.removeItem('_vst'); showLogin(); }

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
}
function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';
  loadAll(); // sempre carrega dados do painel principal em background
  const st = JSON.parse(sessionStorage.getItem('_vst') || '{}');
  const view = st.view || 'view-reservas';
  showView(view);
  if (view === 'view-massagistas') { loadMassagistas(); }
  else if (view === 'view-tipos') { loadTipos(); }
  else if (view === 'view-historico' && st.histId) { showHistoricoMassagista(st.histId, st.histNome); }
  else if (view === 'view-historico-clientes') { loadHistoricoClientes(); }
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

function renderMediaBadge(media) {
  if (media == null) return '<span class="q-media-badge empty">— / 9</span>';
  const cor = _scoreColor(media);
  return `<span class="q-media-badge" style="background:${cor}1A;color:${cor};border-color:${cor}40"><strong>${media.toFixed(1)}</strong><span class="q-media-max"> / ${NOTA_MAX}</span></span>`;
}

function renderTextoGroup(titulo, items) {
  if (!items || !items.length) return '';
  return `<div class="textos-sub">${titulo}</div><div class="texto-list">${items.map(t =>
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
  const res = await api(`/api/feedback/stats?${params}`);
  if (!res) return;
  const d = await res.json();
  if (!d.ok) return;
  document.getElementById('kpi-total').textContent = d.total;
  document.getElementById('kpi-media').textContent = d.mediaGeral != null ? d.mediaGeral.toFixed(2) + ' / 9' : '—';
  document.getElementById('kpi-recomenda').textContent = d.pctRecomenda != null ? d.pctRecomenda + '%' : '—';
  const h = d.porOrigem.find(r => r.origem === 'hospede')?.t || 0;
  const c = d.porOrigem.find(r => r.origem === 'colaborador')?.t || 0;
  document.getElementById('kpi-origem').innerHTML = `<span style="color:var(--gold)">${h}</span> / <span style="color:var(--indigo)">${c}</span>`;
  renderAnalysis(d);
  _atualizarUltimoSync();
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
const NOTA_MAP = { otimo: 9, bom: 3, regular: 1, ruim: 0 };
const NOTA_MAX = 9;
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
function scoreClass(v) { if (v == null) return ''; return v >= 3.5 ? 'score-green' : v >= 2.5 ? 'score-yellow' : 'score-red'; }
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
  const res = await api(`/api/feedback?${params}`, { signal });
  if (signal.aborted) return;
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
        <td style="font-weight:500">${escHtml(r.nome)}</td>
        <td style="color:var(--muted)">${escHtml(r.email)}</td>
        <td style="color:var(--muted)">${escHtml(r.tipo_cliente || '—')}</td>
        <td><span class="badge ${r.origem === 'hospede' ? 'badge-hospede' : 'badge-colab'}">${r.origem === 'hospede' ? 'Hóspede' : 'Colaborador'}</span></td>
        <td class="${scoreClass(avg)}">${avg ?? '—'}</td>
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
  ['view-main', 'view-massagistas', 'view-tipos', 'view-historico', 'view-reservas', 'view-historico-clientes', 'view-usuarios'].forEach(v => {
    document.getElementById(v).style.display = v === id ? 'block' : 'none';
  });
  window.scrollTo(0, 0);
  const cur = JSON.parse(sessionStorage.getItem('_vst') || '{}');
  sessionStorage.setItem('_vst', JSON.stringify({ ...cur, view: id }));
  if (id === 'view-main') iniciarPollingStats(); else pararPollingStats();
  // Mostra/esconde botão "Início" no header
  const homeBtn = document.getElementById('btn-header-home');
  if (homeBtn) homeBtn.style.display = (id === 'view-reservas') ? 'none' : '';
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

// estado: 'ok' | 'liberada' | 'fora_prazo'
function _aplicarEstadoLiberada(btn, estado) {
  if (!btn) return;
  if (estado === true) estado = 'liberada';
  if (estado === false) estado = 'ok';
  btn.disabled = estado !== 'ok';
  btn.dataset.estado = estado;
  if (estado === 'liberada') {
    btn.textContent = 'PESQUISA JÁ LIBERADA';
    btn.style.opacity = '0.55';
    btn.style.cursor = 'default';
    btn.style.fontSize = '';
  } else if (estado === 'fora_prazo') {
    btn.textContent = 'Não é mais permitido preencher a pesquisa de satisfação';
    btn.style.opacity = '0.45';
    btn.style.cursor = 'default';
    btn.style.fontSize = '.78rem';
  } else {
    btn.textContent = 'Liberar Pesquisa';
    btn.style.opacity = '';
    btn.style.cursor = '';
    btn.style.fontSize = '';
  }
}

function _estadoBtnLiberar(r) {
  if (_pesquisasLiberadas.has(r.id)) return 'liberada';
  const fim = new Date(`${r.data}T${r.hora_fim}:00`);
  if (Date.now() > fim.getTime() + 45 * 60 * 1000) return 'fora_prazo';
  return 'ok';
}

async function liberarPesquisaReserva(id) {
  const btn = document.getElementById('resdet-liberar');
  if (btn?.dataset.estado === 'fora_prazo' || btn?.dataset.estado === 'liberada') return;
  if (btn) { btn.disabled = true; btn.textContent = 'Liberando…'; }
  try {
    const res = await api(`/api/reservas/${id}/liberar-pesquisa`, { method: 'POST', body: '{}' });
    if (!res) { _aplicarEstadoLiberada(btn, false); return; }
    const d = await res.json();
    if (!d.ok) { alert('Erro ao liberar pesquisa: ' + (d.error || '')); _aplicarEstadoLiberada(btn, false); return; }
    _pesquisasLiberadas.add(id);
    _aplicarEstadoLiberada(btn, true);
    showToast('✓ Pesquisa liberada — o botão já apareceu na tela do hóspede');
  } catch {
    _aplicarEstadoLiberada(btn, false);
  }
}

function enviarPreMassagemReserva() {
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

document.getElementById('btn-open-tipos').addEventListener('click', () => { showView('view-tipos'); loadTipos(); });
document.getElementById('btn-back-tipos').addEventListener('click', () => showView('view-main'));

// Botão "Início" no header — atalho direto pra view-main, fica visível só em subpáginas
document.getElementById('btn-header-home')?.addEventListener('click', () => { showView('view-reservas'); loadReservas(); });

// Botão de gerar dados de demonstração — só pesquisas (reservas continuam manuais)
async function seedDemo(btnEl) {
  const ok = confirm('⚠ Isso vai APAGAR todas as reservas e pesquisas atuais e gerar:\n• 5 reservas fictícias (próximos 3 dias)\n• 15 pesquisas de satisfação fictícias\n\nContinuar?');
  if (!ok) return;
  btnEl.disabled = true;
  const txt = btnEl.textContent;
  btnEl.textContent = '⏳ Gerando...';
  try {
    const res = await api('/api/dev/seed-demo', { method: 'POST', body: '{}' });
    if (!res) return;
    const d = await res.json();
    if (!d.ok) { alert('Erro: ' + (d.error || 'falha ao gerar dados')); return; }
    alert(`✓ Pronto! ${d.reservas} reservas e ${d.feedbacks} pesquisas inseridas.`);
    loadStats();
    loadAll();
  } catch (e) {
    alert('Erro de conexão: ' + e.message);
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = txt;
  }
}
document.getElementById('btn-seed-demo-res')?.addEventListener('click', function() { seedDemo(this); });
document.getElementById('btn-seed-demo')?.addEventListener('click', function() { seedDemo(this); });

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
      ? `<span class="mgmt-item-stat">${tot} ${tot !== 1 ? 'avaliações' : 'avaliação'}${pctRec != null ? ` · ${pctRec}% recomendam` : ''}</span>`
      : `<span class="mgmt-item-stat sem-aval">Sem avaliações</span>`;
    const badges = [];
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
      <div class="hist-kpi-val" style="color:var(--gold)">${mediaGeral != null ? mediaGeral + ' / 9' : '—'}</div>
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
              <td class="${scoreClass(avg)}">${avg ?? '—'}</td>
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
const CAL_SLOT_PX = 64;
const MESES_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

let _reservas  = [];
let _resSala       = null;
let _resTipo       = null;
let _resHoraInicio = null;
let _resHoraFim    = null;
let _tratamentos = []; // [{nome, duracao_min, ...}]
let _massagistasModal = []; // cache p/ modal de reserva — [{id, nome, bilingue, vinculo, ...}]

async function loadMassagistasModal() {
  if (_massagistasModal.length) return;
  const r = await api('/api/massagistas-ativas');
  if (!r) return;
  const d = await r.json();
  _massagistasModal = d.items || [];
  _renderMassagistasModal();
}

function _renderMassagistasModal() {
  const sel = document.getElementById('res-inp-massagista');
  if (!sel) return;
  const apenasBilingue = document.getElementById('res-flt-bilingue')?.checked;
  const lista = apenasBilingue ? _massagistasModal.filter(m => m.bilingue) : _massagistasModal;
  if (!lista.length) {
    sel.innerHTML = `<option value="">${apenasBilingue ? 'Nenhuma bilíngue disponível' : '— Sem massoterapeutas cadastradas —'}</option>`;
    return;
  }
  sel.innerHTML = '<option value="">— Selecione —</option>' +
    lista.map(m => `<option value="${m.id}" data-bilingue="${m.bilingue?1:0}" data-vinculo="${m.vinculo||''}">${m.nome}${m.vinculo?` · ${m.vinculo}`:''}</option>`).join('');
}

async function loadTratamentosModal() {
  if (_tratamentos.length) return;
  try {
    const r = await api('/api/tipos-massagem-ativos');
    if (!r) return;
    const d = await r.json();
    _tratamentos = d.items || [];
    const sel = document.getElementById('res-inp-tratamento');

    // Agrupa por categoria com optgroups, combos primeiro
    const ordem = ['Combo', 'Massagem', 'Tratamento', 'Facial', 'Complementar'];
    const porCat = {};
    for (const t of _tratamentos) {
      const cat = t.categoria || 'Outros';
      (porCat[cat] = porCat[cat] || []).push(t);
    }
    const cats = ordem.filter(c => porCat[c]).concat(Object.keys(porCat).filter(c => !ordem.includes(c)));

    let html = '<option value="">— Selecione —</option>';
    for (const cat of cats) {
      html += `<optgroup label="${cat}">`;
      for (const t of porCat[cat]) {
        const precoLbl = t.preco ? ` · R$ ${Number(t.preco).toFixed(0)}` : '';
        const durLbl = t.duracao_min ? ` (${t.duracao_min} min)` : '';
        html += `<option value="${t.nome}" data-id="${t.id}" data-dur="${t.duracao_min||''}" data-preco="${t.preco||''}" data-tipo="${t.tipo||'individual'}">${t.nome}${durLbl}${precoLbl}</option>`;
      }
      html += '</optgroup>';
    }
    sel.innerHTML = html;
  } catch {}
}

// Localiza o tratamento selecionado no modal
function _tratSelecionado() {
  const sel = document.getElementById('res-inp-tratamento');
  if (!sel.value) return null;
  return _tratamentos.find(t => t.nome === sel.value) || null;
}

// Slots de 30min: bloco = ceil(duracao/30) * 30
function _blocoMinutos(durTratamento) {
  if (!durTratamento) return 0;
  return Math.ceil(durTratamento / 30) * 30;
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
    html+=`<div class="cal-time-cell${halfClass}">${isHour ? timeStr : ''}</div>`;
    CAL_ROOMS.forEach(room=>{
      const res=dayRes.find(r=>r.sala===room.id&&calTimeMin(r.hora_inicio)<slotE&&calTimeMin(r.hora_fim)>slotS);
      if(res){
        const rs=calTimeMin(res.hora_inicio), re=calTimeMin(res.hora_fim);
        const isFirst=rs>=slotS&&rs<slotE;
        if(isFirst){
          const topPx=((rs-slotS)/SLOT_MIN)*CAL_SLOT_PX+2;
          const ht=((re-rs)/SLOT_MIN)*CAL_SLOT_PX-4;
          html+=`<div class="cal-slot occupied${halfClass}" style="overflow:visible;position:relative">
            <div class="cal-res-block ${room.cls}" style="position:absolute;left:0;right:4px;top:${topPx}px;height:${ht}px" data-action="cal-ver" data-id="${res.id}" title="${escHtml(res.cliente)}${res.tratamento?' · '+escHtml(res.tratamento):''} · ${res.hora_inicio}–${res.hora_fim}">
              <div class="cal-res-name">${escHtml(res.cliente)}</div>
              ${res.tratamento?`<div class="cal-res-trat">${escHtml(res.tratamento)}</div>`:''}
              <div class="cal-res-time">${res.hora_inicio} – ${res.hora_fim}</div>
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

  // Linha de horário atual (somente se dia selecionado = hoje)
  calUpdateNowLine(ds);
}

window.calCancelar=async(id)=>{
  if(!confirm('Cancelar esta reserva?'))return;
  const res=await api(`/api/reservas/${id}`,{method:'DELETE'});
  if(res)loadReservas();
};

let _nowLineInterval = null;
function calUpdateNowLine(ds) {
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
  document.getElementById('res-fg-apto').style.display = tipo === 'hospede' ? '' : 'none';
  if (tipo !== 'hospede') document.getElementById('res-inp-apto').value = '';
}

function calOpenModal(salaId, data, hora) {
  _resSala=salaId||1;
  _resTipo=null;
  _modalOpen = true;
  document.getElementById('res-modal-overlay').style.display='flex';
  document.getElementById('res-modal-err').textContent='';
  document.querySelectorAll('.res-tipo-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('res-fg-apto').style.display='none';
  ['res-inp-nome','res-inp-apto','res-inp-email','res-inp-tel','res-inp-tratamento'].forEach(id=>{
    document.getElementById(id).value='';
  });
  _resHoraInicio = hora || '09:00';
  _resHoraFim = null;
  document.getElementById('res-inp-hora-inicio').value = _resHoraInicio;
  document.getElementById('res-tempo-val').textContent = 'selecione um tratamento';
  document.getElementById('res-extra-info').innerHTML = '';
  if(data) document.getElementById('res-inp-data').value=data;
  document.querySelectorAll('.res-room-btn').forEach(b=>b.classList.toggle('active',+b.dataset.sala===_resSala));
  loadTratamentosModal();
  loadMassagistasModal();
  const flt = document.getElementById('res-flt-bilingue');
  if (flt) flt.checked = false;
  const selM = document.getElementById('res-inp-massagista');
  if (selM) selM.value = '';
  setTimeout(()=>document.getElementById('res-inp-nome').focus(),50);
}
window.calOpenModal=calOpenModal;

// Recalcula hora_fim sempre que hora_inicio ou tratamento mudam
function calAtualizarHoraFim() {
  const inicio = document.getElementById('res-inp-hora-inicio').value;
  const trat = document.getElementById('res-inp-tratamento');
  const opt = trat.options[trat.selectedIndex];
  const dur = parseInt(opt?.dataset?.dur || '0', 10);
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
  if (!m) return `<span class="resdet-kv-val mono">#${r.massagista_id}</span>`;
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
document.getElementById('res-flt-bilingue')?.addEventListener('change', _renderMassagistasModal);

// Modal de detalhes da reserva
function calVerDetalhes(id) {
  const r = _reservas.find(x => x.id === id);
  if (!r) return;
  _resDetAtual = r;
  const btnLib = document.getElementById('resdet-liberar');
  if (btnLib) { btnLib.dataset.id = r.id; _aplicarEstadoLiberada(btnLib, _estadoBtnLiberar(r)); }
  const btnFicha = document.getElementById('resdet-ficha');
  if (btnFicha) btnFicha.dataset.id = r.id;
  const sala = CAL_ROOMS.find(s => s.id === r.sala);
  const salaName = sala ? sala.nome : `Sala ${r.sala}`;
  const salaCls = sala ? sala.cls : 's1';
  const salaTipo = sala ? `${sala.tipo} · ${sala.cap} pessoa${sala.cap>1?'s':''}` : '';
  const tipoCli = r.tipo_cliente === 'hospede' ? 'Hóspede' : (r.tipo_cliente === 'passante' ? 'Passante' : '—');
  const tipoCliCls = r.tipo_cliente === 'hospede' ? 'hospede' : 'passante';
  const dur = calTimeMin(r.hora_fim) - calTimeMin(r.hora_inicio);
  document.getElementById('resdet-sub').innerHTML =
    `<span class="resdet-sala-badge ${salaCls}"><span class="resdet-sala-dot ${salaCls}"></span>${salaName}</span><span style="margin-left:.5rem;color:var(--muted);font-size:.76rem">${salaTipo}</span>`;

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

    <div class="resdet-grid">
      <div class="resdet-card">
        <div class="resdet-card-title">Cliente</div>
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
      </div>

      <div class="resdet-card">
        <div class="resdet-card-title">Tratamento</div>
        <div class="resdet-tratamento-name">${r.tratamento ? escHtml(r.tratamento) : '<span style="font-style:italic;color:var(--muted);font-family:var(--font);font-size:.9rem">não informado</span>'}</div>
        ${r.linha ? `<div class="resdet-kv"><div class="resdet-kv-label">Linha</div><div class="resdet-kv-val">${escHtml(r.linha)}</div></div>` : ''}
        <div class="resdet-kv"><div class="resdet-kv-label">Profissional</div>${_massagistaDetHtml(r)}</div>
        <div class="resdet-kv"><div class="resdet-kv-label">Duração</div><div class="resdet-kv-val mono">${dur} min</div></div>
        ${_precoDetHtml(r)}
      </div>
    </div>

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
        <div class="resdet-registro-label">Sala</div>
        <div class="resdet-registro-val">${salaName}</div>
      </div>
    </div>
  `;

  const btnCancel = document.getElementById('resdet-cancelar-res');
  const inicioMs = new Date(`${r.data}T${r.hora_inicio}:00`).getTime();
  const cancelBloqueado = Date.now() > inicioMs + 30 * 60 * 1000;
  btnCancel.disabled = cancelBloqueado;
  btnCancel.title = cancelBloqueado ? 'Cancelamento não permitido após 30 min do início' : '';
  btnCancel.style.opacity = cancelBloqueado ? '0.4' : '';
  btnCancel.style.cursor = cancelBloqueado ? 'default' : '';
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
document.getElementById('resdet-overlay').addEventListener('click', e => {
  if (e.target.id === 'resdet-overlay') { _modalOpen = false; e.target.style.display = 'none'; }
});

// Modal idioma pré-massagem
const _closeLangOverlay = () => { document.getElementById('lang-overlay').style.display = 'none'; };
document.getElementById('lang-x').addEventListener('click', _closeLangOverlay);
document.getElementById('lang-cancelar').addEventListener('click', _closeLangOverlay);
document.getElementById('lang-overlay').addEventListener('click', e => { if (e.target.id === 'lang-overlay') _closeLangOverlay(); });
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
    const url = `${d.baseUrl}?t=${d.token}&lang=${_langSelected}`;
    const raw = (r.telefone || '').replace(/\D/g, '');
    const phone = raw.startsWith('55') ? raw : '55' + raw;
    const msg = `Olá, *${r.cliente || 'hóspede'}*! 😊\n\nPara prepararmos sua experiência no *Gran SPA by L'Occitane*, pedimos que preencha a ficha de saúde antes do seu tratamento:\n\n👉 ${url}\n\n*Hotel Gran Marquise* 🌿`;
    _closeLangOverlay();
    if (raw) {
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
    } else {
      try { navigator.clipboard.writeText(url); } catch {}
      showToast(`Link copiado! ${url}`);
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

document.getElementById('res-inp-tratamento').addEventListener('change', calAtualizarHoraFim);

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
  const horaInicio=document.getElementById('res-inp-hora-inicio').value;
  if(!sala){err.textContent='Selecione uma sala.';return;}
  if(!tipo){err.textContent='Selecione o tipo de cliente (Hóspede ou Passante).';return;}
  if(!nome){err.textContent='Informe o nome do cliente.';return;}
  if(!email){err.textContent='Informe o e-mail.';return;}
  if(!horaInicio){err.textContent='Informe a hora de início.';return;}
  if(!tratamento){err.textContent='Selecione o tratamento.';return;}
  if(!_resHoraFim){
    err.textContent='Horário inválido: o tratamento ultrapassaria o expediente do spa (fecha às 22:00).';
    return;
  }
  if(!data){err.textContent='Informe a data.';return;}
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
  const selMass = document.getElementById('res-inp-massagista');
  const massagistaId = selMass?.value ? +selMass.value : null;
  if (!massagistaId) { err.textContent = 'Selecione a massoterapeuta que vai atender.'; return; }

  // Verificação local de conflito antes de bater no servidor
  const conflitoLocal = calDetectarConflito(sala, massagistaId, data, horaInicio, _resHoraFim);
  if (conflitoLocal) {
    calMostrarConflito(conflitoLocal);
    return;
  }

  const btn=document.getElementById('btn-res-salvar');
  btn.disabled=true;
  try{
    const res=await api('/api/reservas',{method:'POST',body:JSON.stringify({
      sala, tipo_cliente: tipo, cliente: nome, apto, email, telefone, tratamento, data,
      hora_inicio: horaInicio, hora_fim: _resHoraFim,
      linha, tipo_massagem_id: tipoMassagemId, massagista_id: massagistaId
    })});
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
document.getElementById('btn-open-relatorios').addEventListener('click',()=>showView('view-main'));
document.getElementById('btn-back-reservas').addEventListener('click',()=>showView('view-reservas'));

// Dropdowns SPA e Administrativo
(function setupDropdowns() {
  function makeDropdown(toggleId, menuId) {
    const toggle = document.getElementById(toggleId);
    const menu   = document.getElementById(menuId);
    toggle.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('open'); });
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
const SENHA_RULES = [
  { test: s => s.length >= 8,           label: '8+ caracteres' },
  { test: s => /[A-Z]/.test(s),         label: 'Maiúscula' },
  { test: s => /[0-9]/.test(s),         label: 'Número' },
  { test: s => /[^a-zA-Z0-9]/.test(s),  label: 'Caractere especial (!@#…)' },
];

function atualizarSenhaUI(senha) {
  const passed = SENHA_RULES.filter(r => r.test(senha)).length;
  const fill   = document.getElementById('senha-strength-fill');
  const lbl    = document.getElementById('senha-strength-label');
  const rules  = document.getElementById('senha-rules');
  const cores  = ['','#B85450','#D4953D','#5B9BD5','#2D7A4F'];
  const labels = ['','Fraca','Razoável','Boa','Forte'];
  fill.style.width = (passed * 25) + '%';
  fill.style.background = cores[passed] || 'transparent';
  lbl.textContent = senha ? labels[passed] || '' : '';
  lbl.style.color = cores[passed] || 'var(--muted)';
  rules.innerHTML = SENHA_RULES.map(r => {
    const ok = r.test(senha);
    return `<span style="font-size:.68rem;color:${ok?'var(--success)':'var(--muted)'}">${ok?'✓':'○'} ${r.label}</span>`;
  }).join('');
}

document.getElementById('usuario-senha').addEventListener('input', function() { atualizarSenhaUI(this.value); });
document.getElementById('btn-toggle-senha').addEventListener('click', () => {
  const inp = document.getElementById('usuario-senha');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

function fecharFormUsuario() {
  document.getElementById('form-usuario').style.display = 'none';
  ['usuario-nome','usuario-username','usuario-senha','usuario-edit-id'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('usuario-role').value = 'admin';
  document.getElementById('usuario-msg').style.display = 'none';
  atualizarSenhaUI('');
  document.getElementById('senha-label').innerHTML = 'Senha <span style="color:var(--muted);font-weight:400">(obrigatória)</span>';
}

document.getElementById('btn-novo-usuario').addEventListener('click', () => {
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
  const r = await api('/api/auth/usuarios');
  if (!r) return;
  const d = await r.json();

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
  tbody.innerHTML = d.items.map(u => `<tr>
    <td>
      <div style="font-weight:500">${escHtml(u.nome || u.username)}</div>
      ${u.nome ? `<div style="font-size:.75rem;color:var(--muted)">@${escHtml(u.username)}</div>` : ''}
    </td>
    <td style="font-size:.82rem;color:var(--muted)">@${escHtml(u.username)}</td>
    <td><span class="role-badge role-${u.role||'admin'}">${ROLE_LABEL[u.role]||u.role||'admin'}</span></td>
    <td style="font-size:.78rem;color:var(--muted)">${fmt(u.created_at)}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="btn btn-outline btn-sm" style="margin-right:.4rem" data-action="edit-user" data-id="${u.id}">Editar</button>
      ${u.id !== meId ? `<button class="btn btn-outline btn-sm" style="border-color:var(--danger);color:var(--danger)" data-action="del-user" data-id="${u.id}" data-nome="${escHtml(u.nome||u.username)}">Remover</button>` : '<span style="font-size:.72rem;color:var(--muted)">você</span>'}
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
  document.getElementById('usuario-senha').value = '';
  document.getElementById('usuario-role').value = u.role || 'admin';
  document.getElementById('usuario-edit-id').value = id;
  document.getElementById('senha-label').innerHTML = 'Nova senha <span style="color:var(--muted);font-weight:400">(deixe em branco para não alterar)</span>';
  atualizarSenhaUI('');
  document.getElementById('usuario-msg').style.display = 'none';
  document.getElementById('form-usuario').style.display = 'block';
  document.getElementById('form-usuario').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

document.getElementById('btn-salvar-usuario').addEventListener('click', async () => {
  const editId  = document.getElementById('usuario-edit-id').value;
  const nome    = document.getElementById('usuario-nome').value.trim();
  const username= document.getElementById('usuario-username').value.trim();
  const senha   = document.getElementById('usuario-senha').value;
  const role    = document.getElementById('usuario-role').value;
  const msg     = document.getElementById('usuario-msg');
  msg.style.display = 'none';

  if (!username) { msg.textContent='Usuário obrigatório.'; msg.style.display='block'; return; }
  if (!editId) {
    if (!senha) { msg.textContent='Senha obrigatória para novo usuário.'; msg.style.display='block'; return; }
    if (SENHA_RULES.some(r => !r.test(senha))) { msg.textContent='A senha não atende todos os requisitos de segurança.'; msg.style.display='block'; return; }
  }

  const body = JSON.stringify({ nome, username, senha: senha || undefined, role });
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

document.getElementById('btn-open-historico-clientes').addEventListener('click',()=>{showView('view-historico-clientes');loadHistoricoClientes();});
document.getElementById('btn-back-historico-clientes').addEventListener('click',()=>showView('view-main'));
document.getElementById('btn-hc-filtrar').addEventListener('click',()=>loadHistoricoClientes());
document.getElementById('btn-hc-limpar').addEventListener('click',()=>{
  document.getElementById('hc-from').value='';
  document.getElementById('hc-to').value='';
  document.getElementById('hc-sala').value='';
  document.getElementById('hc-busca').value='';
  loadHistoricoClientes();
});
document.getElementById('hc-busca').addEventListener('keydown', e=>{ if(e.key==='Enter') loadHistoricoClientes(); });
document.getElementById('btn-exportar-historico').addEventListener('click', exportarHistoricoCSV);

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
