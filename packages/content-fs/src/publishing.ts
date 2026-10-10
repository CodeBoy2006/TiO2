import type { TiO2Project } from '../../config/src/types.js'
import path from 'node:path'
import fs from 'fs-extra'
import { globby } from 'globby'
import {
    extractExcerpt,
    extractRawFrontmatterValue,
    createMarkdownRoute,
    inferTitleFromPath,
    toIsoDate,
    type BlogPost,
    type FoundationEntry
} from '../../content-core/src/index'
import { getPageIgnorePatterns, getPageSourcePatterns } from './content-paths'
import { readLatestGitCommitsForPaths } from './git-metadata'
import { readMarkdownSource } from './markdown-source'

export type PublishingEntryKind = 'home' | 'pagination' | 'post' | 'topic' | 'foundation' | 'page'
export type PublishingChangeFrequency = 'daily' | 'weekly' | 'monthly'

export interface PublishingManifestEntry {
    kind: PublishingEntryKind
    sourcePath: string
    route: string
    title: string
    description: string
    publishedAt: string
    updatedAt: string
    tags: string[]
    changeFrequency: PublishingChangeFrequency
    priority: number
}

export interface PublishingManifest {
    generatedAt: string
    entries: PublishingManifestEntry[]
}

export interface CreatePublishingManifestOptions {
    project: TiO2Project
    posts: BlogPost[]
    topicArticles: BlogPost[]
    foundations: FoundationEntry[]
    pageSize: number
    siteTitle: string
    timezoneOffset: string
    env?: string
}

export interface PublishingSite {
    title: string
    url: string
    description: string
    language: string
    author: string
    authorUrl: string
}

export interface PublishingIntegrations {
    feed: boolean
    sitemap: boolean
}

const dynamicPageNames = new Set(['archives', 'category', 'foundations', 'foundations-routes', 'ledger', 'tags', 'topics'])

export async function createPublishingManifest(options: CreatePublishingManifestOptions): Promise<PublishingManifest> {
    if (!Number.isInteger(options.pageSize) || options.pageSize <= 0) {
        throw new Error(`Invalid publishing page size: ${options.pageSize}`)
    }

    const postEntries = options.posts.map((post) => createArticleEntry(post, 'post', options.timezoneOffset))
    const topicEntries = options.topicArticles.map((post) => createArticleEntry(post, 'topic', options.timezoneOffset))
    const foundationEntries = await createFoundationEntries(
        options.project,
        options.foundations,
        options.timezoneOffset
    )
    const latestArticleAt = latestDate(
        [...postEntries, ...topicEntries, ...foundationEntries].flatMap((entry) => [entry.updatedAt, entry.publishedAt])
    )
    const pageEntries = await loadPageEntries(
        options.project,
        options.env === 'production',
        options.timezoneOffset,
        latestArticleAt
    )
    const latestSiteAt =
        latestDate(
            [...postEntries, ...topicEntries, ...foundationEntries, ...pageEntries].flatMap((entry) => [
                entry.updatedAt,
                entry.publishedAt
            ])
        ) || new Date(0).toISOString()
    const paginationPageCount = Math.max(1, Math.ceil(postEntries.length / options.pageSize))
    const paginationEntries = Array.from(
        { length: Math.max(0, paginationPageCount - 1) },
        (_, index): PublishingManifestEntry => ({
            kind: 'pagination',
            sourcePath: `page_${index + 2}.md`,
            route: `/page_${index + 2}.html`,
            title: `${options.siteTitle} - Page ${index + 2}`,
            description: '',
            publishedAt: '',
            updatedAt: latestArticleAt,
            tags: [],
            changeFrequency: 'weekly',
            priority: 0.6
        })
    )
    const homeEntry: PublishingManifestEntry = {
        kind: 'home',
        sourcePath: 'index.md',
        route: '/',
        title: options.siteTitle,
        description: '',
        publishedAt: '',
        updatedAt: latestSiteAt,
        tags: [],
        changeFrequency: 'daily',
        priority: 1
    }

    return {
        generatedAt: latestSiteAt,
        entries: [
            homeEntry,
            ...pageEntries.sort((left, right) => left.route.localeCompare(right.route, 'zh-CN')),
            ...paginationEntries,
            ...foundationEntries,
            ...postEntries,
            ...topicEntries
        ]
    }
}

