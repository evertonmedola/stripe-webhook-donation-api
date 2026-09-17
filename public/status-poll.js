const MAX_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2000;

async function pollOrderStatus(orderId) {
  const statusEl = document.getElementById('status-message');
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    try {
      const response = await fetch(`/orders/${orderId}/status`);
      if (response.ok) {
        const { status } = await response.json();
        if (status === 'paid') {
          statusEl.textContent = 'Doação confirmada! Obrigado.';
          return;
        }
        if (status === 'failed') {
          statusEl.textContent = 'O pagamento não foi concluído.';
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
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order');
  if (orderId) {
    pollOrderStatus(orderId);
  }
});
