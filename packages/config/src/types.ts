import type { FoundationGroupDefinition, FoundationRoute } from '../../content-core/src/types.js'

export interface TiO2FrameworkMeta {
    name: string
    asciiName: string
}
export interface TiO2SiteConfig {
    title: string
    url: string
    description: string
    language: string
    timezoneOffset: string
    author: string
    authorUrl: string
    socialImage: string
    themeColor: string
    copyrightStartYear: number | null
    contentLicense: string
}
export interface TiO2ContentConfig {
    postsDir: string
    topicsDir: string
    foundationsDir: string
    pagesDir: string
    topicMetaFilename: string
    pageSize: number
    productionIgnorePatterns: string[]
}
export interface TiO2NavItem {
    text: string
    link: string
    /** Regular expression tested against the canonical path. */
    activeMatch?: string
}
export interface TiO2SocialLink {
    icon: string
    link: string
}
export interface TiO2SearchBoostConfig {
    [fieldName: string]: number
    title: number
    text: number
}
export interface TiO2SearchConfig {
    provider: 'local'
    miniSearch: {
        fuzzy: number
        prefix: boolean
        boost: TiO2SearchBoostConfig
    }
}
export interface TiO2ThemeConfig {
    nav: TiO2NavItem[]
    socialLinks: TiO2SocialLink[]
    outlineLabel: string
    search: TiO2SearchConfig
    /** Trusted HTML appended to the document head. */
    head: string
    /** Project-relative browser entry; it may import custom CSS and lazy features. */
    clientEntry: string
    /** Project-relative module exporting a document renderer. Empty uses the default theme. */
    layout: string
    /** Markdown source paths mapped to project-relative page renderer modules. */
    pages: Record<string, string>
}
export interface TiO2CommentConfig {
    provider: 'giscus'
    repo: string
    repoId: string
    categoryId: string
    category: string
}
export interface TiO2IntegrationsConfig {
    vercelAnalytics: boolean
    feed: boolean
    sitemap: boolean
}
export interface TiO2Config {
    site: TiO2SiteConfig
    content: TiO2ContentConfig
    theme: TiO2ThemeConfig
    comment: false | TiO2CommentConfig
    integrations: TiO2IntegrationsConfig
    foundations: {
        /** Public name of the knowledge library. Breadcrumbs, search and reference previews all use it. */
        title?: string
        /** Latin lettering for the display band on the library's landing page. */
        englishTitle?: string
        /** One line under the landing-page title that states the subject range. */
        subtitle?: string
        groups: FoundationGroupDefinition[]
        routes: FoundationRoute[]
    }
}
export interface TiO2ConfigInput {
    site: Pick<TiO2SiteConfig, 'title' | 'url'> & Partial<Omit<TiO2SiteConfig, 'title' | 'url'>>
    content?: Partial<TiO2ContentConfig>
    theme?: Partial<Omit<TiO2ThemeConfig, 'search'>> & {
        search?: Partial<Omit<TiO2SearchConfig, 'miniSearch'>> & {
            miniSearch?: Partial<Omit<TiO2SearchConfig['miniSearch'], 'boost'>> & {
                boost?: Partial<TiO2SearchBoostConfig>
            }
        }
    }
    comment?: false | TiO2CommentConfig
    integrations?: Partial<TiO2IntegrationsConfig>
    foundations?: Partial<TiO2Config['foundations']>
}
export interface TiO2Project {
    rootDir: string
    config: TiO2Config
}
