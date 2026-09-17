async function startCheckout(body) {
  const response = await fetch('/checkout/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Erro ao iniciar doação.' }));
    alert(error.message || 'Erro ao iniciar doação.');
    return;
  }
  const { checkoutUrl } = await response.json();
  window.location.href = checkoutUrl;
}

function onFixedDonationClick(priceId) {
  startCheckout({ productType: 'fixed', priceId });
}

function onCustomDonationSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('custom-amount');
  const amountReais = parseFloat(input.value);
  if (Number.isNaN(amountReais) || amountReais <= 0) {
    alert('Informe um valor válido.');
    return;
  }
  const amountCents = Math.round(amountReais * 100);
  startCheckout({ productType: 'custom', amountCents });
}

document.addEventListener('DOMContentLoaded', () => {
  const fixedButton = document.getElementById('fixed-donation-button');
  if (fixedButton) {
    fixedButton.addEventListener('click', () => onFixedDonationClick('price_allowed_1'));
  }
  const customForm = document.getElementById('custom-form');
  if (customForm) {
    customForm.addEventListener('submit', onCustomDonationSubmit);
  }
});
