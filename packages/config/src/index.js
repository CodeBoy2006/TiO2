import { createTranslator } from './i18n.js'

export const FRAMEWORK_META = Object.freeze({ name: 'TiO₂', asciiName: 'TiO2' })

function object(value, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${field} must be an object`)
    }
    return value
}

function string(value, field, allowEmpty = false) {
    if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
        throw new TypeError(`${field} must be a ${allowEmpty ? '' : 'nonempty '}string`)
    }
}

function url(value, field, relative = false) {
    string(value, field)
    if (relative && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return
    let parsed
    try {
        parsed = new URL(value)
    } catch {
        throw new TypeError(`${field} must be an HTTP(S) URL`)
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new TypeError(`${field} must be an HTTP(S) URL without credentials`)
    }
}

function directory(value, field) {
    string(value, field)
    const segments = value
        .replaceAll('\\', '/')
        .split('/')
        .filter((part) => part && part !== '.')
    if (
        value.startsWith('/') ||
        value.startsWith('\\') ||
        /^[A-Za-z]:/.test(value) ||
        segments.includes('..') ||
        !segments.length ||
        /[\0*?[\]{}()!]/.test(value)
    ) {
        throw new TypeError(`${field} must be a contained project-relative directory without glob operators`)
    }
    return segments.join('/')
}

export function defineTiO2Config(input) {
    object(input, 'TiO2 config')
    object(input.site, 'site')
    for (const field of ['content', 'theme', 'integrations', 'foundations']) {
        if (input[field] !== undefined) object(input[field], field)
    }
    if (input.theme?.search !== undefined) object(input.theme.search, 'theme.search')
    if (input.theme?.search?.miniSearch !== undefined) object(input.theme.search.miniSearch, 'theme.search.miniSearch')
    if (input.theme?.search?.miniSearch?.boost !== undefined)
        object(input.theme.search.miniSearch.boost, 'theme.search.miniSearch.boost')
    const site = {
        description: '',
        language: 'en',
        timezoneOffset: '+00:00',
        author: '',
        socialImage: '',
        themeColor: '#2563eb',
        copyrightStartYear: null,
        contentLicense: '',
        ...input.site
    }
    string(site.title, 'site.title')
    url(site.url, 'site.url')
    for (const field of ['description', 'author', 'socialImage', 'contentLicense'])
        string(site[field], `site.${field}`, true)
    if (
        site.copyrightStartYear !== null &&
        (!Number.isSafeInteger(site.copyrightStartYear) || site.copyrightStartYear < 1)
    )
        throw new TypeError('site.copyrightStartYear must be a positive integer or null')
    for (const field of ['language', 'timezoneOffset', 'themeColor']) string(site[field], `site.${field}`)
    if (!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(site.timezoneOffset))
        throw new TypeError('site.timezoneOffset must use ±HH:MM')
    if (site.socialImage) url(site.socialImage, 'site.socialImage', true)
    const content = {
        postsDir: 'posts',
        topicsDir: 'topics',
        foundationsDir: 'foundations',
        pagesDir: 'pages',
        topicMetaFilename: '_meta.md',
        pageSize: 10,
        productionIgnorePatterns: ['**/draft/**/*.md', '**/trash/**/*.md', '**/private-notes/**/*.md'],
        ...input.content
    }
    const directoryFields = ['postsDir', 'topicsDir', 'foundationsDir', 'pagesDir']
    for (const field of directoryFields) content[field] = directory(content[field], `content.${field}`)
    if (site.authorUrl === undefined) site.authorUrl = site.url
    url(site.authorUrl, 'site.authorUrl', true)
    for (let i = 0; i < directoryFields.length; i++) {
        for (const field of directoryFields.slice(i + 1)) {
            const first = content[directoryFields[i]],
                second = content[field]
            if (first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`)) {
                throw new TypeError(`content.${directoryFields[i]} and content.${field} must not overlap`)
            }
        }
    }
    string(content.topicMetaFilename, 'content.topicMetaFilename')
    if (!/^[^/\\\0*?[\]{}()!]+\.md$/.test(content.topicMetaFilename))
        throw new TypeError('content.topicMetaFilename must be a Markdown filename')
    if (!Number.isSafeInteger(content.pageSize) || content.pageSize < 1)
        throw new TypeError('content.pageSize must be a positive integer')
    if (!Array.isArray(content.productionIgnorePatterns))
        throw new TypeError('content.productionIgnorePatterns must be an array')
    for (const pattern of content.productionIgnorePatterns) string(pattern, 'content.productionIgnorePatterns entry')
    const theme = {
        nav: [],
        socialLinks: [],
        outlineLabel: createTranslator(site.language)('目录', 'Contents'),
        head: '',
        clientEntry: '',
        layout: '',
        pages: {},
        ...input.theme,
        search: {
            provider: 'local',
            ...input.theme?.search,
            miniSearch: {
                fuzzy: 0.2,
                prefix: true,
                ...input.theme?.search?.miniSearch,
                boost: { title: 6, text: 2, ...input.theme?.search?.miniSearch?.boost }
            }
        }
    }
    string(theme.outlineLabel, 'theme.outlineLabel')
    string(theme.head, 'theme.head', true)
    for (const field of ['clientEntry', 'layout']) {
        string(theme[field], `theme.${field}`, true)
        if (theme[field]) theme[field] = directory(theme[field], `theme.${field}`)
    }
    object(theme.pages, 'theme.pages')
    theme.pages = Object.fromEntries(
        Object.entries(theme.pages).map(([sourcePath, modulePath]) => {
            const source = directory(sourcePath, 'theme.pages source')
            if (!source.startsWith(`${content.pagesDir}/`) || !source.endsWith('.md'))
                throw new TypeError('theme.pages keys must be Markdown paths within content.pagesDir')
            return [source, directory(modulePath, 'theme.pages module')]
        })
    )
    for (const field of ['nav', 'socialLinks']) {
        if (!Array.isArray(theme[field])) throw new TypeError(`theme.${field} must be an array`)
        for (const item of theme[field]) {
            object(item, `theme.${field} entry`)
            string(item[field === 'nav' ? 'text' : 'icon'], `theme.${field} entry label`)
            url(item.link, `theme.${field} entry link`, true)
            if (item.activeMatch !== undefined) {
                string(item.activeMatch, 'theme.nav activeMatch')
                try {
                    new RegExp(item.activeMatch)
                } catch {
                    throw new TypeError('theme.nav activeMatch must be a valid regular expression')
                }
            }
        }
    }
    const miniSearch = theme.search.miniSearch
    if (theme.search.provider !== 'local') throw new TypeError('theme.search.provider must be local')
    if (!Number.isFinite(miniSearch.fuzzy) || miniSearch.fuzzy < 0 || miniSearch.fuzzy > 1)
        throw new TypeError('theme.search.miniSearch.fuzzy must be between 0 and 1')
    if (typeof miniSearch.prefix !== 'boolean') throw new TypeError('theme.search.miniSearch.prefix must be a boolean')
    for (const value of Object.values(miniSearch.boost)) {
        if (!Number.isFinite(value) || value < 0)
            throw new TypeError('theme.search.miniSearch.boost values must be nonnegative numbers')
    }
    const comment = input.comment === undefined ? false : input.comment
    if (comment !== false) {
        object(comment, 'comment')
        if (comment.provider !== 'giscus') throw new TypeError('comment.provider must be giscus')
        for (const field of ['repo', 'repoId', 'categoryId', 'category']) string(comment[field], `comment.${field}`)
    }
    const integrations = { vercelAnalytics: false, feed: true, sitemap: true, ...input.integrations }
    for (const field of ['vercelAnalytics', 'feed', 'sitemap']) {
        if (typeof integrations[field] !== 'boolean') throw new TypeError(`integrations.${field} must be a boolean`)
    }
    const foundations = { groups: [], routes: [], ...input.foundations }
    for (const field of ['title', 'englishTitle', 'subtitle']) {
        const value = foundations[field]
        if (value !== undefined && (typeof value !== 'string' || !value.trim()))
            throw new TypeError(`foundations.${field} must be a non-empty string`)
    }
    for (const field of ['groups', 'routes']) {
        if (!Array.isArray(foundations[field])) throw new TypeError(`foundations.${field} must be an array`)
    }
    return { site, content, theme, comment, integrations, foundations }
}
