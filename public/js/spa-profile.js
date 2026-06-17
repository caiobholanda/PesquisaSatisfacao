'use strict';

let _locale = null;
let _sig = null;
let _docType = 'cpf';
let _currentLang = 'pt-BR';
let _docToken = null;

/* ─── Helpers ─── */

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setPlaceholder(id, ph) {
  const el = document.getElementById(id);
  if (el) el.placeholder = ph;
}

function validarCPF(cpf) {
  cpf = cpf.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(.)\1+$/.test(cpf)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += +cpf[i] * (10 - i);
  let r = (s * 10) % 11;
  if (r >= 10) r = 0;
  if (r !== +cpf[9]) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += +cpf[i] * (11 - i);
  r = (s * 10) % 11;
  if (r >= 10) r = 0;
  return r === +cpf[10];
}

function validarEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

/* Telefone: BR (DDD válido + 10/11 dígitos) ou internacional E.164 (+...) */
const _DDDS_BR = new Set(['11','12','13','14','15','16','17','18','19','21','22','24','27','28','31','32','33','34','35','37','38','41','42','43','44','45','46','47','48','49','51','53','54','55','61','62','63','64','65','66','67','68','69','71','73','74','75','77','79','81','82','83','84','85','86','87','88','89','91','92','93','94','95','96','97','98','99']);
function validarTelefoneFlex(tel) {
  if (!tel) return false;
  const t = String(tel).trim();
  if (!t) return false;
  if (t.startsWith('+')) {
    const d = t.slice(1).replace(/\D/g, '');
    return d.length >= 8 && d.length <= 15;
  }
  const d = t.replace(/\D/g, '');
  if (d.length !== 10 && d.length !== 11) return false;
  if (!_DDDS_BR.has(d.slice(0, 2))) return false;
  if (d.length === 11 && d[2] !== '9') return false;
  return true;
}

/* Quarto: cache local da lista oficial dos 230 quartos */
let _QUARTOS_CACHE = null;
async function _carregarQuartosCli() {
  if (_QUARTOS_CACHE) return _QUARTOS_CACHE;
  try {
    const r = await fetch('/api/quartos');
    if (!r.ok) return (_QUARTOS_CACHE = {});
    const d = await r.json();
    const map = {};
    for (const q of d.items || []) map[q.numero] = q.categoria;
    return (_QUARTOS_CACHE = map);
  } catch { return (_QUARTOS_CACHE = {}); }
}
function _normQuarto(v) { return String(v||'').trim().replace(/\D/g, '').padStart(4,'0').slice(-4); }

/* ─── Pill checkboxes (Facial / Corpo) ─── */

function renderPills(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const selectedIdx = new Set(
    Array.from(el.querySelectorAll('.spa-pill.selected')).map(p => p.dataset.idx)
  );

  el.innerHTML = items.map((label, i) => {
    const sel = selectedIdx.has(String(i));
    return `<label class="spa-pill${sel ? ' selected' : ''}" data-label="${label.replace(/"/g, '&quot;')}" data-idx="${i}">
      <input type="checkbox"${sel ? ' checked' : ''}><span class="pill-dot"></span><span>${label}</span>
    </label>`;
  }).join('');

  el.querySelectorAll('.spa-pill').forEach(pill => {
    pill.querySelector('input').addEventListener('change', function () {
      pill.classList.toggle('selected', this.checked);
    });
  });
}

/* ─── Signature canvas ─── */

