document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const dangerButton = form.querySelector("button.danger");
  if (dangerButton && !window.confirm("Continue with this change?")) {
    event.preventDefault();
  }
});

const formatMoney = (value) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));

const formatAccountingMoney = (value) => {
  const numeric = Number(value || 0);
  const formatted = formatMoney(Math.abs(numeric));
  return numeric < 0 ? `(${formatted})` : formatted;
};

const toCents = (value) => Math.round(Number(value || 0) * 100);

const updateReconciliationForm = (form) => {
  const startingCents = toCents(form.dataset.startingBalance);
  const selectedCents = [...form.querySelectorAll("[data-reconcile-transaction]:checked")].reduce(
    (sum, input) => sum + toCents(input.dataset.amount),
    0
  );
  const endingInput = form.querySelector("[data-ending-balance]");
  const endingCents = toCents(endingInput?.value);
  const calculatedCents = startingCents + selectedCents;
  const differenceCents = endingCents - calculatedCents;

  const endingDisplay = form.querySelector("[data-statement-ending]");
  const calculatedDisplay = form.querySelector("[data-calculated-balance]");
  const differenceDisplay = form.querySelector("[data-reconcile-difference]");
  const completeButton = form.querySelector("[data-complete-reconciliation]");

  if (endingDisplay) endingDisplay.textContent = formatMoney(endingCents / 100);
  if (calculatedDisplay) calculatedDisplay.textContent = formatMoney(calculatedCents / 100);
  if (differenceDisplay) {
    differenceDisplay.textContent = formatAccountingMoney(differenceCents / 100);
    differenceDisplay.classList.toggle("positive", differenceCents === 0);
    differenceDisplay.classList.toggle("negative", differenceCents !== 0);
  }
  if (completeButton instanceof HTMLButtonElement) {
    completeButton.disabled = differenceCents !== 0;
  }
};

document.querySelectorAll("[data-reconcile-form]").forEach((form) => {
  updateReconciliationForm(form);
  form.addEventListener("input", () => updateReconciliationForm(form));
  form.addEventListener("change", () => updateReconciliationForm(form));
});
