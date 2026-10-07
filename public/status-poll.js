const MAX_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2000;
const FALLBACK_DISPLAY = '20,00';

function renderCounter(digitsEl, valueString) {
  digitsEl.innerHTML = valueString
    .split('')
    .map((ch) => (ch === ',' ? `<span class="digit-sep">${ch}</span>` : `<span class="digit">${ch}</span>`))
    .join('');
}

async function pollOrderStatus(orderId) {
  const statusEl = document.getElementById('status-message');
  const counterEl = document.getElementById('amount-counter');
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    try {
      const response = await fetch(`/orders/${orderId}/status`);
      if (response.ok) {
        const { status } = await response.json();
        if (status === 'paid') {
          statusEl.textContent = 'Doação confirmada! Obrigado.';
          counterEl.classList.add('is-confirmed');
          return;
        }
        if (status === 'failed') {
          statusEl.textContent = 'O pagamento não foi concluído.';
          counterEl.classList.add('is-failed');
          return;
        }
      }
    } catch {
      // network hiccup: keep polling, never surface as a hard error
    }
    attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  statusEl.textContent = 'Ainda processando — você receberá a confirmação por e-mail em breve.';
}

document.addEventListener('DOMContentLoaded', () => {
  const digitsEl = document.getElementById('counter-digits');
  if (digitsEl) {
    let display = FALLBACK_DISPLAY;
    try {
      display = sessionStorage.getItem('donationAmountDisplay') || FALLBACK_DISPLAY;
    } catch {
      // sessionStorage unavailable: keep the fallback display
    }
    renderCounter(digitsEl, display);
  }

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order');
  if (orderId) {
    pollOrderStatus(orderId);
  }
});