function initCanvas() {
  const canvas = document.getElementById('sig-canvas');
  const wrap   = document.getElementById('canvas-wrap');
  const hint   = document.getElementById('sig-hint');
  const ctx    = canvas.getContext('2d');
  let drawing  = false;
  let hasSigned = false;

  function resize() {
    const dpr  = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width * dpr;
    canvas.height = 160 * dpr;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#241508';
    ctx.lineWidth   = 2.2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
  }

  requestAnimationFrame(resize);
  window.addEventListener('resize', () => { resize(); if (!hasSigned) clear(); });

  function getXY(e) {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return [src.clientX - rect.left, src.clientY - rect.top];
  }

  function startDraw(e) {
    drawing = true;
    ctx.beginPath();
    const [x, y] = getXY(e);
    ctx.moveTo(x, y);
  }

  function draw(e) {
    if (!drawing) return;
    const [x, y] = getXY(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasSigned) {
      hasSigned = true;
      hint.style.display = 'none';
      wrap.classList.add('has-sig');
    }
    validateAll();
  }

  function endDraw() { drawing = false; }

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup',   endDraw);
  canvas.addEventListener('mouseleave', endDraw);
  canvas.addEventListener('touchstart', e => { e.preventDefault(); startDraw(e); }, { passive: false });
  canvas.addEventListener('touchmove',  e => { e.preventDefault(); draw(e); },      { passive: false });
  canvas.addEventListener('touchend',   endDraw);

  function clear() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, 160);
    hasSigned = false;
    hint.style.display = '';
    wrap.classList.remove('has-sig');
    validateAll();
  }

  document.getElementById('btn-clear-sig').addEventListener('click', clear);

  return {
    hasSigned:  () => hasSigned,
    getDataURL: () => hasSigned ? canvas.toDataURL('image/png') : null,
  };
}

/* ─── Validation ─── */

function setFieldErr(inputId, errId, ok, msg) {
  const inp = document.getElementById(inputId);
  const err = document.getElementById(errId);
  if (ok) {
    if (inp) inp.classList.remove('err');
    if (err) err.style.display = 'none';
  } else {
    if (inp) inp.classList.add('err');
    if (err) { err.textContent = msg; err.style.display = ''; }
  }
}

function validateAll(showErrors) {
  if (!_locale) return [];
  const E = _locale.errors;
  const errs = [];

  const nome      = (document.getElementById('f-nome')?.value || '').trim();
  const sobrenome = (document.getElementById('f-sobrenome')?.value || '').trim();
  const docNum    = (document.getElementById('f-doc-num')?.value || '').trim();
  const email     = (document.getElementById('f-email')?.value || '').trim();
  const tel       = (document.getElementById('f-telefone')?.value || '').trim();
  const medico    = (document.getElementById('f-medico')?.value || '').trim();
  const consent   = document.getElementById('f-consent-saude')?.checked;

  function chk(inputId, errId, ok, msg) {
    if (!ok) errs.push(msg);
    if (showErrors) setFieldErr(inputId, errId, ok, msg);
  }

  chk('f-nome',      'err-nome',      nome.length > 0, E.first_name);
  chk('f-sobrenome', 'err-sobrenome', sobrenome.length > 0, E.last_name);

  if (_docType === 'cpf') {
    const cpfOk = docNum.length > 0 && validarCPF(docNum);
    chk('f-doc-num', 'err-doc', cpfOk, docNum.length === 0 ? E.doc_number : E.cpf_invalid);
  } else {
    chk('f-doc-num', 'err-doc', docNum.length > 0, E.doc_number);
  }

  chk('f-email',    'err-email',    validarEmail(email), E.email);
  chk('f-telefone', 'err-telefone', validarTelefoneFlex(tel), E.phone);
  chk('f-medico',   'err-medico',   medico.length > 0,   E.medical);

  // Quarto: opcional, mas se digitado precisa existir na lista oficial.
  const quartoRaw = (document.getElementById('f-quarto')?.value || '').trim();
  const quartoNorm = quartoRaw ? _normQuarto(quartoRaw) : '';
  if (quartoNorm) {
    const cat = _QUARTOS_CACHE ? _QUARTOS_CACHE[quartoNorm] : null;
    chk('f-quarto', 'err-quarto', !!cat, E.room_invalid || 'Quarto inexistente');
  } else {
    chk('f-quarto', 'err-quarto', true, '');
  }

  // Consent
  if (!consent) {
    errs.push(E.health_consent);
    if (showErrors) {
      const el = document.getElementById('err-consent');
      if (el) { el.textContent = E.health_consent; el.style.display = ''; }
    }
  } else {
    const el = document.getElementById('err-consent');
    if (el) el.style.display = 'none';
  }

  // Signature
  const sigOk = _sig && _sig.hasSigned();
  if (!sigOk) {
    errs.push(E.signature);
    if (showErrors) {
      const el = document.getElementById('err-sig');
      if (el) { el.textContent = E.signature; el.style.display = ''; }
    }
  } else {
    const el = document.getElementById('err-sig');
    if (el) el.style.display = 'none';
  }

  const btn = document.getElementById('btn-submit');
  if (btn) btn.disabled = errs.length > 0;
  return errs;
}

