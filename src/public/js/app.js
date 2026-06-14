document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const dangerButton = form.querySelector("button.danger, button[data-confirm]");
  const message = dangerButton?.dataset.confirm || "Continue with this change?";
  if (dangerButton && !window.confirm(message)) {
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
  const transactionInputs = [...form.querySelectorAll("[data-reconcile-transaction]")];
  let lastClickedTransaction = null;

  updateReconciliationForm(form);
  form.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.matches("[data-reconcile-transaction]")) return;

    if (event.shiftKey && lastClickedTransaction) {
      const lastIndex = transactionInputs.indexOf(lastClickedTransaction);
      const targetIndex = transactionInputs.indexOf(target);
      const rangeStart = Math.min(lastIndex, targetIndex);
      const rangeEnd = Math.max(lastIndex, targetIndex);

      transactionInputs.slice(rangeStart, rangeEnd + 1).forEach((input) => {
        input.checked = target.checked;
      });
      updateReconciliationForm(form);
    }

    lastClickedTransaction = target;
  });
  form.addEventListener("input", () => updateReconciliationForm(form));
  form.addEventListener("change", () => updateReconciliationForm(form));
});

const importFilterButtons = [...document.querySelectorAll("[data-import-filter]")];
const importPreviewRows = [...document.querySelectorAll("[data-import-preview-row]")];
const importFilterEmpty = document.querySelector("[data-import-filter-empty]");

importFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.importFilter;
    let visibleRows = 0;

    importPreviewRows.forEach((row) => {
      const visible = filter === "all" || row.dataset.importRowState === filter;
      row.hidden = !visible;
      if (visible) visibleRows += 1;
    });

    importFilterButtons.forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle("active", active);
      candidate.setAttribute("aria-pressed", String(active));
    });
    if (importFilterEmpty) importFilterEmpty.hidden = visibleRows !== 0;
  });
});

const categoryRows = [...document.querySelectorAll("[data-category-id][draggable='true']")];
const categorySortStatus = document.querySelector("[data-category-sort-status]");
let draggedCategoryRow = null;

const saveCategoryOrder = async () => {
  if (!categoryRows.length) return;
  const categoryIds = [...document.querySelectorAll("[data-category-id][draggable='true']")].map(
    (row) => row.dataset.categoryId
  );

  if (categorySortStatus) {
    categorySortStatus.textContent = "Saving category order...";
    categorySortStatus.classList.remove("error");
  }

  try {
    const response = await fetch("/categories/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryIds })
    });
    if (!response.ok) throw new Error("Could not save category order.");
    if (categorySortStatus) categorySortStatus.textContent = "Category order saved.";
  } catch (error) {
    if (categorySortStatus) {
      categorySortStatus.textContent = error instanceof Error ? error.message : "Could not save category order.";
      categorySortStatus.classList.add("error");
    }
  }
};

categoryRows.forEach((row) => {
  row.addEventListener("dragstart", () => {
    draggedCategoryRow = row;
    row.classList.add("dragging");
  });

  row.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (!draggedCategoryRow || draggedCategoryRow === row) return;
    row.classList.add("drag-over");
  });

  row.addEventListener("dragleave", () => row.classList.remove("drag-over"));

  row.addEventListener("drop", (event) => {
    event.preventDefault();
    row.classList.remove("drag-over");
    if (!draggedCategoryRow || draggedCategoryRow === row) return;

    const body = row.parentElement;
    const rows = [...body.querySelectorAll("[data-category-id][draggable='true']")];
    const draggedIndex = rows.indexOf(draggedCategoryRow);
    const targetIndex = rows.indexOf(row);
    body.insertBefore(draggedCategoryRow, draggedIndex < targetIndex ? row.nextSibling : row);
    saveCategoryOrder();
  });

  row.addEventListener("dragend", () => {
    row.classList.remove("dragging");
    document.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over"));
    draggedCategoryRow = null;
  });
});
