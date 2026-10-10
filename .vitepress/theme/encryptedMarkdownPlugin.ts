import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs'
import { createTranslator, type Translator } from '../../packages/config/src/i18n.js'
import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import MarkdownIt from 'markdown-it'
import { findContainerCloseLine, maskMarkdownContainers } from '../../packages/content-core/src/markdown-containers'
import { createMarkdownLocation, escapeHtmlAttribute, escapeHtmlText, renderComponentTag } from './markdownRendering'

const ENCRYPT_MARKER_CODE = 0x3a
const DEFAULT_ITERATIONS = 210000
const SUPPORTED_KEYS = new Set(['secret', 'password', 'title', 'hint'])

interface EncryptBlockOptions {
    secret?: string
    password?: string
    title?: string
    hint?: string
}

interface EncryptBlockTokenMeta {
    content: string
    location: string
    options: EncryptBlockOptions
}

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

type SecretMap = Record<string, string>

function encodeBase64Url(value: string | Buffer) {
    return Buffer.from(value).toString('base64url')
}

function createPayloadCacheKey(payload: string) {
    return createHash('sha256').update(payload).digest('hex').slice(0, 24)
}

function parseSecretMap(raw: string, sourceName: string): SecretMap {
    const parsed = JSON.parse(raw)

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`[encrypted-content] ${sourceName} must be a JSON object in the form { id: "passphrase" }.`)
    }

    const normalized: SecretMap = {}

    Object.entries(parsed).forEach(([key, value]) => {
        if (typeof value !== 'string' || !value.trim()) {
            throw new Error(`[encrypted-content] ${sourceName}: ${key} must be a nonempty string.`)
        }

        normalized[key] = value
    })

    return normalized
}

function mergeSecrets(target: SecretMap, incoming: SecretMap) {
    Object.entries(incoming).forEach(([key, value]) => {
        target[key] = value
    })
}

function loadSecrets(projectRoot: string) {
    const secrets: SecretMap = {}
    const sources = [resolve(projectRoot, '.vitepress/encryption-secrets.local.json')]
    if (process.env.BLOG_ENCRYPTION_SECRETS_FILE)
        sources.push(resolve(projectRoot, process.env.BLOG_ENCRYPTION_SECRETS_FILE))

    sources.forEach((filePath) => {
        if (!existsSync(filePath)) return
        mergeSecrets(secrets, parseSecretMap(readFileSync(filePath, 'utf8'), filePath))
    })

    if (process.env.BLOG_ENCRYPTION_SECRETS?.trim()) {
        mergeSecrets(secrets, parseSecretMap(process.env.BLOG_ENCRYPTION_SECRETS, 'BLOG_ENCRYPTION_SECRETS'))
    }

    return secrets
}

function parseEncryptOptions(raw: string, location: string): EncryptBlockOptions {
    if (!raw.trim()) {
        throw new Error(`[encrypted-content] ${location}: missing passphrase; provide secret="..." or password="...".`)
    }

    const result: Record<string, string> = {}
    const pattern = /([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = pattern.exec(raw))) {
        if (raw.slice(lastIndex, match.index).trim()) {
            throw new Error(
                `[encrypted-content] ${location}: invalid options; use key="value", e.g. ::: encrypt secret="note".`
            )
        }

        const [, key, doubleQuoted, singleQuoted, bareValue] = match
        result[key] = (doubleQuoted ?? singleQuoted ?? bareValue ?? '').trim()
        lastIndex = pattern.lastIndex
    }

    if (raw.slice(lastIndex).trim()) {
        throw new Error(
            `[encrypted-content] ${location}: invalid options; use key="value", e.g. ::: encrypt secret="note".`
        )
    }

    const unknownKeys = Object.keys(result).filter((key) => !SUPPORTED_KEYS.has(key))

    if (unknownKeys.length) {
        throw new Error(
            `[encrypted-content] ${location}: unsupported options: ${unknownKeys.join(', ')}. Supported: secret / password / title / hint.`
        )
    }

    if (!!result.secret === !!result.password) {
        throw new Error(
            `[encrypted-content] ${location}: provide exactly one passphrase source: secret="..." or password="...".`
        )
    }

    return {
        secret: result.secret,
        password: result.password,
        title: result.title || undefined,
        hint: result.hint || undefined
    }
}

function resolvePassphrase(options: EncryptBlockOptions, location: string, secrets: SecretMap) {
    if (options.password) return options.password

    if (!options.secret) {
        throw new Error(`[encrypted-content] ${location}: no passphrase available.`)
    }

    const passphrase = secrets[options.secret]

    if (!passphrase) {
        throw new Error(
            `[encrypted-content] ${location}: secret="${options.secret}" was not found in .vitepress/encryption-secrets.local.json, BLOG_ENCRYPTION_SECRETS_FILE or BLOG_ENCRYPTION_SECRETS.`
        )
    }

    return passphrase
}

function encryptHtml(html: string, passphrase: string): EncryptedPayload {
    const salt = randomBytes(16)
    const iv = randomBytes(12)
    const key = pbkdf2Sync(passphrase, salt, DEFAULT_ITERATIONS, 32, 'sha256')
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update(html, 'utf8'), cipher.final(), cipher.getAuthTag()])

    return {
        version: 1,
        format: 'html',
        algorithm: 'AES-GCM',
        kdf: 'PBKDF2',
        hash: 'SHA-256',
        iterations: DEFAULT_ITERATIONS,
        salt: encodeBase64Url(salt),
        iv: encodeBase64Url(iv),
        ciphertext: encodeBase64Url(ciphertext)
    }
}