/* ─── Collect data ─── */

function collectData() {
  const facial = Array.from(document.querySelectorAll('#facial-grid .spa-pill.selected'))
    .map(p => p.dataset.label);
  const corpo  = Array.from(document.querySelectorAll('#body-grid .spa-pill.selected'))
    .map(p => p.dataset.label);

  const pressao = document.querySelector('.spa-radio-btn.selected')?.dataset?.val || null;

  const canais = [];
  if (document.getElementById('f-mkt-email')?.checked) canais.push('email');
  if (document.getElementById('f-mkt-sms')?.checked)   canais.push('sms');
  if (document.getElementById('f-mkt-wa')?.checked)    canais.push('whatsapp');

  return {
    nome:                    (document.getElementById('f-nome')?.value || '').trim(),
    sobrenome:               (document.getElementById('f-sobrenome')?.value || '').trim(),
    tipo_documento:          _docType,
    documento:               (document.getElementById('f-doc-num')?.value || '').trim(),
    email:                   (document.getElementById('f-email')?.value || '').trim(),
    telefone:                (document.getElementById('f-telefone')?.value || '').trim(),
    data_nascimento:         document.getElementById('f-nascimento')?.value || null,
    rotina_facial:           facial,
    rotina_corporal:         corpo,
    produto_especifico:      (document.getElementById('f-outro-produto')?.value || '').trim() || null,
    pressao_massagem:        pressao,
    info_medica:             (document.getElementById('f-medico')?.value || '').trim(),
    consentimento_saude:     !!document.getElementById('f-consent-saude')?.checked,
    consentimento_marketing: canais.length > 0,
    canais_marketing:        canais,
    assinatura_data_url:     _sig ? _sig.getDataURL() : null,
    idioma:                  _currentLang,
    documento_token:         _docToken,
    quarto:                  (() => { const q = (document.getElementById('f-quarto')?.value || '').trim(); return q ? _normQuarto(q) : null; })(),
    respostas_extras:        (typeof _coletarRespostasExtras === 'function') ? _coletarRespostasExtras() : {},
  };
}

/* ─── Submit ─── */

