// In-page replacement for prompt(), which some embedded and installed browsers block.
// Resolves with the typed text, or null if cancelled.
export function ask(label, value = '') {
  const dialog = document.getElementById('ask-dialog')
  const input = document.getElementById('ask-input')
  if (dialog.open) return Promise.resolve(null)
  document.getElementById('ask-label').textContent = label
  input.value = value
  dialog.returnValue = ''
  dialog.showModal()
  input.select()
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? input.value : null), { once: true })
  })
}
