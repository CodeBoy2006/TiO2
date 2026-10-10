const sessionPassphrases = new Map<string, string>()

export function readEncryptedSessionPassphrase(cacheKey: string) {
    return cacheKey ? (sessionPassphrases.get(cacheKey) ?? '') : ''
}

export function rememberEncryptedSessionPassphrase(cacheKey: string, passphrase: string) {
    if (!cacheKey) return
    sessionPassphrases.set(cacheKey, passphrase)
}

export function forgetEncryptedSessionPassphrase(cacheKey: string) {
    if (!cacheKey) return
    sessionPassphrases.delete(cacheKey)
}