async function handleSubmit(e) {
  e.preventDefault();
  if (!_locale) return;

  const errs = validateAll(true);
  if (errs.length > 0) {
    const genErr = document.getElementById('generic-error');
    if (genErr) { genErr.textContent = _locale.errors.generic; genErr.style.display = ''; }
    const firstErrEl = document.querySelector('.spa-error-msg[style=""]');
    if (firstErrEl) firstErrEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const btn = document.getElementById('btn-submit');
  const txt = document.getElementById('btn-submit-txt');
  if (btn) btn.disabled = true;
  if (txt) txt.textContent = _locale.buttons.submitting;
  const genErr = document.getElementById('generic-error');
  if (genErr) genErr.style.display = 'none';

  try {
    const res  = await fetch('/api/spa/perfil', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectData()),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.erro || 'Erro');

    const formEl = document.getElementById('spa-form');
    const successEl = document.getElementById('spa-success');
    if (formEl) formEl.style.display = 'none';
    if (successEl) {
      successEl.style.display = '';
      setText('success-title',  _locale.success.title);
      setText('success-msg',    _locale.success.message);
      setText('success-ref-lbl', _locale.success.ref_label);
      setText('success-ref-id', '#' + json.id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  } catch {
    if (genErr) { genErr.textContent = _locale.errors.server; genErr.style.display = ''; }
    if (btn) btn.disabled = false;
    if (txt) txt.textContent = _locale.buttons.submit;
  }
}

/* ─── Apply locale to DOM ─── */

function updateDocPlaceholder() {
  if (!_locale) return;
  setPlaceholder('f-doc-num', _docType === 'cpf'
    ? _locale.doc.cpf_placeholder
    : _locale.doc.passport_placeholder);
}

function updateSigDate() {
  const el = document.getElementById('sig-date-val');
  if (!el) return;
  try {
    const tag = _currentLang === 'pt-BR' ? 'pt-BR'
      : _currentLang === 'pt-PT' ? 'pt-PT'
      : _currentLang;
    el.textContent = new Date().toLocaleDateString(tag, { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { el.textContent = new Date().toLocaleDateString(); }
}

function applyLocale(L) {
  _locale = L;
  document.getElementById('html-root').lang  = L.meta.code;
  document.getElementById('page-title').textContent = L.page_title;

  setText('lang-label-txt',  L.lang_label);
  setText('spa-title',       L.header.title);
  setText('spa-req-notice',  L.header.required_notice);
  setText('spa-intro',       L.header.intro);

  setText('sec-personal',    L.sections.personal);
  setText('sec-facial',      L.sections.facial_routine);
  setText('sec-body',        L.sections.body_routine);
  setText('sec-pressao',     L.sections.pressure);
  setText('sec-medico',      L.sections.medical);
  setText('sec-legal',       L.sections.data_notice);
  setText('sec-consents',    L.sections.consents);
  setText('sec-sig',         L.sections.signature);

  setText('lbl-nome',        L.fields.first_name);
  setText('lbl-sobrenome',   L.fields.last_name);
  setText('lbl-doc-tipo',    L.doc.type_label);
  setText('opt-cpf',         L.doc.cpf);
  setText('opt-passport',    L.doc.passport);
  setText('lbl-doc-num',     L.doc.number_label);
  setText('lbl-email',       L.fields.email);
  setText('lbl-telefone',    L.fields.phone);
  setText('lbl-nascimento',  L.fields.dob);
  setText('lbl-outro',       L.fields.other_product);
  setText('lbl-quarto',      L.fields.room || 'Quarto');
  setText('lbl-quarto-hint', L.fields.room_hint || '');

  setPlaceholder('f-email',        L.fields.email_placeholder);
  setPlaceholder('f-telefone',     L.fields.phone_placeholder);
  setPlaceholder('f-outro-produto', L.fields.other_product_placeholder);

  // Default doc type per language
  const defaultDoc = L.meta.code === 'pt-BR' ? 'cpf' : 'passport';
  if (_docType !== defaultDoc) {
    _docType = defaultDoc;
    const sel = document.getElementById('f-doc-tipo');
    if (sel) sel.value = _docType;
    const docInp = document.getElementById('f-doc-num');
    if (docInp) docInp.value = '';
  }
  updateDocPlaceholder();

  setText('pressure-hint',   L.pressure.label);
  setText('rv-light',        L.pressure.light);
  setText('rv-medium',       L.pressure.medium);
  setText('rv-firm',         L.pressure.firm);

  setText('lbl-medico',      L.medical.label);
  setPlaceholder('f-medico', L.medical.placeholder);

  setText('legal-text',      L.legal.text);

  setText('consent-decl',     L.consents.declaration);
  setText('consent-health-txt', L.consents.health);
  setText('mkt-label',        L.consents.marketing_intro);
  setText('mkt-email-lbl',    L.consents.email);

  setText('lbl-sig',          L.signature.label);
  setText('sig-instruction',  L.signature.instruction);
  setText('btn-clear-sig',    L.signature.clear);
  setText('sig-date-lbl',     L.signature.date_label);
  setText('sig-hint-text',    L.signature.instruction.toLowerCase());

  setText('btn-submit-txt',   L.buttons.submit);

  renderPills('facial-grid', L.facial_items);
  renderPills('body-grid',   L.body_items);

  updateSigDate();
  validateAll();
}

/* ─── Load locale file ─── */

async function loadLocale(lang) {
  try {
    const res = await fetch('/locales/' + lang + '.json');
    if (!res.ok) throw new Error();
    const L = await res.json();
    _currentLang = lang;
    try { localStorage.setItem('spa_lang', lang); } catch {}

    applyLocale(L);

    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });
  } catch {
    if (lang !== 'pt-BR') loadLocale('pt-BR');
  }
}

/* ─── Init ─── */

function init() {
  // Lang buttons
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => loadLocale(btn.dataset.lang));
  });

  // Doc type switch
  document.getElementById('f-doc-tipo')?.addEventListener('change', function () {
    _docType = this.value;
    const docInp = document.getElementById('f-doc-num');
    if (docInp) { docInp.value = ''; docInp.classList.remove('err'); }
    const errEl = document.getElementById('err-doc');
    if (errEl) errEl.style.display = 'none';
    updateDocPlaceholder();
    validateAll();
  });

  // CPF masking
  document.getElementById('f-doc-num')?.addEventListener('input', function () {
    if (_docType === 'cpf') {
      let v = this.value.replace(/\D/g, '').substring(0, 11);
      if (v.length > 9)      v = v.replace(/^(\d{3})(\d{3})(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
      else if (v.length > 6) v = v.replace(/^(\d{3})(\d{3})(\d{1,3})$/, '$1.$2.$3');
      else if (v.length > 3) v = v.replace(/^(\d{3})(\d{1,3})$/, '$1.$2');
      this.value = v;
    }
    validateAll();
  });

  // Standard field validation on input
  ['f-nome', 'f-sobrenome', 'f-email', 'f-telefone', 'f-medico'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => validateAll());
  });

  // Quarto: carregar lista oficial + validar em tempo real + badge Gran Class
  _carregarQuartosCli();
  const qInp = document.getElementById('f-quarto');
  const gcBadge = document.getElementById('quarto-gc-badge');
  if (qInp) {
    qInp.addEventListener('input', function () {
      const onlyDigits = this.value.replace(/\D/g, '').slice(0, 4);
      if (onlyDigits !== this.value) this.value = onlyDigits;
      if (gcBadge) gcBadge.style.display = 'none';
      if (onlyDigits.length === 4) {
        const norm = _normQuarto(onlyDigits);
        const cat = _QUARTOS_CACHE ? _QUARTOS_CACHE[norm] : null;
        if (cat === 'gran_class' && gcBadge) {
          gcBadge.innerHTML = '<span style="display:inline-flex;align-items:center;gap:.3rem;padding:.2rem .6rem;border:1px solid #c9a86a;border-radius:9999px;background:linear-gradient(180deg,#fbe9c5,#e7c682);color:#5b3d10;font-family:\'Cormorant Garamond\',Georgia,serif;font-weight:600;font-size:.78rem;letter-spacing:.06em;text-transform:uppercase">★ Gran Class</span>';
          gcBadge.style.display = '';
        }
      }
      validateAll();
    });
  }

  // Consent health checkbox
  document.getElementById('f-consent-saude')?.addEventListener('change', function () {
    document.getElementById('consent-health-wrap')?.classList.toggle('checked', this.checked);
    validateAll();
  });

  // Marketing pill checkboxes
  [['f-mkt-email', 'mkt-email-wrap'], ['f-mkt-sms', 'mkt-sms-wrap'], ['f-mkt-wa', 'mkt-wa-wrap']]
    .forEach(([cbId, wrapId]) => {
      document.getElementById(cbId)?.addEventListener('change', function () {
        document.getElementById(wrapId)?.classList.toggle('selected', this.checked);
      });
    });

  // Pressure radio
  document.querySelectorAll('.spa-radio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.spa-radio-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      btn.querySelector('input').checked = true;
    });
  });

  // Signature canvas
  _sig = initCanvas();

  // Form submit
  document.getElementById('spa-form')?.addEventListener('submit', handleSubmit);

  // Determine initial language and handle token
  let lang = 'pt-BR';
  try {
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('t');
    lang = params.get('lang') || localStorage.getItem('spa_lang') || 'pt-BR';

    if (token) {
      _docToken = token;
      fetch('/api/spa/documento?t=' + encodeURIComponent(token))
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          // BUG-A fix: token invalido/expirado nao pode TRAVAR a pagina
          // sem locale. Sempre chama loadLocale, mesmo quando d=null.
          if (d) {
            if (d.locale) lang = d.locale;
            if (d.hospede_nome) {
              const parts = d.hospede_nome.trim().split(/\s+/);
              const nomeEl = document.getElementById('f-nome');
              const sobEl  = document.getElementById('f-sobrenome');
              if (nomeEl) nomeEl.value = parts[0] || '';
              if (sobEl)  sobEl.value  = parts.slice(1).join(' ') || '';
            }
          }
          loadLocale(lang);
        })
        .catch(() => loadLocale(lang));
      return;
    }
  } catch {}

  loadLocale(lang);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/* ─── Aplicação de config dinâmica da anamnese ───
   GET /api/spa/anamnese/config retorna a estrutura da pesquisa publicada
   spa-anamnese-v1. Aplicamos APENAS as regras seguras: ocultar perguntas
   ativo=0 / ausentes, remover marcador de "obrigatório" quando obrigatoria=0,
   e sobrescrever rótulos via traduções (caso o admin tenha customizado).
   Se a fetch falhar, o HTML estático permanece inalterado (fallback). */
