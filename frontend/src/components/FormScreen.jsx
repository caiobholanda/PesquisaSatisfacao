import { useState, useRef, useEffect } from 'react';
import {
  RATINGS, SERVICES, FACILITIES,
  FieldLabel, SectionHeading, ScaleBar, RatingRow, RadioOption,
  AutoTextarea, MassagistaAutocomplete,
} from './shared.jsx';

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const isTel   = (s) => /^[\d\s\-\+\(\)]{6,20}$/.test(s.trim());

function FieldErr({ msg }) {
  return msg ? <p className="field-err" role="alert">{msg}</p> : null;
}

export default function FormScreen({ visible, onSubmit, onBack, prefill = null }) {
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
  const [fills,         setFills]         = useState([0, 0, 0, 0]);
  const [submitting,    setSubmitting]    = useState(false);
  const [submitError,   setSubmitError]   = useState('');

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
    if (!fields.nome.trim()) errs.nome = 'Nome é obrigatório.';
    if (!isEmail(fields.email)) errs.email = 'Informe um e-mail válido.';
    if (fields.tel.trim() && !isTel(fields.tel)) errs.tel = 'Telefone inválido.';
    if (!clientType) errs.clientType = 'Selecione o tipo de cliente.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      const refs = [['nome', refNome], ['email', refEmail], ['clientType', refClient]];
      const first = refs.find(([k]) => errs[k]);
      if (first?.[1].current) {
        const y = first[1].current.getBoundingClientRect().top + window.scrollY - 130;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
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
              <FieldLabel htmlFor="f-nome" pt="Nome *" en="Name" />
              <input
                id="f-nome"
                value={fields.nome}
                onChange={(e) => set('nome', e.target.value)}
                onBlur={() => { if (!fields.nome.trim()) setErrors(e => ({ ...e, nome: 'Nome é obrigatório.' })); else setErrors(e => { const n = { ...e }; delete n.nome; return n; }); }}
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
              <FieldLabel htmlFor="f-email" pt="E-mail *" en="E-mail" />
              <input
                id="f-email"
                type="email"
                value={fields.email}
                onChange={(e) => set('email', e.target.value)}
                onBlur={() => { if (!isEmail(fields.email)) setErrors(e => ({ ...e, email: 'Informe um e-mail válido.' })); else setErrors(e => { const n = { ...e }; delete n.email; return n; }); }}
                aria-describedby={errors.email ? 'err-email' : undefined}
                aria-required="true"
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
          <SectionHeading num="1" pt="Serviços" en="Services" />
          <ScaleBar />
          <div className="rating-list">
            {SERVICES.map((q) => (
              <RatingRow key={q.id} q={q} value={ratings[q.id]} onPick={(v) => pick(q.id, v)} />
            ))}
          </div>
          <div className="field comment-field">
            <FieldLabel htmlFor="f-com-serv" pt="Comentário e sugestões adicionais" en="Additional comments and suggestions:" />
            <AutoTextarea id="f-com-serv" value={comentarioServicos} onChange={setComentarioServicos} placeholder="Opcional..." />
            <span className="fill"></span>
          </div>
        </section>

        <section ref={secRefs[1]} className="enter">
          <SectionHeading num="2" pt="Instalações" en="Facilities" />
          <ScaleBar />
          <div className="rating-list">
            {FACILITIES.map((q) => (
              <RatingRow key={q.id} q={q} value={ratings[q.id]} onPick={(v) => pick(q.id, v)} />
            ))}
          </div>
          <div className="field comment-field">
            <FieldLabel htmlFor="f-com-inst" pt="Comentário e sugestões adicionais" en="Additional comments and suggestions:" />
            <AutoTextarea id="f-com-inst" value={comentarioInstalacoes} onChange={setComentarioInstalacoes} placeholder="Opcional..." />
            <span className="fill"></span>
          </div>
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
          <SectionHeading num="4" pt="Tipo de cliente *" en="Type of guest" />
          <div ref={refClient} className="client-type" role="group" aria-label="Tipo de cliente" aria-required="true">
            <RadioOption checked={clientType === 'lazer'}    onClick={() => setClientType('lazer')}    pt="Lazer"    en="Leisure" />
            <RadioOption checked={clientType === 'negocios'} onClick={() => setClientType('negocios')} pt="Negócios" en="Business" />
            <RadioOption checked={clientType === 'evento'}   onClick={() => setClientType('evento')}   pt="Evento"   en="Event" />
          </div>
          {errors.clientType && <div className="err-msg" role="alert">{errors.clientType} / Please select a guest type.</div>}
        </section>

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
