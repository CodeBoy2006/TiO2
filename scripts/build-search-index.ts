import { loadTiO2Project } from '../packages/config/src/project.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import MiniSearch from 'minisearch'
import { describeSearchEntry, prepareSearchMarkdown, tokenizeSearchText } from '../site/search-content'
import { FOUNDATION_KIND_LABELS, FOUNDATION_KIND_ENGLISH } from '../packages/content-core/src/index'
import { loadSiteContent } from '../packages/content-fs/src/index'
import { readMarkdownSource } from '../packages/content-fs/src/markdown-source'

import { createTranslator, resolveLanguage } from '../packages/config/src/i18n.js'

const project = await loadTiO2Project(process.env.TIO2_PROJECT_ROOT ?? process.cwd())
const t = createTranslator(project.config.site.language)
const outputDirectory = path.resolve(project.rootDir, process.env.TIO2_OUTPUT_DIR ?? '.tio2-tmp/site')
const outputPath = path.join(outputDirectory, 'assets/search-index.json')
const content = await loadSiteContent(project, {
    env: process.env.NODE_ENV === 'production' ? 'production' : 'development'
})
const entries = content.publishing.entries.filter(
    (entry, index, all) =>
        entry.kind !== 'home' &&
        entry.kind !== 'pagination' &&
        entry.sourcePath.endsWith('.md') &&
        all.findIndex((candidate) => candidate.sourcePath === entry.sourcePath) === index
)
const documents = []
const foundationsBySource = new Map(content.foundations.entries.map((entry) => [entry.sourcePath, entry]))
const articlesBySource = new Map(content.articles.map((article) => [article.sourcePath, article]))
const domainTitles = new Map(
    content.foundations.groups.flatMap((group) => group.domains.map((domain) => [domain.id, domain.title]))
)

for (const entry of entries) {
    const source = await readMarkdownSource(path.resolve(project.rootDir, entry.sourcePath))
    const prepared = prepareSearchMarkdown(source.rawContent, entry.sourcePath)
    if (!prepared) continue
    const foundation = foundationsBySource.get(entry.sourcePath)
    const article = articlesBySource.get(entry.sourcePath)
    documents.push({
        id: entry.route,
        title: entry.title,
        aliases: foundation?.aliases ?? [],
        description: entry.description,
        kind: entry.kind,
        meta: describeSearchEntry(entry.kind, {
            publishedAt: entry.publishedAt,
            category: article?.frontMatter.category,
            entryKind: foundation
                ? t(FOUNDATION_KIND_LABELS[foundation.kind], FOUNDATION_KIND_ENGLISH[foundation.kind])
                : undefined,
            domains: foundation?.domains.flatMap((id) => domainTitles.get(id) ?? [])
        }),
        text: `${foundation?.aliases.join(' ') ?? ''} ${stripSearchMarkdown(prepared.markdown)}`.trim()
    })
}

const index = new MiniSearch({
    fields: ['title', 'text'],
    storeFields: ['title', 'aliases', 'description', 'kind', 'meta'],
    tokenize: (text) => tokenizeSearchText(text, resolveLanguage(project.config.site.language)),
    searchOptions: {
        ...project.config.theme.search.miniSearch,
        combineWith: 'AND'
    }
})
index.addAll(documents)
await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, JSON.stringify(index))
console.log(`[search-index] ${JSON.stringify({ documents: documents.length, outputPath })}`)

export function stripSearchMarkdown(markdown: string) {
    return markdown
        .replace(/```[^\n]*\n([\s\S]*?)```/gu, '$1')
        .replace(/`([^`]+)`/gu, '$1')
        .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
        .replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/gu, '$1')
        .replace(/<[^>]+>/gu, ' ')
        .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gmu, '')
        .replace(/[\\*_~]/gu, '')
        .replace(/\s+/gu, ' ')
        .trim()
}
