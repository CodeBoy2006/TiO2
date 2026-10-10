import path from 'node:path'
import type { TiO2Project } from '../../config/src/types.js'
import { globby } from 'globby'
import {
    assignNavigation,
    attachArticlesToTopics,
    buildReferenceGraph,
    compareArticleDate,
    createFoundationCollection,
    createTopicNode,
    ensureTopicNode,
    extractReferences,
    finalizeTopicNode,
    getTopicSegments,
    type BlogPost,
    type AdditionalReferenceSource,
    type FoundationCollection,
    type TopicCollection,
    type TopicNode
} from '../../content-core/src/index'
import { loadArticleDocument, type ParsedArticleDocument } from './article-document'
import {
    getFoundationIgnorePatterns,
    getFoundationSourcePatterns,
    getPostIgnorePatterns,
    getPostSourcePatterns,
    getTopicArticleIgnorePatterns,
    getTopicArticleSourcePatterns,
    getTopicMetaIgnorePatterns,
    getTopicMetaSourcePatterns
} from './content-paths'
import { createPublishingManifest } from './publishing'
import { parseTopicMetaFile } from './topic-meta'
import { loadFoundationDocument } from './foundations'
import { readMarkdownSource } from './markdown-source'

const ROOT_TOPIC_COLLECTION_KEY = '__topics__root__'

export interface LoadSiteContentOptions {
    env?: string
}

export async function loadPosts(project: TiO2Project, options: LoadSiteContentOptions = {}) {
    const { env = process.env.NODE_ENV } = options
    const contentConfig = project.config.content
    const isProd = env === 'production'
    const paths = await globby(getPostSourcePatterns(contentConfig), {
        cwd: project.rootDir,
        ignore: getPostIgnorePatterns(contentConfig, { production: isProd })
    })

    const documents = await Promise.all(
        paths.map(async (item) =>
            loadArticleDocument(item, 'post', 'posts', {
                language: project.config.site.language,
                source: await readMarkdownSource(path.resolve(project.rootDir, item))
            })
        )
    )
    const posts = documents.map((item) => item.post)
    posts.sort(compareArticleDate)
    assignNavigation(posts)

    return {
        posts,
        documents
    }
}

export async function loadSiteContent(project: TiO2Project, options: LoadSiteContentOptions = {}) {
    const { env = process.env.NODE_ENV } = options
    const contentConfig = project.config.content
    const [{ posts, documents: postDocuments }, foundations] = await Promise.all([
        loadPosts(project, { env }),
        loadFoundations(project, env)
    ])
    const { topics, topicArticles, documents: topicDocuments } = await loadTopics(project, posts, env)
    const articles = [...posts, ...topicArticles]
    const foundationReferenceSources: AdditionalReferenceSource[] = await Promise.all(
        foundations.entries.map(async (entry) => ({
            sourcePath: entry.sourcePath,
            sourceTitle: entry.title,
            sourceHref: entry.regularPath,
            sourceKind: 'foundation',
            sourcePublishedAt: '',
            references: extractReferences(
                (await readMarkdownSource(path.resolve(project.rootDir, entry.sourcePath))).content
            )
        }))
    )
    const publishing = await createPublishingManifest({
        project,
        posts,
        topicArticles,
        foundations: foundations.entries,
        pageSize: contentConfig.pageSize,
        siteTitle: project.config.site.title,
        timezoneOffset: project.config.site.timezoneOffset,
        env
    })
    const publishedRoutes = new Set(publishing.entries.map((entry) => entry.route))
    for (const route of foundations.routes) {
        if (route.capstoneHref && !publishedRoutes.has(route.capstoneHref.split('#')[0])) {
            throw new Error(`Foundation route “${route.id}” references unpublished capstone “${route.capstoneHref}”`)
        }
    }
    const topicIndexRoute = publishing.entries.find(
        (entry) => entry.kind === 'page' && entry.sourcePath === `${contentConfig.pagesDir}/topics.md`
    )?.route
    const references = buildReferenceGraph([...postDocuments, ...topicDocuments], topics, {
        topicIndexRoute,
        foundations,
        additionalReferenceSources: foundationReferenceSources
    })
    const unresolvedFoundationReferences = Object.entries(references.unresolvedBySourcePath).filter(([sourcePath]) =>
        sourcePath.startsWith(`${contentConfig.foundationsDir}/`)
    )
    if (env === 'production' && unresolvedFoundationReferences.length) {
        throw new Error(
            `Invalid foundation references:\n${unresolvedFoundationReferences
                .map(([sourcePath, unresolved]) => `- ${sourcePath}: ${unresolved.join(', ')}`)
                .join('\n')}`
        )
    }

    return {
        posts,
        topics,
        foundations,
        topicArticles,
        articles,
        references,
        publishing
    }
}

