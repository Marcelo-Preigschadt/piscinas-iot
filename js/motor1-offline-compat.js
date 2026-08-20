(() => {
  function liberarMotor1() {
    document
      .querySelectorAll('.multi-motor-card[data-canal="1"] .multi-motor-buttons button')
      .forEach((botao) => {
        if (botao.disabled) botao.disabled = false;
      });
  }

  const observer = new MutationObserver(() => liberarMotor1());
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled']
  });

  document.addEventListener('visibilitychange', liberarMotor1);
  setInterval(liberarMotor1, 500);
  liberarMotor1();
})();
