import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export const RATINGS = [
  { key: 'otimo', pt: 'Ótimo', en: 'Excellent', type: 'great' },
  { key: 'bom', pt: 'Bom', en: 'Good', type: 'good' },
  { key: 'regular', pt: 'Regular', en: 'Fair', type: 'fair' },
  { key: 'ruim', pt: 'Ruim', en: 'Poor', type: 'poor' },
];

export const SERVICES = [
  { id: 's0', pt: 'A expectativa do tratamento', en: 'Your expectations.' },
  { id: 's1', pt: 'A explicação da massoterapeuta sobre os benefícios e procedimentos', en: "The massage therapist's explanation about the benefits and procedures." },
  { id: 's2', pt: 'A atitude e a qualidade dos serviços prestados pela massoterapeuta', en: 'The attitude and the quality of the services provided by the massage therapist.' },
  { id: 's3', pt: 'A técnica e a habilidade da massoterapeuta', en: "The massage therapist's technique and ability." },
];

export const FACILITIES = [
  { id: 'f0', pt: 'Conforto e conservação da estrutura do SPA', en: 'SPA comfort and cleanliness.' },
  { id: 'f1', pt: 'Organização da sala, equipamentos e a atmosfera do ambiente', en: 'Room organization, equipment and atmosphere.' },
  { id: 'f2', pt: 'Os itens de conveniência (roupões, toalhas, etc) fornecidos durante o tratamento foram suficientes', en: 'Were the convenience items (bathrobes, towels, etc.) provided during treatment sufficient?' },
];

export function SunLogo({ size = 48, color = '#6B6B6B', strokeWidth = 0.8 }) {
  const N = 28;
  const rays = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r1 = 9, r2 = 21;
    rays.push(
      <line key={i}
        x1={24 + Math.cos(a) * r1} y1={24 + Math.sin(a) * r1}
        x2={24 + Math.cos(a) * r2} y2={24 + Math.sin(a) * r2}
        stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    );
  }
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      <circle cx="24" cy="24" r="6" fill="none" stroke={color} strokeWidth="1" />
      {rays}
    </svg>
  );
}

export function GranSpaWordmark({ style = {} }) {
  return (
    <span style={{ fontWeight: 300, letterSpacing: '0.16em', whiteSpace: 'nowrap', fontFamily: "'Inter', sans-serif", ...style }}>
      <span style={{ color: '#4A4A4A' }}>GRAN</span>
      <span style={{ color: '#C97A3D', marginLeft: '0.34em' }}>SPA</span>
    </span>
  );
}

export function Smiley({ type = 'great', size = 36, color = '#6B6B6B', filled = false, strokeWidth = 2 }) {
  const stroke = filled ? '#FFFFFF' : color;
  const mouths = {
    great: 'M11.5 23 Q20 33 28.5 23',
    good: 'M12.5 24.5 Q20 29.5 27.5 24.5',
    fair: 'M13 26 H27',
    poor: 'M12.5 28.5 Q20 22.5 27.5 28.5',
  };
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="17" fill={filled ? '#D4953D' : 'none'} stroke={stroke} strokeWidth={strokeWidth} />
      <circle cx="14.6" cy="16.4" r="1.7" fill={stroke} />
      <circle cx="25.4" cy="16.4" r="1.7" fill={stroke} />
      <path d={mouths[type]} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}

export function LinenBackground() {
  return (
    <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <pattern id="linen" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill="#EAE3D7" />
          <path d="M0 0 H6" stroke="#E8DCC4" strokeWidth="1.4" />
          <path d="M0 3 H6" stroke="#E2D6BE" strokeWidth="0.6" opacity="0.5" />
          <path d="M0 0 V6" stroke="#E8DCC4" strokeWidth="1.4" />
          <path d="M3 0 V6" stroke="#E2D6BE" strokeWidth="0.6" opacity="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#linen)" />
    </svg>
  );
}

export function FieldLabel({ htmlFor, pt, en }) {
  return (
    <label htmlFor={htmlFor} style={{ marginBottom: 5, lineHeight: 1.3, display: 'block' }}>
      <span style={{ fontSize: 13.5, color: '#4A4A4A', letterSpacing: '0.005em' }}>{pt}</span>{' '}
      {en && <span className="en" style={{ fontSize: 12 }}>{en}</span>}
    </label>
  );
}

