const FIXED_AMOUNT_REAIS = '20,00';

function formatReais(amountReais) {
  return amountReais.toFixed(2).replace('.', ',').padStart(6, '0');
}

function renderCounter(counterEl, digitsEl, valueString) {
  const chars = valueString.split('');
  const existing = Array.from(digitsEl.children);

  if (existing.length !== chars.length) {
    digitsEl.innerHTML = chars
      .map((ch) => (ch === ',' ? `<span class="digit-sep">${ch}</span>` : `<span class="digit">${ch}</span>`))
      .join('');
    return;
  }

  chars.forEach((ch, i) => {
    const el = existing[i];
    if (el.textContent !== ch) {
      el.textContent = ch;
      if (el.classList.contains('digit')) {
        el.classList.remove('is-ticking');
        // restart the animation even if it was mid-flight
        void el.offsetWidth;
        el.classList.add('is-ticking');
      }
    }
  });
}

function showMessage(el, text) {
  el.textContent = text;
  el.classList.add('is-visible', 'is-error');
}

function clearMessage(el) {
  el.textContent = '';
  el.classList.remove('is-visible', 'is-error');
}

function setLoading(button, loading) {
  button.disabled = loading;
  button.classList.toggle('is-loading', loading);
}

async function startCheckout(body, triggerButton, messageEl, displayAmount) {
  clearMessage(messageEl);
  setLoading(triggerButton, true);
  try {
    const response = await fetch('/checkout/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Erro ao iniciar doação.' }));
      showMessage(messageEl, error.message || 'Erro ao iniciar doação.');
      setLoading(triggerButton, false);
      return;
    }
    const { checkoutUrl } = await response.json();
    try {
      sessionStorage.setItem('donationAmountDisplay', displayAmount);
    } catch {
      // sessionStorage unavailable (private mode, etc.): success page falls back to a default display
    }
    window.location.href = checkoutUrl;
  } catch {
    showMessage(messageEl, 'Não foi possível conectar. Verifique sua conexão e tente novamente.');
    setLoading(triggerButton, false);
  }
}

function onFixedDonationClick(priceId, button, messageEl) {
  startCheckout({ productType: 'fixed', priceId }, button, messageEl, FIXED_AMOUNT_REAIS);
}

function onCustomDonationSubmit(event, form, messageEl) {
  event.preventDefault();
  const input = document.getElementById('custom-amount');
  const amountReais = parseFloat(input.value);
  if (Number.isNaN(amountReais) || amountReais <= 0) {
    showMessage(messageEl, 'Informe um valor válido.');
    return;
  }
  const amountCents = Math.round(amountReais * 100);
  const submitButton = form.querySelector('button[type="submit"]');
  startCheckout({ productType: 'custom', amountCents }, submitButton, messageEl, formatReais(amountReais));
}

document.addEventListener('DOMContentLoaded', () => {
  const counterEl = document.getElementById('amount-counter');
  const digitsEl = document.getElementById('counter-digits');
  const customInput = document.getElementById('custom-amount');

  if (counterEl && digitsEl && customInput) {
    customInput.addEventListener('input', () => {
      const value = parseFloat(customInput.value);
      const display = Number.isFinite(value) && value >= 0 ? formatReais(value) : FIXED_AMOUNT_REAIS;
      renderCounter(counterEl, digitsEl, display);
    });
    customInput.addEventListener('blur', () => {
      if (!customInput.value) {
        renderCounter(counterEl, digitsEl, FIXED_AMOUNT_REAIS);
      }
    });
  }

  const fixedButton = document.getElementById('fixed-donation-button');
  const fixedMessage = document.getElementById('fixed-donation-message');
  if (fixedButton && fixedMessage) {
    fixedButton.addEventListener('click', () =>
      onFixedDonationClick('price_1UGVKsPZIC97Rc8FKldtX4jf', fixedButton, fixedMessage),
    );
  }

  const customForm = document.getElementById('custom-form');
  const customMessage = document.getElementById('custom-donation-message');
  if (customForm && customMessage) {
    customForm.addEventListener('submit', (event) => onCustomDonationSubmit(event, customForm, customMessage));
  }
});
