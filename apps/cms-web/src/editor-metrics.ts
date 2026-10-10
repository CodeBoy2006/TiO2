export function getEditorMetrics(source: string) {
    const normalized = source.replace(/\r\n/g, '\n')
    const trimmed = normalized.trim()

    return {
        lines: normalized.length ? normalized.split('\n').length : 1,
        words: trimmed ? trimmed.split(/\s+/u).length : 0,
        characters: normalized.length
    }
}
