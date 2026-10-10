/**
 * 标准化日期时间格式（YYYY-MM-DD HH:mm）
 * @param input 可接受 Date 对象或字符串
 * @returns 标准化后的日期时间字符串
 */
export function convertDateV2(input: Date | string | number): string {
    if (typeof input === 'number') {
        input = new Date(input)
    }

    if (typeof input === 'string' && input.includes('T')) {
        input = new Date(input)
    }

    if (input instanceof Date && !isNaN(input.getTime())) {
        const pad = (n: number) => n.toString().padStart(2, '0')
        return [input.getFullYear(), pad(input.getMonth() + 1), pad(input.getDate())].join('-')
    }

    if (typeof input === 'string') {
        const trimmed = input.trim()
        const parts = trimmed.split(/\s+/)
        const datePart = parts[0]

        if (parts.length < 2 || parts[1].trim() === '') {
            return datePart
        }

        const timeComponents = parts[1].split(':').map((component) => component.padStart(2, '0'))
        return `${datePart} ${timeComponents.join(':')}`
    }

    return ''
}

export function convertDate(date = new Date().toString()) {
    const jsonDate = new Date(date).toJSON()
    return jsonDate.split('T')[0]
}

export function toIsoDate(input: unknown, timezoneOffset = '+00:00') {
    if (input instanceof Date) {
        return isNaN(input.getTime()) ? '' : input.toISOString()
    }

    if (typeof input === 'number') {
        const parsed = new Date(input)
        return isNaN(parsed.getTime()) ? '' : parsed.toISOString()
    }

    if (typeof input !== 'string' || !input.trim()) return ''

    const trimmed = input.trim()
    if (/T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(trimmed)) {
        const parsed = new Date(trimmed)
        return isNaN(parsed.getTime()) ? '' : parsed.toISOString()
    }

    if (!/^[+-]\d{2}:\d{2}$/u.test(timezoneOffset)) {
        throw new Error(`Invalid timezone offset: ${timezoneOffset}`)
    }

    const normalized = convertDateV2(trimmed)
    const match = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?$/u)
    if (!match) return ''

    const time = match[2] ? (match[2].split(':').length === 2 ? `${match[2]}:00` : match[2]) : '00:00:00'
    const parsed = new Date(`${match[1]}T${time}${timezoneOffset}`)
    return isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}
