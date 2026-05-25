document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const dangerButton = form.querySelector("button.danger");
  if (dangerButton && !window.confirm("Continue with this change?")) {
    event.preventDefault();
  }
});
