import { t } from './i18n'
import {
    forgetEncryptedSessionPassphrase,
    readEncryptedSessionPassphrase,
    rememberEncryptedSessionPassphrase
} from './encrypted-session'
import { bindStaticImageLoadFrames, syncThemeImages } from './image-loading'

interface EncryptedPayload {
    version: 1
    format: 'html'
    algorithm: 'AES-GCM'
    kdf: 'PBKDF2'
    hash: 'SHA-256'
    iterations: number
    salt: string
    iv: string
    ciphertext: string
}

export function bindEncryptedContent() {
    document.querySelectorAll<HTMLElement>('[data-encrypted-content]').forEach(bindEncryptedBlock)
}

function bindEncryptedBlock(section: HTMLElement) {
    const lockedPanel = section.querySelector<HTMLElement>('.encrypted-content__panel--locked')
    const form = lockedPanel?.querySelector<HTMLFormElement>('.encrypted-content__form')
    const input = form?.querySelector<HTMLInputElement>('.encrypted-content__input')
    const button = form?.querySelector<HTMLButtonElement>('.encrypted-content__button')
    const message = lockedPanel?.querySelector<HTMLElement>('.encrypted-content__message')
    const payload = section.dataset.payload ?? ''
    const cacheKey = section.dataset.cacheKey ?? ''
    if (!lockedPanel || !form || !input || !button || !message || !payload) return

    let unbindImages = () => {}
    const showError = (text: string) => {
        message.textContent = text
        message.hidden = !text
    }
    const lock = () => {
        unbindImages()
        unbindImages = () => {}
        forgetEncryptedSessionPassphrase(cacheKey)
        input.value = ''
        showError('')
        section.replaceChildren(lockedPanel)
    }
    const unlock = async (passphrase: string, remember: boolean, silent = false) => {
        if (!passphrase.trim()) {
            if (!silent) showError(t('请输入口令。', 'Enter a passphrase.'))
            return
        }

        button.disabled = true
        button.textContent = t('解密中…', 'Decrypting…')
        if (!silent) showError('')
        try {
            const html = await decryptPayload(payload, passphrase)
            if (remember) rememberEncryptedSessionPassphrase(cacheKey, passphrase)
            const panel = document.createElement('div')
            panel.className = 'encrypted-content__panel encrypted-content__panel--unlocked'
            panel.innerHTML = `<div class="encrypted-content__toolbar"><span class="encrypted-content__status-icon encrypted-content__status-icon--success" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M9 10V7.5a4 4 0 1 1 8 0" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path><rect x="5" y="10" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"></rect></svg></span><button class="encrypted-content__secondary" type="button">${t('重新上锁', 'Lock again')}</button></div><div class="encrypted-content__body vp-doc"></div>`
            const body = panel.querySelector<HTMLElement>('.encrypted-content__body')!
            body.innerHTML = html
            panel.querySelector<HTMLButtonElement>('.encrypted-content__secondary')!.addEventListener('click', lock)
            section.replaceChildren(panel)
            syncThemeImages(body, document.documentElement.classList.contains('dark'))
            unbindImages = bindStaticImageLoadFrames(body)
            input.value = ''
        } catch {
            forgetEncryptedSessionPassphrase(cacheKey)
            if (!silent)
                showError(t('口令错误，或密文已经损坏。', 'Incorrect passphrase or damaged encrypted content.'))
        } finally {
            button.disabled = false
            button.textContent = t('解密', 'Decrypt')
        }
    }

    if (!window.crypto?.subtle) {
        button.disabled = true
        showError(
            t(
                '当前浏览器不支持 Web Crypto，无法在前端完成解密。',
                'This browser does not support Web Crypto and cannot decrypt this content.'
            )
        )
        return
    }

    form.addEventListener('submit', (event) => {
        event.preventDefault()
        void unlock(input.value, true)
    })
    const cached = readEncryptedSessionPassphrase(cacheKey)
    if (cached) void unlock(cached, false, true)
}

function decodeBase64Url(value: string) {
    if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Invalid base64url')
    const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/')
    const binary = window.atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4))
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function parsePayload(encoded: string): EncryptedPayload {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded)))
    if (
        !parsed ||
        typeof parsed !== 'object' ||
        (parsed as EncryptedPayload).version !== 1 ||
        (parsed as EncryptedPayload).format !== 'html' ||
        (parsed as EncryptedPayload).algorithm !== 'AES-GCM' ||
        (parsed as EncryptedPayload).kdf !== 'PBKDF2' ||
        (parsed as EncryptedPayload).hash !== 'SHA-256' ||
        !Number.isInteger((parsed as EncryptedPayload).iterations) ||
        (parsed as EncryptedPayload).iterations < 1 ||
        (parsed as EncryptedPayload).iterations > 10_000_000
    ) {
        throw new Error('Unsupported payload')
    }
    return parsed as EncryptedPayload
}

async function decryptPayload(encoded: string, passphrase: string) {
    const payload = parsePayload(encoded)
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey']
    )
    const key = await window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: decodeBase64Url(payload.salt),
            iterations: payload.iterations,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    )
    const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: decodeBase64Url(payload.iv) },
        key,
        decodeBase64Url(payload.ciphertext)
    )
    return new TextDecoder().decode(decrypted)
}
