import { SunLogo, GranSpaWordmark, LinenBackground } from './shared.jsx';

function _tokenValido(tokenData) {
  if (!tokenData) return false;
  if (!tokenData.liberada_em) return true;
  const lib = new Date(tokenData.liberada_em.replace(' ', 'T') + 'Z').getTime();
  return Date.now() < lib + 15 * 60 * 1000;
}

export default function WelcomeScreen({ visible, onStart, tokenData }) {
  const ativo = _tokenValido(tokenData);
  return (
    <div className="screen min-h-screen w-full grid md:grid-cols-2" style={{ opacity: visible ? 1 : 0 }}>
      <div className="relative bg-[#ECE4D2] flex flex-col justify-end p-12 md:p-20 min-h-[42vh] md:min-h-screen order-2 md:order-1">
        <div className="absolute left-0 right-0" style={{ top: '52%', height: 24, background: '#9C5843' }}></div>
        <div className="relative z-10">
          <div className="flex items-center gap-4">
            <SunLogo size={52} color="#6B6B6B" />
            <div style={{ lineHeight: 1.18 }}>
              <div style={{ fontSize: 12, letterSpacing: '0.34em', color: '#6B6B6B', fontWeight: 300 }}>HOTEL</div>
              <div style={{ fontSize: 19, letterSpacing: '0.18em', color: '#4A4A4A', fontWeight: 300 }}>GRAN&nbsp;MARQUISE</div>
            </div>
          </div>
          <div style={{ marginTop: 22, fontSize: 12.5, color: '#6B6B6B', fontWeight: 300, lineHeight: 1.9 }}>
            <div>Av. Beira Mar, 3980</div>
            <div>(85) 4006-5000</div>
            <div>www.granmarquise.com.br</div>
          </div>
        </div>
      </div>
      <div className="relative min-h-[58vh] md:min-h-screen flex overflow-hidden order-1 md:order-2" style={{ background: '#E3DACC' }}>
        <LinenBackground />
        <div className="absolute pointer-events-none" style={{ inset: 28, border: '1px solid rgba(255,255,255,0.55)' }}></div>
        <div className="relative z-10 w-full flex flex-col items-center px-8 md:px-12 py-16 md:py-24">
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <GranSpaWordmark style={{ fontSize: 'clamp(38px, 6.4vw, 78px)' }} />
            <div style={{ fontStyle: 'italic', fontWeight: 400, color: '#7A6B5A', fontSize: 'clamp(20px, 2.8vw, 34px)', marginTop: 6, letterSpacing: '0.01em', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
              by L&rsquo;Occitane
            </div>
          </div>
          <div className="w-full max-w-sm" style={{ marginBottom: 'clamp(8px, 2vh, 28px)' }}>
            {ativo ? (
              <button className="band-cta" onClick={onStart} aria-label="Iniciar avaliação da experiência no Gran SPA">
                <div className="flex items-center justify-center" style={{ background: '#9C5843', minHeight: 70 }}>
                  <div className="flex flex-col items-center" style={{ color: '#FFFFFF', padding: '0 22px', letterSpacing: '0.22em', fontWeight: 500, fontSize: 16, lineHeight: 1.45, textAlign: 'center' }}>
                    <span>AVALIE SUA</span>
                    <span>EXPERIÊNCIA</span>
                  </div>
                </div>
              </button>
            ) : (
              <div style={{ textAlign: 'center', color: '#8A7B6A', fontSize: 12.5, letterSpacing: '0.08em', lineHeight: 1.8, paddingTop: 8 }}>
                Nenhuma avaliação disponível<br />no momento.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
