// ── Confirm dialog utility ────────────────────────────────────────────────────
// Dynamically creates and reuses a single <sl-dialog> element.
// Shoelace must already be registered (imported in main.js before use).
//
// Returns a Promise<string> resolving to the clicked button's label,
// or the default ('Cancel' if present, else last button) when dismissed
// via ESC or the dialog's built-in close button.

export function showConfirmDialog({ message, buttons }) {
  return new Promise(resolve => {
    // Reuse a single dialog element across calls
    let dialog = document.getElementById('jsanalyst-confirm-dialog')
    if (!dialog) {
      dialog = document.createElement('sl-dialog')
      dialog.id = 'jsanalyst-confirm-dialog'
      document.body.appendChild(dialog)
    }

    dialog.label = 'Confirm'
    dialog.innerHTML = ''

    const msgEl = document.createElement('p')
    msgEl.style.margin = '0 0 0.5em 0'
    msgEl.textContent = message
    dialog.appendChild(msgEl)

    const footer = document.createElement('div')
    footer.setAttribute('slot', 'footer')
    footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end'
    dialog.appendChild(footer)

    // Default choice when dialog is dismissed without a button click
    let choice = buttons.includes('Cancel') ? 'Cancel' : buttons[buttons.length - 1]

    for (const btn of buttons) {
      const el = document.createElement('button')
      el.textContent = btn
      const isPrimary = btn === buttons[0]
      el.style.cssText = [
        'padding:5px 14px',
        'border-radius:4px',
        'border:1px solid var(--border,#45475a)',
        `background:${isPrimary ? 'var(--blue,#89b4fa)' : 'var(--bg-overlay,#313244)'}`,
        `color:${isPrimary ? 'var(--bg,#1e1e2e)' : 'var(--text,#cdd6f4)'}`,
        'font-family:var(--font-ui,system-ui)',
        'font-size:12px',
        'cursor:pointer',
      ].join(';')
      el.addEventListener('click', () => {
        choice = btn
        dialog.hide()
      })
      footer.appendChild(el)
    }

    // sl-after-hide fires after every close (button click or ESC/X)
    const onHide = () => {
      dialog.removeEventListener('sl-after-hide', onHide)
      resolve(choice)
    }
    dialog.addEventListener('sl-after-hide', onHide)
    dialog.show()
  })
}