const _LEGADO_DOM = {
  // campo_legado → { sel: bloco a esconder/mostrar, labelId?: id do span do label }
  nome:                    { sel: '#f-nome',         labelId: 'lbl-nome' },
  sobrenome:               { sel: '#f-sobrenome',    labelId: 'lbl-sobrenome' },
  tipo_documento:          { sel: '#f-doc-tipo',     labelId: 'lbl-doc-tipo' },
  documento:               { sel: '#f-doc-num',      labelId: 'lbl-doc-num' },
  email:                   { sel: '#f-email',        labelId: 'lbl-email' },
  telefone:                { sel: '#f-telefone',     labelId: 'lbl-telefone' },
  data_nascimento:         { sel: '#f-nascimento',   labelId: 'lbl-nascimento' },
  rotina_facial:           { sectionId: 'sec-facial' },
  rotina_corporal:         { sectionId: 'sec-body' },
  produto_especifico:      { sel: '#f-outro-produto',labelId: 'lbl-outro' },
  pressao_massagem:        { sectionId: 'sec-pressao' },
  info_medica:             { sel: '#f-medico',       labelId: 'lbl-medico' },
  consentimento_saude:     { sel: '#consent-health-wrap' },
  canais_marketing:        { sel: '.spa-mkt-channels' },
  assinatura_data_url:     { sectionId: 'sec-sig' },
};

