import { verifyOpenTimestamp } from './open-timestamps'

export function bindLedger() {
    document.querySelectorAll<HTMLButtonElement>('[data-ledger-verify]').forEach((button) => {
        button.addEventListener('click', () => void verify(button))
    })
}

async function verify(button: HTMLButtonElement) {
    if (button.disabled) return
    const status = button.closest('.ledger-proof')?.querySelector<HTMLElement>('.ledger-proof__verification')
    const proofUrl = button.dataset.proofUrl
    const sha256 = button.dataset.sha256
    if (!status || !proofUrl || !sha256) return

    button.disabled = true
    button.setAttribute('aria-busy', 'true')
    button.textContent = 'Verifying…'
    status.hidden = false
    status.className = 'ledger-proof__verification ledger-proof__verification--loading'
    status.textContent = 'Checking the digest, timestamp proof, and Bitcoin block…'

    try {
        const result = await verifyOpenTimestamp(proofUrl, sha256)
        status.className = `ledger-proof__verification ledger-proof__verification--${result.status}`
        if (result.status === 'pending') {
            status.textContent =
                'Pending — the proof matches this digest, but no Bitcoin attestation is available yet. Try again later.'
        } else {
            const link = document.createElement('a')
            link.href = result.blockUrl
            link.target = '_blank'
            link.rel = 'noreferrer'
            link.textContent = `Bitcoin block #${result.blockHeight}`
            const time = new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'medium',
                timeZone: 'UTC'
            }).format(new Date(result.blockTime * 1000))
            status.replaceChildren('Verified — anchored in ', link, ` at ${time} UTC using Blockstream data.`)
        }
    } catch (error) {
        status.className = 'ledger-proof__verification ledger-proof__verification--error'
        status.textContent = `Verification failed — ${error instanceof Error ? error.message : 'The proof could not be checked. Try again.'}`
    } finally {
        button.disabled = false
        button.removeAttribute('aria-busy')
        button.textContent = 'Verify again'
    }
}
