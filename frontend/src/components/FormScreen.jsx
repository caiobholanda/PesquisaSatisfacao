import { useState, useRef, useEffect } from 'react';
import {
  RATINGS, SERVICES, FACILITIES,
  FieldLabel, SectionHeading, ScaleBar, RatingRow, RadioOption,
  AutoTextarea, MassagistaAutocomplete, Smiley,
} from './shared.jsx';

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const isTel   = (s) => /^[\d\s\-\+\(\)]{6,20}$/.test(s.trim());

function FieldErr({ msg }) {
  return msg ? <p className="field-err" role="alert">{msg}</p> : null;
}

const TIME_LIMIT = 15 * 60 * 1000;

// Fallbacks de opcoes quando o admin nao definiu — coerentes com o tipo.
const _OPCOES_FALLBACK = {
  sim_nao: [{ chave: 'sim', rotulo: 'Sim' }, { chave: 'nao', rotulo: 'Não' }],
  escala:  [
    { chave: 'otimo',    rotulo: 'Ótimo' },
    { chave: 'bom',      rotulo: 'Bom' },
    { chave: 'regular',  rotulo: 'Regular' },
    { chave: 'ruim',     rotulo: 'Ruim' },
  ],
};

// Renderiza UMA pergunta extra (adicionada pelo admin no editor).
// Extraido para que possa ser reutilizado pelo renderer ordenado das
// secoes Servicos/Instalacoes que interleva legacy + extras pela ordem.
function SingleExtraItem({ pergunta: p, valores, setValor, err, fieldId }) {
  const reqMark = p.obrigatoria ? <span className="req-star"> *</span> : null;
  const errId = err ? `${fieldId}-err` : undefined;
  if (p.tipo === 'texto_livre') {
    return (
      <div className={'field comment-field' + (err ? ' error' : '')} data-extra-chave={p.chave}>
        <label className="field-label" htmlFor={fieldId}>{p.rotulo}{reqMark}</label>
        <textarea
          id={fieldId}
          value={valores[p.chave]?.valor || ''}
          onChange={e => setValor(p.chave, { tipo: 'texto_livre', valor: e.target.value })}
          rows={3}
          placeholder="..."
          aria-required={p.obrigatoria || undefined}
          aria-invalid={!!err || undefined}
          aria-describedby={errId}
        />
        <span className="fill"></span>
        {err && <p id={errId} className="field-err" role="alert">{err}</p>}
      </div>
    );
  }
  if (p.tipo === 'unica' || p.tipo === 'sim_nao' || p.tipo === 'escala') {
    const opcoes = (p.opcoes && p.opcoes.length) ? p.opcoes
      : (_OPCOES_FALLBACK[p.tipo] || _OPCOES_FALLBACK.sim_nao);
    const cur = valores[p.chave]?.valor || '';
    const ehRostos = p.tipo === 'escala'
      && opcoes.length === 4
      && opcoes.every(o => ['otimo','bom','regular','ruim'].includes(o.chave));
    if (ehRostos) {
      const fakeQ = { id: p.chave, pt: p.rotulo, en: '' };
      return (
        <div data-extra-chave={p.chave} className={err ? 'extras-rostos-err' : ''}>
          <RatingRow q={fakeQ} value={cur} onPick={(v) => setValor(p.chave, { tipo: 'escala', valor: v })} />
          {err && <p id={errId} className="field-err" role="alert" style={{marginTop:8}}>{err}</p>}
        </div>
      );
    }
    return (
      <div className={'field' + (err ? ' error' : '')} data-extra-chave={p.chave}>
        <span className="field-label" id={fieldId + '-lbl'}>{p.rotulo}{reqMark}</span>
        <div className="radio-list extras-opts" role="radiogroup" aria-labelledby={fieldId + '-lbl'} aria-required={p.obrigatoria || undefined} aria-describedby={errId}>
          {opcoes.map(o => (
            <label key={o.chave} className={'radio-opt' + (cur === o.chave ? ' selected' : '')}>
              <input
                type="radio"
                name={'x_' + p.chave}
                checked={cur === o.chave}
                onChange={() => setValor(p.chave, { tipo: p.tipo, valor: o.chave })}
              />
              <span>{o.rotulo}</span>
            </label>
          ))}
        </div>
        {err && <p id={errId} className="field-err" role="alert">{err}</p>}
      </div>
    );
  }
  if (p.tipo === 'multipla') {
    const opcoes = p.opcoes || [];
    const cur = Array.isArray(valores[p.chave]?.valor) ? valores[p.chave].valor : [];
    if (!opcoes.length) {
      return (
        <div className="field" data-extra-chave={p.chave}>
          <span className="field-label">{p.rotulo}{reqMark}</span>
          <p style={{ fontSize: 13, color: '#9B9B9B', fontStyle: 'italic' }}>
            (sem opções configuradas)
          </p>
        </div>
      );
    }
    const toggle = (k) => {
      setValor(p.chave, (prev) => {
        const prevArr = Array.isArray(prev?.valor) ? prev.valor : [];
        const next = prevArr.includes(k) ? prevArr.filter(x => x !== k) : [...prevArr, k];
        return { tipo: 'multipla', valor: next };
      });
    };
    return (
      <div className={'field' + (err ? ' error' : '')} data-extra-chave={p.chave}>
        <span className="field-label" id={fieldId + '-lbl'}>{p.rotulo}{reqMark}</span>
        <div className="radio-list extras-opts" role="group" aria-labelledby={fieldId + '-lbl'} aria-required={p.obrigatoria || undefined} aria-describedby={errId}>
          {opcoes.map(o => (
            <label key={o.chave} className={'radio-opt' + (cur.includes(o.chave) ? ' selected' : '')}>
              <input type="checkbox" checked={cur.includes(o.chave)} onChange={() => toggle(o.chave)} />
              <span>{o.rotulo}</span>
            </label>
          ))}
        </div>
        {err && <p id={errId} className="field-err" role="alert">{err}</p>}
      </div>
    );
  }
  return (
    <div className={'field' + (err ? ' error' : '')} data-extra-chave={p.chave}>
      <label className="field-label" htmlFor={fieldId}>{p.rotulo}{reqMark}</label>
      <input
        id={fieldId}
        value={valores[p.chave]?.valor || ''}
        onChange={e => setValor(p.chave, { tipo: 'texto_livre', valor: e.target.value })}
        aria-required={p.obrigatoria || undefined}
        aria-invalid={!!err || undefined}
        aria-describedby={errId}
      />
      <span className="fill"></span>
      {err && <p id={errId} className="field-err" role="alert">{err}</p>}
    </div>
  );
}