function createEncryptBlockRule() {
    return (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
        const start = state.bMarks[startLine] + state.tShift[startLine]
        const max = state.eMarks[startLine]

        if (state.sCount[startLine] - state.blkIndent >= 4) return false
        if (start + 3 > max) return false
        if (state.src.charCodeAt(start) !== ENCRYPT_MARKER_CODE) return false

        let markerEnd = start
        while (markerEnd < max && state.src.charCodeAt(markerEnd) === ENCRYPT_MARKER_CODE) {
            markerEnd += 1
        }

        const markerCount = markerEnd - start

        if (markerCount < 3) return false

        const markerParams = state.src.slice(markerEnd, max).trim()

        if (!markerParams || (!markerParams.startsWith('encrypt ') && markerParams !== 'encrypt')) {
            return false
        }

        if (silent) return true

        const location = createMarkdownLocation(state.env?.relativePath, startLine)
        const nextLine = findContainerCloseLine(state, startLine, endLine, markerCount)

        if (nextLine < 0) {
            throw new Error(`[encrypted-content] ${location}: missing closing :::.`)
        }

        const token = state.push('encrypt_block', 'EncryptedContent', 0)
        token.block = true
        token.map = [startLine, nextLine + 1]
        token.markup = state.src.slice(start, markerEnd)
        token.info = markerParams
        token.meta = {
            content: state.getLines(startLine + 1, nextLine, 0, true),
            location,
            options: parseEncryptOptions(markerParams.slice('encrypt'.length).trim(), location)
        } satisfies EncryptBlockTokenMeta

        state.line = nextLine + 1
        return true
    }
}

let maskingParser: MarkdownIt | null = null

function getMaskingParser() {
    if (maskingParser) return maskingParser

    maskingParser = new MarkdownIt()
    maskingParser.block.ruler.before('fence', 'encrypt_block', createEncryptBlockRule(), {
        alt: ['paragraph', 'reference', 'blockquote', 'list']
    })
    return maskingParser
}

export function maskEncryptedMarkdown(markdown: string, relativePath = 'search-index.md') {
    return maskMarkdownContainers(markdown, ['encrypt'], relativePath)
}

export function createEncryptedMarkdownPlugin(projectRoot: string, language = 'en') {
    const t = createTranslator(language)
    const secrets = loadSecrets(projectRoot)

    return (md: MarkdownIt) => {
        md.block.ruler.before('fence', 'encrypt_block', createEncryptBlockRule(), {
            alt: ['paragraph', 'reference', 'blockquote', 'list']
        })

        md.renderer.rules.encrypt_block = (tokens, index, _options, env) => {
            const meta = tokens[index].meta as EncryptBlockTokenMeta
            const containsNestedEncryptBlock = getMaskingParser()
                .parse(meta.content, {
                    relativePath: env?.relativePath
                })
                .some((token) => token.type === 'encrypt_block')

            if (containsNestedEncryptBlock) {
                throw new Error(
                    `[encrypted-content] ${meta.location}: nested ::: encrypt ::: blocks are not supported.`
                )
            }
            const passphrase = resolvePassphrase(meta.options, meta.location, secrets)
            const renderedHtml = md.render(meta.content, {
                ...env,
                referenceRenderMode: 'static-html'
            })
            const payload = encodeBase64Url(JSON.stringify(encryptHtml(renderedHtml, passphrase)))
            const cacheKey = createPayloadCacheKey(payload)
            const title = meta.options.title || t('受保护内容', 'Protected content')

            if (env?.referenceRenderMode === 'static-html') {
                return renderStaticEncryptedContent(t, payload, cacheKey, title, meta.options.hint)
            }

            return renderComponentTag('EncryptedContent', {
                payload,
                'cache-key': cacheKey,
                title,
                hint: meta.options.hint
            })
        }
    }
}

function renderStaticEncryptedContent(t: Translator, payload: string, cacheKey: string, title: string, hint?: string) {
    const hintHtml = hint
        ? `<p class="encrypted-content__hint">${t('提示：', 'Hint: ')}${escapeHtmlText(hint)}</p>`
        : ''
    return `<section class="encrypted-content" data-encrypted-content data-payload="${escapeHtmlAttribute(payload)}" data-cache-key="${escapeHtmlAttribute(cacheKey)}"><div class="encrypted-content__panel encrypted-content__panel--locked"><span class="encrypted-content__status-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M8 10V7.5a4 4 0 1 1 8 0V10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path><rect x="5" y="10" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"></rect></svg></span><h3 class="encrypted-content__title">${escapeHtmlText(title)}</h3><p class="encrypted-content__description">${t('这段内容已经在构建阶段加密，站点仍然保持纯静态部署；只有在当前浏览器里输入正确口令后才会解密。', 'Enter the passphrase to decrypt this content in your browser.')}</p>${hintHtml}<form class="encrypted-content__form"><input class="encrypted-content__input" type="password" autocomplete="current-password" inputmode="text" aria-label="${t('口令', 'Passphrase')}" placeholder="${t('输入口令', 'Enter passphrase')}"><button class="encrypted-content__button" type="submit">${t('解密', 'Decrypt')}</button></form><p class="encrypted-content__message encrypted-content__message--error" hidden></p></div></section>`
}