async function createFoundationEntries(project: TiO2Project, entries: FoundationEntry[], timezoneOffset: string) {
    const gitCommits = await readLatestGitCommitsForPaths(
        entries.map((entry) => entry.sourcePath),
        project.rootDir
    )

    return entries.map(
        (entry): PublishingManifestEntry => ({
            kind: 'foundation',
            sourcePath: entry.sourcePath,
            route: entry.regularPath,
            title: entry.title,
            description: entry.description,
            publishedAt: '',
            updatedAt: toIsoDate(gitCommits.get(entry.sourcePath)?.committedAt, timezoneOffset),
            tags: [entry.kind, ...entry.domains],
            changeFrequency: 'monthly',
            priority: 0.8
        })
    )
}

export async function writePublishingArtifacts(
    manifest: PublishingManifest,
    outputDirectory: string,
    site: PublishingSite,
    integrations: PublishingIntegrations
) {
    await fs.ensureDir(outputDirectory)

    const tasks: Promise<void>[] = []
    if (integrations.sitemap) {
        tasks.push(writeSitemapArtifact(manifest, outputDirectory, site))
    }
    if (integrations.feed) {
        tasks.push(writeFeedArtifacts(manifest, outputDirectory, site))
    }

    await Promise.all(tasks)
}

export async function writeSitemapArtifact(
    manifest: PublishingManifest,
    outputDirectory: string,
    site: PublishingSite
) {
    await fs.writeFile(path.join(outputDirectory, 'sitemap.xml'), createSitemapXml(manifest, site), 'utf8')
}

export async function writeFeedArtifacts(manifest: PublishingManifest, outputDirectory: string, site: PublishingSite) {
    await Promise.all([
        fs.writeFile(path.join(outputDirectory, 'feed.xml'), createRssFeed(manifest, site), 'utf8'),
        fs.writeFile(path.join(outputDirectory, 'atom.xml'), createAtomFeed(manifest, site), 'utf8'),
        fs.writeFile(path.join(outputDirectory, 'feed.json'), createJsonFeed(manifest, site), 'utf8')
    ])
}

