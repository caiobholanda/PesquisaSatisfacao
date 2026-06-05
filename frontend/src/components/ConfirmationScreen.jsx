export default function ConfirmationScreen({ visible, onRestart }) {
  return (
    <div className="screen confirm-wrap" style={{ opacity: visible ? 1 : 0 }} aria-live="polite">
      <div className="confirm-band"></div>
      <h1 className="serif confirm-obrigado">Obrigado.</h1>
      <p className="confirm-sub">
        Por compartilhar sua experiência conosco.<br />Esperamos vê-lo em breve no Gran SPA.
      </p>
      <button className="back-btn ease-spa" onClick={onRestart}>Voltar ao início</button>
    </div>
  );
}
