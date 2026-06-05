import { SunLogo, GranSpaWordmark, LinenBackground } from './shared.jsx';

export default function WelcomeScreen({ visible, onStart }) {
  return (
    <div className="screen min-h-screen w-full grid md:grid-cols-2" style={{ opacity: visible ? 1 : 0 }}>
      <div className="relative bg-[#F5F0E6] flex flex-col justify-end p-10 md:p-16 min-h-[42vh] md:min-h-screen order-2 md:order-1">
        <div className="absolute left-0 right-0" style={{ top: '52%', height: 24, background: '#D4953D' }}></div>
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
      <div className="relative min-h-[58vh] md:min-h-screen flex overflow-hidden order-1 md:order-2" style={{ background: '#EAE3D7' }}>
        <LinenBackground />
        <div className="absolute pointer-events-none" style={{ inset: 20, border: '1px solid rgba(255,255,255,0.55)' }}></div>
        <div className="relative z-10 w-full flex flex-col items-center px-6 py-14 md:py-16">
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <GranSpaWordmark style={{ fontSize: 'clamp(38px, 6.4vw, 78px)' }} />
            <div className="serif" style={{ fontStyle: 'italic', fontWeight: 400, color: '#7A6A55', fontSize: 'clamp(20px, 2.8vw, 34px)', marginTop: 6, letterSpacing: '0.01em' }}>
              by L&rsquo;Occitane
            </div>
          </div>
          <div className="w-full max-w-sm">
            <button className="band-cta" onClick={onStart} aria-label="Iniciar avaliação da experiência no Gran SPA">
              <div className="flex items-center justify-center" style={{ background: '#D4953D', minHeight: 70 }}>
                <div className="flex flex-col items-center" style={{ color: '#FFFFFF', padding: '0 22px', letterSpacing: '0.22em', fontWeight: 500, fontSize: 16, lineHeight: 1.45, textAlign: 'center' }}>
                  <span>AVALIE SUA</span>
                  <span>EXPERIÊNCIA</span>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