function createSitemapXml(manifest: PublishingManifest, site: PublishingSite) {
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    ]

    manifest.entries.forEach((entry) => {
        const lastModified = entry.updatedAt || entry.publishedAt

        lines.push('  <url>')
        lines.push(`    <loc>${escapeXml(createAbsoluteUrl(entry.route, site.url))}</loc>`)
        if (lastModified) {
            lines.push(`    <lastmod>${escapeXml(lastModified)}</lastmod>`)
        }
        lines.push(`    <changefreq>${entry.changeFrequency}</changefreq>`)
        lines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`)
        lines.push('  </url>')
    })

    lines.push('</urlset>', '')
    return lines.join('\n')
}

function createRssFeed(manifest: PublishingManifest, site: PublishingSite) {
    const feed = createFeedProjection(manifest, site.url)
    const feedUrl = createAbsoluteUrl('/feed.xml', site.url)
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
        '  <channel>',
        `    <title>${escapeXml(site.title)}</title>`,
        `    <link>${escapeXml(site.url)}</link>`,
        `    <description>${escapeXml(site.description)}</description>`,
        `    <language>${escapeXml(site.language)}</language>`,
        `    <lastBuildDate>${new Date(feed.latestUpdatedAt).toUTCString()}</lastBuildDate>`,
        `    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />`
    ]

    feed.entries.forEach((post) => {
        lines.push('    <item>')
        lines.push(`      <title>${escapeXml(post.title)}</title>`)
        lines.push(`      <link>${escapeXml(post.url)}</link>`)
        lines.push(`      <guid isPermaLink="true">${escapeXml(post.url)}</guid>`)
        lines.push(`      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>`)
        lines.push(`      <description>${wrapCdata(post.description)}</description>`)
        lines.push(`      <content:encoded>${wrapCdata(`<p>${escapeXml(post.description)}</p>`)}</content:encoded>`)
        post.tags.forEach((tag) => {
            lines.push(`      <category>${escapeXml(tag)}</category>`)
        })
        lines.push('    </item>')
    })

    lines.push('  </channel>', '</rss>', '')
    return lines.join('\n')
}

function createJsonFeed(manifest: PublishingManifest, site: PublishingSite) {
    const authorUrl = new URL(site.authorUrl, site.url).toString()
    const feed = createFeedProjection(manifest, site.url)

    return JSON.stringify(
        {
            version: 'https://jsonfeed.org/version/1.1',
            title: site.title,
            home_page_url: site.url,
            feed_url: createAbsoluteUrl('/feed.json', site.url),
            description: site.description,
            language: site.language,
            authors: [
                {
                    name: site.author,
                    url: authorUrl
                }
            ],
            items: feed.entries.map((post) => ({
                id: post.url,
                url: post.url,
                title: post.title,
                summary: post.description,
                content_text: post.description,
                date_published: post.publishedAt,
                date_modified: post.updatedAt,
                tags: post.tags,
                authors: [
                    {
                        name: site.author,
                        url: authorUrl
                    }
                ]
            }))
        },
        null,
        2
    )
}

function createAtomFeed(manifest: PublishingManifest, site: PublishingSite) {
    const feed = createFeedProjection(manifest, site.url)
    const feedUrl = createAbsoluteUrl('/atom.xml', site.url)
    const authorUrl = new URL(site.authorUrl, site.url).toString()
    const lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<feed xmlns="http://www.w3.org/2005/Atom">',
        `  <title>${escapeXml(site.title)}</title>`,
        `  <subtitle>${escapeXml(site.description)}</subtitle>`,
        `  <id>${escapeXml(site.url)}</id>`,
        `  <link href="${escapeXml(site.url)}" />`,
        `  <link href="${escapeXml(feedUrl)}" rel="self" />`,
        `  <updated>${escapeXml(feed.latestUpdatedAt)}</updated>`,
        '  <author>',
        `    <name>${escapeXml(site.author)}</name>`,
        `    <uri>${escapeXml(authorUrl)}</uri>`,
        '  </author>'
    ]

    feed.entries.forEach((post) => {
        lines.push('  <entry>')
        lines.push(`    <title>${escapeXml(post.title)}</title>`)
        lines.push(`    <link href="${escapeXml(post.url)}" />`)
        lines.push(`    <id>${escapeXml(post.url)}</id>`)
        lines.push(`    <updated>${escapeXml(post.updatedAt)}</updated>`)
        lines.push(`    <published>${escapeXml(post.publishedAt)}</published>`)
        lines.push(`    <summary>${wrapCdata(post.description)}</summary>`)
        lines.push(`    <content type="html">${wrapCdata(`<p>${escapeXml(post.description)}</p>`)}</content>`)
        post.tags.forEach((tag) => {
            lines.push(`    <category term="${escapeXml(tag)}" />`)
        })
        lines.push('  </entry>')
    })

    lines.push('</feed>', '')
    return lines.join('\n')
}

function createArticleEntry(post: BlogPost, kind: 'post' | 'topic', timezoneOffset: string): PublishingManifestEntry {
    const tags = [...(post.frontMatter.category ? [post.frontMatter.category] : []), ...post.frontMatter.tags]

    return {
        kind,
        sourcePath: post.sourcePath,
        route: post.regularPath,
        title: post.frontMatter.title,
        description: post.frontMatter.description || post.excerpt,
        publishedAt: toIsoDate(post.frontMatter.publishedAt || post.frontMatter.date, timezoneOffset),
        updatedAt: toIsoDate(post.frontMatter.lastUpdated, timezoneOffset),
        tags: uniqueStrings(tags),
        changeFrequency: 'monthly',
        priority: kind === 'post' ? 0.9 : 0.8
    }
}

async function loadPageEntries(
    project: TiO2Project,
    production: boolean,
    timezoneOffset: string,
    latestArticleAt: string
) {
    const pagePaths = await globby(getPageSourcePatterns(project.config.content), {
        cwd: project.rootDir,
        ignore: getPageIgnorePatterns(project.config.content, { production })
    })
    const gitCommits = await readLatestGitCommitsForPaths(pagePaths, project.rootDir)

    return Promise.all(
        pagePaths.map(async (sourcePath): Promise<PublishingManifestEntry> => {
            const { rawContent, data, content } = await readMarkdownSource(path.resolve(project.rootDir, sourcePath))
            const pageName = path.basename(sourcePath, '.md')
            const pageUpdatedAt = toIsoDate(gitCommits.get(sourcePath)?.committedAt, timezoneOffset)
            const rawPublishedAt = extractRawFrontmatterValue(rawContent, 'date')
            const updatedAt = dynamicPageNames.has(pageName)
                ? latestDate([pageUpdatedAt, latestArticleAt])
                : pageUpdatedAt

            return {
                kind: 'page',
                sourcePath,
                route: createMarkdownRoute(sourcePath),
                title:
                    typeof data.title === 'string' && data.title.trim()
                        ? data.title.trim()
                        : inferTitleFromPath(sourcePath),
                description:
                    typeof data.description === 'string' && data.description.trim()
                        ? data.description.trim()
                        : extractExcerpt(content),
                publishedAt: toIsoDate(rawPublishedAt || data.date, timezoneOffset),
                updatedAt,
                tags: uniqueStrings(
                    Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === 'string') : []
                ),
                changeFrequency: dynamicPageNames.has(pageName) ? 'weekly' : 'monthly',
                priority: 0.7
            }
        })
    )
}

function createFeedProjection(manifest: PublishingManifest, siteUrl: string) {
    const entryDate = (entry: PublishingManifestEntry) => entry.publishedAt || entry.updatedAt
    const entries = manifest.entries
        .filter((entry) => entry.kind === 'post')
        .sort((left, right) => (entryDate(left) < entryDate(right) ? 1 : -1))

    return {
        entries: entries.map((entry) => {
            const publishedAt = entry.publishedAt || entry.updatedAt || manifest.generatedAt

            return {
                ...entry,
                url: createAbsoluteUrl(entry.route, siteUrl),
                publishedAt,
                updatedAt: entry.updatedAt || publishedAt
            }
        }),
        latestUpdatedAt:
            latestDate(entries.flatMap((entry) => [entry.updatedAt, entry.publishedAt])) || manifest.generatedAt
    }
}

export function createAbsoluteUrl(route: string, siteUrl: string) {
    const absoluteUrl = URL.parse(route)
    if (absoluteUrl) return absoluteUrl.href

    const encodedRoute = route
        .split('/')
        .map((segment) => safeEncodePathSegment(segment))
        .join('/')

    return new URL(encodedRoute, siteUrl).toString()
}

function safeEncodePathSegment(segment: string) {
    try {
        return encodeURIComponent(decodeURIComponent(segment))
    } catch {
        return encodeURIComponent(segment)
    }
}

function latestDate(values: string[]) {
    return values.filter(Boolean).sort().at(-1) ?? ''
}

function uniqueStrings(values: string[]) {
    return values
        .map((value) => value.trim())
        .filter(Boolean)
        .filter((value, index, array) => array.indexOf(value) === index)
}

function escapeXml(value: unknown) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

function wrapCdata(value: unknown) {
    return `<![CDATA[${String(value).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
}