// Renderiza perguntas extras (adicionadas pelo admin no editor) para uma
// secao especifica. O estado fica em FormScreen via setExtras.
function ExtrasSecao({ perguntas, valores, setValor, errors = {}, sectionPrefix = 'x' }) {
  if (!perguntas || !perguntas.length) return null;
  return (
    <div className="extras-block">
      {perguntas.map((p, idx) => (
        <SingleExtraItem
          key={p.chave}
          pergunta={p}
          valores={valores}
          setValor={setValor}
          err={errors[p.chave]}
          fieldId={`xf-${sectionPrefix}-${idx}-${p.chave}`}
        />
      ))}
    </div>
  );
}

export default function FormScreen({ visible, onSubmit, onBack, prefill = null, formStart = null, onTimeout, i18n = null, extrasPorSecao = [], secoesOrdenadas = [], pesquisaVersao = null }) {
  // Quando a reserva está num idioma diferente de pt-BR, sobrescrevemos os
  // rótulos das perguntas e os nomes das classificações com o que veio do
  // backend (traduzido). O 2º idioma (EN) some — fica só o idioma do hóspede.
  const tr = (id, fallback) => (i18n?.labels?.[id]) || fallback;
  const trRating = (key, fallback) => (i18n?.ratings?.[key]) || fallback;
  const ordOf = (id) => (i18n?.legacyOrder?.[id] ?? 99);
  const services = SERVICES.map(s => ({ ...s, pt: tr(s.id, s.pt), en: i18n?.suppressEn ? '' : s.en }))
    .sort((a, b) => ordOf(a.id) - ordOf(b.id));
  const facilities = FACILITIES.map(s => ({ ...s, pt: tr(s.id, s.pt), en: i18n?.suppressEn ? '' : s.en }))
    .sort((a, b) => ordOf(a.id) - ordOf(b.id));

  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [massagistasOpts, setMassagistasOpts] = useState([]);
  const [tiposOpts,       setTiposOpts]       = useState([]);

  const [fields, setFields] = useState({
    nome: prefill?.nome || '',
    apto: prefill?.tipo_cliente === 'passante' ? 'Passante' : (prefill?.apto || ''),
    email: prefill?.email || '',
    tel: prefill?.telefone || '',
    tratamento: prefill?.tratamento || '',
    massoterapeuta: prefill?.massoterapeuta || '',
  });
  const [ratings,               setRatings]               = useState({});
  const [comentarioServicos,    setComentarioServicos]    = useState('');
  const [comentarioInstalacoes, setComentarioInstalacoes] = useState('');
  const [recommend,     setRecommend]     = useState('');
  const [recommendText, setRecommendText] = useState('');
  const [clientType,    setClientType]    = useState(prefill?.tipo_cliente || '');
  const [errors,        setErrors]        = useState({});
  // extras: { chave_pergunta: { tipo, valor } } — para perguntas adicionadas
  // pelo admin no editor. Renderizadas dentro da secao original sem rotulo
  // de "adicional".
  const [extras, setExtras] = useState({});
  const [extrasErrors, setExtrasErrors] = useState({});
  const setExtraVal = (chave, payloadOrUpdater) => setExtras(prev => {
    const next = typeof payloadOrUpdater === 'function' ? payloadOrUpdater(prev[chave]) : payloadOrUpdater;
    return { ...prev, [chave]: next };
  });
  const extrasDe = (secaoChave) => (extrasPorSecao || []).find(s => s.chave === secaoChave)?.perguntas || [];
  const [fills,         setFills]         = useState([0, 0, 0, 0]);
  const [submitting,    setSubmitting]    = useState(false);
  const [submitError,   setSubmitError]   = useState('');
  const [timeLeft,      setTimeLeft]      = useState(TIME_LIMIT);

  const load = () => {
    setLoading(true);
    setLoadError(false);
    Promise.all([
      fetch('/api/massagistas-ativas').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch('/api/tipos-massagem-ativos').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    ])
      .then(([m, t]) => {
        if (m.nomes) setMassagistasOpts(m.nomes);
        if (t.nomes) setTiposOpts(t.nomes);
        setLoading(false);
      })
      .catch(() => { setLoadError(true); setLoading(false); });
  };

  useEffect(load, []);

  useEffect(() => {
    if (!formStart) return;
    const tick = () => {
      const remaining = Math.max(0, TIME_LIMIT - (Date.now() - formStart));
      setTimeLeft(remaining);
      if (remaining === 0 && onTimeout) onTimeout();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [formStart]);

  const set = (k, v) => setFields((f) => ({ ...f, [k]: v }));
  const pick = (id, v) => setRatings((r) => ({ ...r, [id]: v }));

  const refNome = useRef(null), refEmail = useRef(null), refClient = useRef(null);
  const secRefs = [useRef(null), useRef(null), useRef(null), useRef(null)];

  const allGreatKeys = [...SERVICES, ...FACILITIES].map((q) => q.id);
  const allGreat = allGreatKeys.every((k) => ratings[k] === 'otimo');

  useEffect(() => {
    const onScroll = () => {
      const mid = window.scrollY + window.innerHeight * 0.45;
      setFills(secRefs.map((r) => {
        if (!r.current) return 0;
        const top = r.current.offsetTop;
        const h = r.current.offsetHeight;
        return Math.min(1, Math.max(0, (mid - top) / h));
      }));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);

  const handleSubmit = async () => {
    const errs = {};
    // Campos basicos obrigatorios:
    if (!fields.nome.trim()) errs.nome = 'Informe seu nome.';
    if (!fields.email.trim()) errs.email = 'Informe seu e-mail.';
    else if (!isEmail(fields.email)) errs.email = 'E-mail inválido.';
    if (fields.tel.trim() && !isTel(fields.tel)) errs.tel = 'Telefone inválido.';

    // Ratings obrigatorios (7 notas das secoes Servicos e Instalacoes)
    const ratingIds = ['s0','s1','s2','s3','f0','f1','f2'];
    const ratingsMissing = ratingIds.filter(id => !ratings[id]);
    if (ratingsMissing.length) errs.ratings = `Avalie todas as ${ratingIds.length} perguntas de Serviços e Instalações.`;

    // Recomendacao
    if (!recommend) errs.recommend = 'Indique se recomendaria nossos serviços.';

    // Tipo de cliente
    if (!clientType) errs.clientType = 'Selecione o tipo de cliente.';

    // Valida extras obrigatorias
    const extErrs = {};
    for (const grupo of (extrasPorSecao || [])) {
      for (const p of grupo.perguntas) {
        if (!p.obrigatoria) continue;
        const v = extras[p.chave]?.valor;
        const vazio = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
        if (vazio) extErrs[p.chave] = 'Responda esta pergunta.';
      }
    }
    setExtrasErrors(extErrs);
    setErrors(errs);

    if (Object.keys(errs).length || Object.keys(extErrs).length) {
      // Pega o PRIMEIRO erro na ordem visual da pagina e rola ate ele.
      // Prioridade: nome/email > ratings > recommend > clientType > extras.
      let target = null;
      if (errs.nome) target = refNome?.current;
      else if (errs.email) target = refEmail?.current;
      else if (errs.ratings) target = secRefs[0]?.current; // Secao Servicos
      else if (errs.recommend) target = secRefs[2]?.current;
      else if (errs.clientType) target = refClient?.current;
      else if (Object.keys(extErrs).length) {
        const firstChave = Object.keys(extErrs)[0];
        target = document.querySelector(`[data-extra-chave="${firstChave}"]`);
      }
      if (target?.getBoundingClientRect) {
        const y = target.getBoundingClientRect().top + window.scrollY - 130;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
      // Mostra resumo geral no topo via submitError (alem dos campos)
      const msgs = [];
      if (errs.nome || errs.email || errs.tel) msgs.push('Preencha seu nome e e-mail corretamente.');
      if (errs.ratings) msgs.push(errs.ratings);
      if (errs.recommend) msgs.push(errs.recommend);
      if (errs.clientType) msgs.push(errs.clientType);
      if (Object.keys(extErrs).length) msgs.push('Responda as perguntas obrigatórias destacadas.');
      setSubmitError(msgs.join(' '));
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    const payload = {
      origem: 'hospede',
      nome: fields.nome,
      apto: fields.apto || null,
      email: fields.email,
      telefone: fields.tel || null,
      data_tratamento: prefill?.data || new Date().toISOString().slice(0, 10),
      tratamento_realizado: fields.tratamento || null,
      nome_massoterapeuta: fields.massoterapeuta || null,
      servicos_expectativa: ratings['s0'] || null,
      servicos_explicacao:  ratings['s1'] || null,
      servicos_atitude:     ratings['s2'] || null,
      servicos_tecnica:     ratings['s3'] || null,
      servicos_comentario: comentarioServicos || null,
      instalacoes_conforto:      ratings['f0'] || null,
      instalacoes_organizacao:   ratings['f1'] || null,
      instalacoes_conveniencia:  ratings['f2'] || null,
      instalacoes_comentario: comentarioInstalacoes || null,
      recomenda: recommend || null,
      recomenda_qual:   recommend === 'sim' ? (recommendText || null) : null,
      recomenda_porque: recommend === 'nao' ? (recommendText || null) : null,
      tipo_cliente: clientType,
      pesquisa_slug: 'spa-locc-v1',
      pesquisa_versao: pesquisaVersao || undefined,
      extras: Object.keys(extras).length ? extras : undefined,
    };
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSubmitError(data.error || data.erro || 'Erro ao enviar. Tente novamente.');
        setSubmitting(false);
        return;
      }
      onSubmit();
    } catch {
      setSubmitError('Erro de conexão. Verifique sua internet e tente novamente.');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="load-screen">
        <div className="load-spinner"></div>
        <p className="load-label">Carregando...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="load-screen">
        <p style={{ color: '#6B6B6B', fontSize: 15, textAlign: 'center', maxWidth: 340, lineHeight: 1.7 }}>
          Não foi possível carregar o formulário.<br />Verifique sua conexão e tente novamente.
        </p>
        <button className="eb-btn" style={{ marginTop: 24 }} onClick={load}>Tentar novamente</button>
      </div>
    );
  }

  // Renderiza itens da secao (Servicos/Instalacoes) na ordem definida pelo
  // admin. Interleva ratings legacy (s0-s3 / f0-f2), comentarios e extras
  // (perguntas adicionadas pelo admin) pela coluna `ordem` do backend.
  const renderSectionItems = (chave) => {
    const sec = (secoesOrdenadas || []).find(s => s.chave === chave);
    if (!sec || !sec.perguntas?.length) return null;
    const fallbackArr = chave === 'servicos' ? SERVICES : FACILITIES;
    const comentarioVal = chave === 'servicos' ? comentarioServicos : comentarioInstalacoes;
    const setComentarioVal = chave === 'servicos' ? setComentarioServicos : setComentarioInstalacoes;
    const comentarioEn = 'Additional comments and suggestions:';
    // Agrupa ratings consecutivos num unico .rating-list para preservar o
    // visual de lista coesa. Quebra o grupo ao encontrar comentario/extra.
    const blocks = [];
    let currentRatings = null;
    for (const p of sec.perguntas) {
      const fb = p.legacy_id ? fallbackArr.find(x => x.id === p.legacy_id) : null;
      if (p.kind === 'rating-legacy' && fb) {
        if (!currentRatings) { currentRatings = []; blocks.push({ type: 'ratings', items: currentRatings }); }
        currentRatings.push({ p, fb });
      } else if (p.kind === 'extra' && p.tipo === 'escala' && p.opcoes?.length === 4 && p.opcoes.every(o => ['otimo','bom','regular','ruim'].includes(o.chave))) {
        if (!currentRatings) { currentRatings = []; blocks.push({ type: 'ratings', items: currentRatings }); }
        currentRatings.push({ p, fb: null });
      } else {
        currentRatings = null;
        blocks.push({ type: p.kind, p });
      }
    }
    return blocks.map((b, bi) => {
      if (b.type === 'ratings') {
        return (
          <div key={`r-${bi}`} className="rating-list">
            {b.items.map(({ p, fb }) => {
              if (fb) {
                const q = {
                  id: p.legacy_id,
                  pt: p.rotulo || fb.pt,
                  en: i18n?.suppressEn ? '' : fb.en,
                };
                return <RatingRow key={p.legacy_id} q={q} value={ratings[p.legacy_id]} onPick={(v) => pick(p.legacy_id, v)} />;
              }
              // extra rostos
              const fakeQ = { id: p.chave, pt: p.rotulo, en: '' };
              const cur = extras[p.chave]?.valor || '';
              return (
                <div key={p.chave} data-extra-chave={p.chave} className={extrasErrors[p.chave] ? 'extras-rostos-err' : ''}>
                  <RatingRow q={fakeQ} value={cur} onPick={(v) => setExtraVal(p.chave, { tipo: 'escala', valor: v })} />
                  {extrasErrors[p.chave] && <p className="field-err" role="alert" style={{marginTop:8}}>{extrasErrors[p.chave]}</p>}
                </div>
              );
            })}
          </div>
        );
      }
      if (b.type === 'comentario') {
        return (
          <div key={`c-${bi}-${b.p.chave}`} className="field comment-field">
            <FieldLabel htmlFor={`f-com-${chave}`} pt={b.p.rotulo || 'Comentário e sugestões adicionais'} en={i18n?.suppressEn ? '' : comentarioEn} />
            <AutoTextarea id={`f-com-${chave}`} value={comentarioVal} onChange={setComentarioVal} placeholder="Opcional..." />
            <span className="fill"></span>
          </div>
        );
      }
      // extra
      return (
        <SingleExtraItem
          key={`e-${bi}-${b.p.chave}`}
          pergunta={b.p}
          valores={extras}
          setValor={setExtraVal}
          err={extrasErrors[b.p.chave]}
          fieldId={`xf-${chave}-${bi}-${b.p.chave}`}
        />
      );
    });
  };

  return (
    <div className="screen" style={{ opacity: visible ? 1 : 0 }}>
      <div className="progress-bar">
        <div className="progress-top">
          <button className="btn-voltar" onClick={onBack} aria-label="Voltar à tela inicial">
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
              <path d="M5 1L1 5L5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Voltar
          </button>
          <div className={`timer-display${timeLeft < 2 * 60 * 1000 ? ' urgent' : ''}`} aria-live="polite" aria-label="Tempo restante">
            {String(Math.floor(timeLeft / 60000)).padStart(2, '0')}:{String(Math.floor((timeLeft % 60000) / 1000)).padStart(2, '0')}
          </div>
        </div>
        <div className="progress-inner" aria-hidden="true">
          {fills.map((f, i) => (
            <div key={i} className="trace"><div className="tf" style={{ width: f * 100 + '%' }}></div></div>
          ))}
        </div>
      </div>

      <div className="form-wrap">
        <header className="enter" style={{ animationDelay: '0ms', textAlign: 'center' }}>
          <h1 className="form-title">Formulário de Feedback de Serviço</h1>
          <p className="form-intro">
            Para que possamos continuar nos aperfeiçoando, gostaríamos que você respondesse as perguntas abaixo
            assinalando a opção apropriada. Apreciamos seu feedback.
          </p>
          <p className="form-intro en">
            Share your experience with us. Client Feedback Form. In order to continue improving our services, we
            would like you to answer the following questions by selecting the appropriate checkbox. We appreciate your feedback.
          </p>
        </header>

        <section className="enter" style={{ animationDelay: '180ms' }}>
          <div className="field-grid">
            <div className={'field' + (errors.nome ? ' error' : '')} ref={refNome}>
              <FieldLabel htmlFor="f-nome" pt="Nome" en="Name" />
              <input
                id="f-nome"
                value={fields.nome}
                onChange={(e) => set('nome', e.target.value)}

                aria-describedby={errors.nome ? 'err-nome' : undefined}
                aria-required="true"
              />
              <span className="fill"></span>
              <FieldErr msg={errors.nome} />
            </div>
            <div className="field">
              <FieldLabel htmlFor="f-apto" pt="Nº do Apto" en="Room number" />
              <input id="f-apto" value={fields.apto} onChange={(e) => set('apto', e.target.value)} />
              <span className="fill"></span>
            </div>
            <div className={'field' + (errors.email ? ' error' : '')} ref={refEmail}>
              <FieldLabel htmlFor="f-email" pt="E-mail" en="E-mail" />
              <input
                id="f-email"
                type="email"
                value={fields.email}
                onChange={(e) => set('email', e.target.value)}
                onBlur={() => { if (fields.email.trim() && !isEmail(fields.email)) setErrors(e => ({ ...e, email: 'E-mail inválido.' })); else setErrors(e => { const n = { ...e }; delete n.email; return n; }); }}
                aria-describedby={errors.email ? 'err-email' : undefined}
              />
              <span className="fill"></span>
              <FieldErr msg={errors.email} />
            </div>
            <div className={'field' + (errors.tel ? ' error' : '')}>
              <FieldLabel htmlFor="f-tel" pt="Tel / WhatsApp" en="Phone" />
              <input
                id="f-tel"
                type="tel"
                value={fields.tel}
                onChange={(e) => set('tel', e.target.value)}
                onBlur={() => { if (fields.tel.trim() && !isTel(fields.tel)) setErrors(e => ({ ...e, tel: 'Telefone inválido.' })); else setErrors(e => { const n = { ...e }; delete n.tel; return n; }); }}
                placeholder="+55 (85) 9 9999-9999"
              />
              <span className="fill"></span>
              <FieldErr msg={errors.tel} />
            </div>
            <div className="field">
              <FieldLabel pt="Data" en="Date" />
              <div style={{ padding: '8px 2px', fontSize: 16, color: '#9B9B9B', borderBottom: '1px solid #E4DAC6', userSelect: 'none' }}>
                {new Date((prefill?.data || new Date().toISOString().slice(0, 10)) + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </div>
            </div>
            <div className="field">
              <FieldLabel htmlFor="f-tratamento" pt="Tratamento realizado" en="Spa treatment provided" />
              <MassagistaAutocomplete
                id="f-tratamento"
                value={fields.tratamento}
                onChange={v => set('tratamento', v)}
                options={tiposOpts}
              />
              <span className="fill"></span>
            </div>
            <div className="field field-full">
              <FieldLabel htmlFor="f-massag" pt="Nome da massoterapeuta" en="Massage therapist's name" />
              <MassagistaAutocomplete
                id="f-massag"
                value={fields.massoterapeuta}
                onChange={v => set('massoterapeuta', v)}
                options={massagistasOpts}
              />
              <span className="fill"></span>
            </div>
          </div>
        </section>

        <section ref={secRefs[0]} className="enter" style={{ animationDelay: '270ms' }}>
          <SectionHeading num="1" pt={i18n?.sectionTitles?.servicos || 'Serviços'} en={i18n?.suppressEn ? '' : 'Services'} />
          <ScaleBar i18n={i18n} />
          {renderSectionItems('servicos') || (
            <>
              <div className="rating-list">
                {services.map((q) => (
                  <RatingRow key={q.id} q={q} value={ratings[q.id]} onPick={(v) => pick(q.id, v)} />
                ))}
              </div>
              <div className="field comment-field">
                <FieldLabel htmlFor="f-com-serv" pt="Comentário e sugestões adicionais" en={i18n?.suppressEn ? '' : 'Additional comments and suggestions:'} />
                <AutoTextarea id="f-com-serv" value={comentarioServicos} onChange={setComentarioServicos} placeholder="Opcional..." />
                <span className="fill"></span>
              </div>
              <ExtrasSecao perguntas={extrasDe('servicos')} valores={extras} setValor={setExtraVal} errors={extrasErrors} sectionPrefix="servicos" />
            </>
          )}
        </section>

        <section ref={secRefs[1]} className="enter">
          <SectionHeading num="2" pt={i18n?.sectionTitles?.instalacoes || 'Instalações'} en={i18n?.suppressEn ? '' : 'Facilities'} />
          <ScaleBar i18n={i18n} />
          {renderSectionItems('instalacoes') || (
            <>
              <div className="rating-list">
                {facilities.map((q) => (
                  <RatingRow key={q.id} q={q} value={ratings[q.id]} onPick={(v) => pick(q.id, v)} />
                ))}
              </div>
              <div className="field comment-field">
                <FieldLabel htmlFor="f-com-inst" pt="Comentário e sugestões adicionais" en="Additional comments and suggestions:" />
                <AutoTextarea id="f-com-inst" value={comentarioInstalacoes} onChange={setComentarioInstalacoes} placeholder="Opcional..." />
                <span className="fill"></span>
              </div>
              <ExtrasSecao perguntas={extrasDe('instalacoes')} valores={extras} setValor={setExtraVal} errors={extrasErrors} sectionPrefix="instalacoes" />
            </>
          )}
        </section>

        <section ref={secRefs[2]}>
          <SectionHeading num="3" pt="Você recomendaria algum tratamento em particular?" en="Would you recommend any particular treatment?" />
          <div className="radio-list">
            <RadioOption checked={recommend === 'sim'} onClick={() => setRecommend('sim')} pt="Sim" en="Yes — Qual? / Which?">
              <div className="field inline-reveal">
                <input value={recommendText} onChange={(e) => setRecommendText(e.target.value)} placeholder="Qual tratamento? / Which one?" aria-label="Qual tratamento recomendaria?" />
                <span className="fill"></span>
              </div>
            </RadioOption>
            <RadioOption checked={recommend === 'nao'} onClick={() => setRecommend('nao')} pt="Não" en="No — Porque? / Why?">
              <div className="field inline-reveal">
                <input value={recommendText} onChange={(e) => setRecommendText(e.target.value)} placeholder="Por quê? / Why not?" aria-label="Por que não recomendaria?" />
                <span className="fill"></span>
              </div>
            </RadioOption>
          </div>
        </section>

        <section ref={secRefs[3]}>
          <SectionHeading num="4" pt="Tipo de cliente" en="Type of guest" />
          <div ref={refClient} className="client-type" role="group" aria-label="Tipo de cliente">
            <RadioOption checked={clientType === 'lazer'}    onClick={() => setClientType('lazer')}    pt="Lazer"    en="Leisure" />
            <RadioOption checked={clientType === 'negocios'} onClick={() => setClientType('negocios')} pt="Negócios" en="Business" />
            <RadioOption checked={clientType === 'evento'}   onClick={() => setClientType('evento')}   pt="Evento"   en="Event" />
          </div>
        </section>

        {/* Secoes adicionais criadas pelo admin no editor — aparecem como
            secoes regulares (sem rotulo de "adicional"), com o titulo da
            propria secao definido pelo admin. Tambem skipa secao 'recomenda'
            (renderizada pelos componentes hardcoded acima). */}
        {(extrasPorSecao || [])
          .filter(g => !['servicos','instalacoes','recomenda'].includes(g.chave) && g.perguntas?.length)
          .map((g, idx) => (
            <section key={g.chave || idx} className="enter" style={{ animationDelay: `${360 + idx * 90}ms` }}>
              <SectionHeading num={5 + idx} pt={g.titulo || ''} en="" />
              <ExtrasSecao perguntas={g.perguntas} valores={extras} setValor={setExtraVal} errors={extrasErrors} sectionPrefix={g.chave || 'sec'} />
            </section>
          ))}

        <footer className="form-foot">
          <p style={{ marginBottom: 18 }}>
            Obrigado por contribuir com o nosso sistema de melhoria.<br />
            <span className="en">Thank you for taking the time to evaluate us.</span>
          </p>
          <p className="serif" style={{ fontStyle: 'italic', color: '#6B6B6B', fontSize: 18, marginBottom: 14 }}>Atenciosamente,</p>
          <p>
            <span style={{ fontWeight: 500, color: '#B8924A' }}>Equipe do Gran SPA by L&rsquo;Occitane</span><br />
            <span className="en">Gran SPA by L&rsquo;Occitane team</span>
          </p>
        </footer>

        {allGreat && (
          <p className="easter serif">Ficamos honrados em receber sua visita.</p>
        )}

        <div className="submit-wrap">
          {submitError && <div className="submit-err" role="alert">{submitError}</div>}
          <button className="submit-btn ease-spa" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Enviando...' : 'Enviar avaliação'}
          </button>
        </div>

        <div className="page-foot">
          <div>Hotel Gran Marquise · Av. Beira Mar, 3980 · Fortaleza-CE · (85) 4006-5000 · www.granmarquise.com.br</div>
        </div>
      </div>
    </div>
  );
}