export async function loadFoundations(project: TiO2Project, env = process.env.NODE_ENV): Promise<FoundationCollection> {
    const contentConfig = project.config.content
    const paths = await globby(getFoundationSourcePatterns(contentConfig), {
        cwd: project.rootDir,
        ignore: getFoundationIgnorePatterns(contentConfig, { production: env === 'production' })
    })
    const entries = await Promise.all(
        paths.map(async (sourcePath) =>
            loadFoundationDocument(sourcePath, {
                source: await readMarkdownSource(path.resolve(project.rootDir, sourcePath))
            })
        )
    )
    const entryIds = new Set(entries.map((entry) => entry.id))
    const routes = project.config.foundations.routes.filter((route) => route.entries.every((id) => entryIds.has(id)))
    return createFoundationCollection(entries, { groups: project.config.foundations.groups, routes })
}

async function loadTopics(
    project: TiO2Project,
    posts: BlogPost[],
    env = process.env.NODE_ENV
): Promise<{ topics: TopicCollection; topicArticles: BlogPost[]; documents: ParsedArticleDocument[] }> {
    const isProd = env === 'production'
    const contentConfig = project.config.content

    const [articlePaths, metaPaths] = await Promise.all([
        globby(getTopicArticleSourcePatterns(contentConfig), {
            cwd: project.rootDir,
            ignore: getTopicArticleIgnorePatterns(contentConfig, { production: isProd })
        }),
        globby(getTopicMetaSourcePatterns(contentConfig), {
            cwd: project.rootDir,
            ignore: getTopicMetaIgnorePatterns(contentConfig, { production: isProd })
        })
    ])

    const root = createTopicNode('')
    const topicMap = new Map<string, TopicNode>([['', root]])

    for (const metaPath of metaPaths) {
        const segments = getTopicSegments(metaPath, contentConfig.topicsDir)
        const node = ensureTopicNode(topicMap, root, segments)
        const meta = await parseTopicMetaFile(path.resolve(project.rootDir, metaPath))

        if (meta.title) {
            node.title = meta.title
        }
        if (meta.description) {
            node.description = meta.description
        }
        node.order = meta.order
    }

    const documents: ParsedArticleDocument[] = await Promise.all(
        articlePaths.map(async (item) => {
            const segments = getTopicSegments(item, contentConfig.topicsDir)
            const node = ensureTopicNode(topicMap, root, segments)
            const document = await loadArticleDocument(item, 'topic', node.key || ROOT_TOPIC_COLLECTION_KEY, {
                language: project.config.site.language,
                source: await readMarkdownSource(path.resolve(project.rootDir, item))
            })
            document.post.topicKey = node.key
            node.articles.push(document.post)
            return document
        })
    )

    const attachedArticlesCount = attachArticlesToTopics(topicMap, root, [
        ...posts,
        ...documents.map((item) => item.post)
    ])
    finalizeTopicNode(root, [], ROOT_TOPIC_COLLECTION_KEY)

    return {
        topics: {
            roots: root.children,
            topicCount: topicMap.size - 1,
            articleCount: documents.length + attachedArticlesCount
        },
        topicArticles: documents.map((item) => item.post),
        documents
    }
}
