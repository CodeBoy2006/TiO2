import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import MarkdownIt from 'markdown-it'
import { createEncryptedMarkdownPlugin, maskEncryptedMarkdown } from '../../.vitepress/theme/encryptedMarkdownPlugin.js'

const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'tio2-encryption-fixture-'))
after(() => rmSync(projectRoot, { recursive: true, force: true }))

function extractAttribute(html: string, attribute: string) {
    const match = html.match(new RegExp(`${attribute}="([^"]+)"`))
    return match?.[1]
}

test('TiO2 encrypted markdown plugin emits encrypted payloads for inline passwords', () => {
    const md = new MarkdownIt()
    md.use(createEncryptedMarkdownPlugin(projectRoot))

    const rendered = md.render('::: encrypt password="tiO2-pass" title="Private" hint="Try me"\n**Hidden TiO2**\n:::')
    const payload = extractAttribute(rendered, 'payload')
    const cacheKey = extractAttribute(rendered, 'cache-key')

    assert.ok(payload)
    assert.ok(cacheKey)
    assert.match(rendered, /<EncryptedContent .*title="Private" hint="Try me"><\/EncryptedContent>/)
    assert.match(cacheKey!, /^[a-f0-9]{24}$/)

    const decodedPayload = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'))
    assert.equal(decodedPayload.version, 1)
    assert.equal(decodedPayload.format, 'html')
    assert.equal(decodedPayload.algorithm, 'AES-GCM')
    assert.equal(decodedPayload.kdf, 'PBKDF2')
    assert.equal(decodedPayload.hash, 'SHA-256')
    assert.equal(decodedPayload.iterations, 210000)
    assert.ok(decodedPayload.salt)
    assert.ok(decodedPayload.iv)
    assert.ok(decodedPayload.ciphertext)
})

test('TiO2 encrypted markdown plugin can resolve secrets from environment sources', () => {
    const previousSecrets = process.env.BLOG_ENCRYPTION_SECRETS

    try {
        process.env.BLOG_ENCRYPTION_SECRETS = JSON.stringify({ demo: 'resolved-pass' })

        const md = new MarkdownIt()
        md.use(createEncryptedMarkdownPlugin(projectRoot))
        const rendered = md.render('::: encrypt secret="demo"\nVisible **only after decrypt**\n:::')

        assert.match(rendered, /title="Protected content"/)
        assert.ok(extractAttribute(rendered, 'payload'))
    } finally {
        if (previousSecrets === undefined) {
            delete process.env.BLOG_ENCRYPTION_SECRETS
        } else {
            process.env.BLOG_ENCRYPTION_SECRETS = previousSecrets
        }
    }
})

test('TiO2 encrypted markdown search masking removes protected content and credentials', () => {
    const markdown = [
        '# Public heading',
        '',
        'Public paragraph.',
        '',
        '::: encrypt password="do-not-index" title="Private"',
        'Protected plaintext should never enter search.',
        '## Protected heading',
        '```md',
        '::: encrypt password="code-sample"',
        'Literal container syntax inside protected code.',
        ':::',
        '```',
        'Protected text after the fenced sample.',
        ':::',
        '',
        '```md',
        '::: encrypt password="example-only"',
        'Public code sample',
        ':::',
        '```',
        '',
        'Public ending.'
    ].join('\n')

    const masked = maskEncryptedMarkdown(markdown, 'posts/demo.md')

    assert.match(masked, /Public heading/)
    assert.match(masked, /Public paragraph/)
    assert.match(masked, /Public code sample/)
    assert.match(masked, /Public ending/)
    assert.doesNotMatch(masked, /do-not-index/)
    assert.doesNotMatch(masked, /Protected plaintext/)
    assert.doesNotMatch(masked, /Protected heading/)
    assert.doesNotMatch(masked, /Protected text after the fenced sample/)
})

test('TiO2 encrypted markdown containers ignore literal syntax in fenced and indented code', () => {
    const md = new MarkdownIt()
    md.use(createEncryptedMarkdownPlugin(projectRoot))

    const rendered = md.render(
        [
            '::: encrypt password="outer"',
            '```md',
            '::: encrypt password="example-only"',
            'Literal example',
            ':::',
            '```',
            'Protected text after code.',
            ':::'
        ].join('\n')
    )
    const indentedCode = ['    ::: encrypt password="example-only"', '    Public indented code sample', '    :::'].join(
        '\n'
    )

    assert.ok(extractAttribute(rendered, 'payload'))
    assert.match(maskEncryptedMarkdown(indentedCode), /Public indented code sample/)
})

test('TiO2 encrypted markdown plugin rejects nested blocks and invalid option shapes', () => {
    const md = new MarkdownIt()
    md.use(createEncryptedMarkdownPlugin(projectRoot))

    assert.throws(
        () =>
            md.render(
                ['::: encrypt password="outer"', '::: encrypt password="inner"', 'Nested', ':::', ':::'].join('\n')
            ),
        /nested ::: encrypt ::: blocks are not supported/
    )
    assert.throws(
        () => md.render('::: encrypt password="a" secret="b"\ncontent\n:::'),
        /provide exactly one passphrase source/
    )
    assert.throws(() => md.render('::: encrypt mystery="x"\ncontent\n:::'), /unsupported options/)
})

test('encryption loads each project’s local secret file without changing cwd', async () => {
    const cwd = process.cwd()
    const root = await mkdtemp(path.join(os.tmpdir(), 'tio2-encryption-projects-'))
    try {
        const roots = ['first', 'second'].map((name) => path.join(root, name))
        await Promise.all(
            roots.map(async (directory, index) => {
                await mkdir(path.join(directory, '.vitepress'), { recursive: true })
                await writeFile(
                    path.join(directory, '.vitepress/encryption-secrets.local.json'),
                    JSON.stringify({
                        [`__tio2Fixture${index}`]: 'fixture-only-password'
                    })
                )
            })
        )
        const parsers = roots.map((directory) => new MarkdownIt().use(createEncryptedMarkdownPlugin(directory)))
        for (const [index, parser] of parsers.entries()) {
            assert.ok(
                extractAttribute(parser.render(`::: encrypt secret="__tio2Fixture${index}"\nHidden\n:::`), 'payload')
            )
            assert.throws(() => parser.render(`::: encrypt secret="__tio2Fixture${1 - index}"\nHidden\n:::`))
        }
        assert.equal(process.cwd(), cwd)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