export function SectionHeading({ num, pt, en }) {
  return (
    <div className="sec-heading">
      <span className="sec-num">{num}</span>
      <span className="sec-title">{pt}</span>
      <span className="en sec-title-en">{en}</span>
    </div>
  );
}

export function ScaleBar({ i18n = null }) {
  const ratingLabel = (key, fallback) => (i18n?.ratings?.[key]) || fallback;
  return (
    <div className="scale-bar">
      <div className="scale-bar-title">
        <span>Como você classifica:</span>
        {!i18n?.suppressEn && <span className="en" style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>Your rating:</span>}
      </div>
      <div className="scale-bar-legend">
        {RATINGS.map((r) => (
          <div key={r.key} className="scale-legend-item">
            <Smiley type={r.type} size={30} color="#FFFFFF" />
            <div className="scale-legend-label">
              <span>{ratingLabel(r.key, r.pt)}</span>
              {!i18n?.suppressEn && <span className="en" style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10.5 }}>{r.en}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RatingRow({ q, value, onPick }) {
  return (
    <div className="rating-row">
      <div className="rating-text">
        <span style={{ color: '#1A1A1A', fontSize: 15.5 }}>{q.pt}</span>{' '}
        <span className="en" style={{ fontSize: 13 }}>{q.en}</span>
      </div>
      <div className="rating-smileys" role="group" aria-label={q.pt}>
        {RATINGS.map((r) => {
          const selected = value === r.key;
          return (
            <button key={r.key} type="button" aria-label={r.pt} aria-pressed={selected}
              className={'smiley-btn ease-spa' + (selected ? ' selected' : '')}
              onClick={() => onPick(r.key)}>
              <Smiley type={r.type} size={36} color="#9A9A9A" filled={selected} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RadioOption({ checked, onClick, pt, en, children }) {
  return (
    <div>
      <button type="button" className="radio-opt" onClick={onClick} aria-pressed={checked}>
        <span className={'radio-dot ease-spa' + (checked ? ' on' : '')}></span>
        <span>
          <span style={{ color: '#1A1A1A' }}>{pt}</span>{' '}
          {en && <span className="en" style={{ fontSize: 13 }}>{en}</span>}
        </span>
      </button>
      {checked && children}
    </div>
  );
}

export function AutoTextarea({ id, value, onChange, placeholder, ariaRequired, ariaInvalid, ariaDescribedby }) {
  const ref = useRef(null);
  const resize = () => {
    const el = ref.current;
    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
  };
  useEffect(resize, [value]);
  return (
    <textarea
      id={id}
      ref={ref}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      aria-required={ariaRequired || undefined}
      aria-invalid={ariaInvalid || undefined}
      aria-describedby={ariaDescribedby}
      style={{ overflow: 'hidden', resize: 'none' }}
    />
  );
}

export function MassagistaAutocomplete({ id, value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);

  const filtered = value.trim()
    ? options.filter(n => n.toLowerCase().includes(value.toLowerCase()))
    : options;

  function calcPos() {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, width: r.width });
  }

  useEffect(() => { if (open) calcPos(); }, [open, value]);

  useEffect(() => {
    function onDoc(e) {
      const inWrap = wrapRef.current && wrapRef.current.contains(e.target);
      const inPortal = e.target.closest && e.target.closest('.massag-list');
      if (!inWrap && !inPortal) setOpen(false);
    }
    function onScroll() { if (open) calcPos(); }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const dropdown = open && options.length > 0 && pos
    ? createPortal(
        <div className="massag-list" style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}>
          {filtered.length > 0
            ? filtered.map(n => (
                <div key={n} className="massag-option"
                  onMouseDown={e => { e.preventDefault(); onChange(n); setOpen(false); }}
                >{n}</div>
              ))
            : <div className="massag-empty">Nenhum resultado</div>
          }
        </div>,
        document.body
      )
    : null;

  return (
    <div className="massag-wrap" ref={wrapRef}>
      <input
        id={id}
        ref={inputRef}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Tab') setOpen(false); }}
        autoComplete="off"
      />
      {options.length > 0 && (
        <button type="button" className="massag-toggle" tabIndex={-1}
          onMouseDown={e => { e.preventDefault(); setOpen(o => !o); }}
          aria-label="Expandir lista">
          <svg width="11" height="7" viewBox="0 0 11 7" fill="none" aria-hidden="true">
            <path d="M1 1L5.5 5.5L10 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}
      {dropdown}
    </div>
  );
}