function _blocoDe(spec) {
  if (spec.sectionId) {
    const titulo = document.getElementById(spec.sectionId);
    return titulo ? titulo.closest('.spa-section') : null;
  }
  if (spec.sel) {
    const el = document.querySelector(spec.sel);
    return el ? (el.closest('.spa-field') || el.closest('.spa-section') || el) : null;
  }
  return null;
}

async function applyAnamneseConfig(idioma) {
  let cfg = null;
  try {
    const r = await fetch('/api/spa/anamnese/config?idioma=' + encodeURIComponent(idioma || 'pt-BR'));
    if (!r.ok) return;
    const d = await r.json();
    if (!d || !d.ok || !d.pesquisa) return;
    cfg = d.pesquisa;
  } catch { return; }

  // Achata perguntas mapeadas: { campo_legado: { ativo, obrigatoria, rotulo, opcoes } }
  // E coleta perguntas SEM mapeia_campo_legado (criadas pelo admin no editor):
  // essas vão para uma seção dinâmica "Perguntas adicionais".
  const map = {};
  const perguntasExtras = [];
  for (const sec of (cfg.secoes || [])) {
    for (const q of (sec.perguntas || [])) {
      const legado = q.mapeia_campo_legado;
      if (legado) {
        map[legado] = { rotulo: q.rotulo, obrigatoria: !!q.obrigatoria, opcoes: q.opcoes || null };
      } else {
        perguntasExtras.push(q);
      }
    }
  }

  // BUG-B fix: o <select #f-doc-tipo> era HTML estatico com 2 opcoes
  // hardcoded (cpf/passport). A config traz N opcoes (cpf/passaporte/rg)
  // — reescreve o select a partir da config quando ela existe.
  const docCfg = map['tipo_documento'];
  if (docCfg && Array.isArray(docCfg.opcoes) && docCfg.opcoes.length) {
    const sel = document.getElementById('f-doc-tipo');
    if (sel) {
      const prev = sel.value;
      sel.innerHTML = docCfg.opcoes.map(o =>
        `<option value="${o.chave}">${(o.rotulo || o.chave).replace(/[<>"']/g, '')}</option>`
      ).join('');
      // Mantem selecao anterior se ainda existir; senao escolhe a primeira
      if (Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
      else { sel.value = sel.options[0].value; _docType = sel.value; }
    }
  }

  for (const [legado, spec] of Object.entries(_LEGADO_DOM)) {
    const bloco = _blocoDe(spec);
    if (!bloco) continue;
    const cfgItem = map[legado];
    if (!cfgItem) {
      if (legado !== 'assinatura_data_url') bloco.style.display = 'none';
      continue;
    }
    bloco.style.display = '';
    if (spec.labelId && cfgItem.rotulo) {
      const lbl = document.getElementById(spec.labelId);
      if (lbl && cfgItem.rotulo.trim()) lbl.textContent = cfgItem.rotulo;
    }
    if (spec.labelId) {
      const lbl = document.getElementById(spec.labelId);
      const req = lbl?.parentElement?.querySelector('.req');
      if (req) req.style.display = cfgItem.obrigatoria ? '' : 'none';
    }
  }

  _renderPerguntasExtras(perguntasExtras);
}

// Renderiza perguntas customizadas (sem mapeia_campo_legado) numa seção
// dinâmica injetada ANTES da seção de assinatura. Tipos suportados:
// texto_livre, unica/escala (radio), multipla (checkbox), sim_nao.
function _renderPerguntasExtras(perguntas) {
  const wrapId = 'sec-perguntas-extras';
  let sec = document.getElementById(wrapId);
  if (sec) sec.remove();
  if (!perguntas || !perguntas.length) return;

  const secSig = document.getElementById('sec-sig')?.closest('.spa-section');
  if (!secSig) return;

  sec = document.createElement('div');
  sec.className = 'spa-section';
  sec.id = wrapId;
  sec.innerHTML = `
    <h2 class="spa-section-title">Perguntas adicionais</h2>
    <div id="perguntas-extras-grid" style="display:flex;flex-direction:column;gap:1.2rem"></div>
  `;
  secSig.parentNode.insertBefore(sec, secSig);

  const grid = sec.querySelector('#perguntas-extras-grid');
  for (const q of perguntas) {
    const wrap = document.createElement('div');
    wrap.className = 'spa-field';
    wrap.dataset.extra = q.chave;
    wrap.dataset.tipo  = q.tipo;
    const reqMark = q.obrigatoria ? ' <span class="req">*</span>' : '';
    if (q.tipo === 'texto_livre') {
      wrap.innerHTML = `
        <label class="spa-label">${_escHtml(q.rotulo)}${reqMark}</label>
        <textarea class="spa-textarea" rows="3" data-extra-input></textarea>
      `;
    } else if (q.tipo === 'unica' || q.tipo === 'escala' || q.tipo === 'sim_nao') {
      const opcoes = q.opcoes && q.opcoes.length ? q.opcoes
        : (q.tipo === 'sim_nao' ? [{ chave: 'sim', rotulo: 'Sim' }, { chave: 'nao', rotulo: 'Não' }] : []);
      const pills = opcoes.map(o => `
        <label class="spa-pill" data-extra-val="${_escHtml(o.chave)}">
          <input type="radio" name="extra_${_escHtml(q.chave)}" value="${_escHtml(o.chave)}">
          <span class="pill-dot"></span>
          <span>${_escHtml(o.rotulo)}</span>
        </label>
      `).join('');
      wrap.innerHTML = `
        <label class="spa-label">${_escHtml(q.rotulo)}${reqMark}</label>
        <div class="spa-checkbox-grid" data-extra-input>${pills}</div>
      `;
    } else if (q.tipo === 'multipla') {
      const opcoes = q.opcoes || [];
      const pills = opcoes.map(o => `
        <label class="spa-pill" data-extra-val="${_escHtml(o.chave)}">
          <input type="checkbox" value="${_escHtml(o.chave)}">
          <span class="pill-dot"></span>
          <span>${_escHtml(o.rotulo)}</span>
        </label>
      `).join('');
      wrap.innerHTML = `
        <label class="spa-label">${_escHtml(q.rotulo)}${reqMark}</label>
        <div class="spa-checkbox-grid" data-extra-input>${pills}</div>
      `;
    } else {
      wrap.innerHTML = `
        <label class="spa-label">${_escHtml(q.rotulo)}${reqMark}</label>
        <input class="spa-input" type="text" data-extra-input>
      `;
    }
    grid.appendChild(wrap);
  }

  // Wire pills (click → toggle selected + check input)
  grid.querySelectorAll('.spa-pill').forEach(p => {
    p.addEventListener('click', e => {
      e.preventDefault();
      const inp = p.querySelector('input');
      if (!inp) return;
      if (inp.type === 'radio') {
        grid.querySelectorAll(`input[name="${inp.name}"]`).forEach(i => {
          i.checked = false; i.closest('.spa-pill')?.classList.remove('selected');
        });
        inp.checked = true; p.classList.add('selected');
      } else {
        inp.checked = !inp.checked;
        p.classList.toggle('selected', inp.checked);
      }
    });
  });
}

function _escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Helper público: coleta respostas das perguntas extras para o submit.
function _coletarRespostasExtras() {
  const out = {};
  document.querySelectorAll('#perguntas-extras-grid [data-extra]').forEach(wrap => {
    const chave = wrap.dataset.extra;
    const tipo  = wrap.dataset.tipo;
    if (tipo === 'texto_livre') {
      const t = wrap.querySelector('textarea')?.value.trim() || '';
      if (t) out[chave] = t;
    } else if (tipo === 'multipla') {
      const vals = Array.from(wrap.querySelectorAll('input[type=checkbox]:checked')).map(i => i.value);
      if (vals.length) out[chave] = vals;
    } else {
      const v = wrap.querySelector('input:checked')?.value;
      if (v) out[chave] = v;
    }
  });
  return out;
}
window._coletarRespostasExtras = _coletarRespostasExtras;

// Wire-up: aplicar config após init/loadLocale ter rodado. Faz fallback
// silencioso se backend não responder — form estático original aparece.
(function () {
  const originalInit = init;
  // Substitui a referência global, mas como já chamamos init() acima,
  // forçamos apply após DOMContentLoaded de qualquer forma.
  const tentar = () => {
    const lang = _currentLang || (new URLSearchParams(location.search)).get('lang') || localStorage.getItem('spa_lang') || 'pt-BR';
    applyAnamneseConfig(lang);
  };
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(tentar, 50);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(tentar, 50));
  }
})();
