/** Decodes a location or link hash into the element id it targets. */
export function decodeHash(hash: string) {
    try {
        return decodeURIComponent(hash.slice(1))
    } catch {
        return hash.slice(1)
    }
}
