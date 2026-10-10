import { createTranslator } from '../packages/config/src/i18n.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { globby } from 'globby'
import matter from 'gray-matter'
import { loadTiO2Project } from '../packages/config/src/project.js'

const TOP_TAG_LIMIT = 24

async function main() {
    const { rootDir, config } = await loadTiO2Project(process.env.TIO2_PROJECT_ROOT ?? process.cwd())
    const t = createTranslator(config.site.language)
    const postsDir = path.join(rootDir, config.content.postsDir)
    const topicsDir = path.join(rootDir, config.content.topicsDir)
    const args = parseArgs(t, process.argv.slice(2))
    const metadata = await collectExistingMetadata(t, postsDir, topicsDir, config.content.topicMetaFilename)

    if (args.help || !args.title) {
        printHelp(t, metadata)
        process.exit(args.help ? 0 : 1)
    }

    const now = new Date()
    const formattedDateTime = formatDateTime(now, config.site.timezoneOffset)
    const tags = normalizeTagsInput(args.tags)
    const topics = normalizeTopicsInput(args.topics)
    const fileName = createFileName(t, args.title)
    const filePath = path.join(postsDir, fileName)
    const assetDirectoryName = path.basename(fileName, '.md')
    const assetDirectoryPath = path.join(postsDir, assetDirectoryName)
    const relativeFilePath = toPosixPath(path.relative(rootDir, filePath))
    const relativeAssetDirectoryPath = toPosixPath(path.relative(rootDir, assetDirectoryPath))
    const sampleImageReference = `![${t('图片描述', 'Image description')}](<./${assetDirectoryName}/cover.webp>)`

    await assertFileDoesNotExist(t, filePath, rootDir)

    const document = createPostTemplate({
        title: args.title.trim(),
        date: formattedDateTime,
        tags,
        topics,
        description: args.description.trim(),
        category: args.category.trim()
    })

    if (!args.dryRun) {
        await fs.mkdir(assetDirectoryPath, { recursive: true })
        await fs.writeFile(filePath, document, 'utf8')
    }

    printCreationSummary(t, {
        dryRun: args.dryRun,
        filePath: relativeFilePath,
        assetDirectoryPath: relativeAssetDirectoryPath,
        sampleImageReference,
        title: args.title.trim(),
        date: formattedDateTime,
        category: args.category.trim() || t('（待填写）', '(not set)'),
        tags: tags.length ? `[${tags.join(', ')}]` : '[]',
        topics: topics.length ? `[${topics.join(', ')}]` : '[]',
        description: args.description.trim() || t('（待填写）', '(not set)')
    })

    printMetadataSuggestions(t, metadata)

    if (args.dryRun) {
        console.log(`
${t('预览内容', 'Preview content')}`)
        console.log(indentBlock(document.trimEnd(), 2))
    } else {
        console.log(`
${t('下一步', 'Next steps')}`)
        console.log(`  1. ${t('打开 ', 'Open ')}${relativeFilePath}`)
        console.log(`  2. ${t('把正文配图放进 ', 'Place article images in ')}${relativeAssetDirectoryPath}/`)
        console.log(
            `  3. ${t('用相对路径引用图片，例如：', 'Use relative image paths, for example: ')}${sampleImageReference}`
        )
        console.log(
            `  4. ${t('补全 description / category / tags 并开始写正文', 'Fill in description / category / tags and start writing')}`
        )
    }
}

function parseArgs(t, argv) {
    const result = {
        title: '',
        category: '',
        description: '',
        tags: [],
        topics: [],
        help: false,
        dryRun: false
    }

    for (let index = 0; index < argv.length; index++) {
        const current = argv[index]

        if (current === '-h' || current === '--help') {
            result.help = true
            continue
        }

        if (current === '--dry-run') {
            result.dryRun = true
            continue
        }

        if (current === '-c' || current === '--category') {
            result.category = takeOptionValue(t, argv, current, index)
            index += 1
            continue
        }

        if (current === '-d' || current === '--description') {
            result.description = takeOptionValue(t, argv, current, index)
            index += 1
            continue
        }

        if (current === '-t' || current === '--tags') {
            result.tags.push(takeOptionValue(t, argv, current, index))
            index += 1
            continue
        }

        if (current === '-p' || current === '--topics') {
            result.topics.push(takeOptionValue(t, argv, current, index))
            index += 1
            continue
        }

        if (!current.startsWith('-') && !result.title) {
            result.title = current
            continue
        }

        throw new Error(`${t('无法识别的参数：', 'Unrecognized argument: ')}${current}`)
    }

    return result
}

async function collectExistingMetadata(t, postsDir, topicsDir, topicMetaFilename) {
    const [postFiles, topicFiles] = await Promise.all([findMarkdownFiles(postsDir), findMarkdownFiles(topicsDir)])
    const files = [...postFiles, ...topicFiles.filter((file) => path.basename(file) !== topicMetaFilename)]

    const categories = new Map()
    const tags = new Map()
    const topics = new Map()

    for (const file of topicFiles) {
        const topicKey = getTopicKeyFromFile(file, topicsDir)
        if (topicKey) {
            incrementCounter(topics, topicKey)
        }
    }

    for (const file of files) {
        const raw = await fs.readFile(file, 'utf8')
        const { data } = matter(raw)

        if (typeof data.category === 'string' && data.category.trim()) {
            incrementCounter(categories, data.category.trim())
        }

        if (Array.isArray(data.tags)) {
            for (const tag of data.tags) {
                if (typeof tag === 'string' && tag.trim()) {
                    incrementCounter(tags, tag.trim())
                }
            }
        }

        for (const topicKey of normalizeTopicsInput(
            Array.isArray(data.topics) ? data.topics : [data.topics].filter(Boolean)
        )) {
            incrementCounter(topics, topicKey)
        }
    }

    return {
        categories: sortCounterEntries(t, categories),
        tags: sortCounterEntries(t, tags),
        topics: sortCounterEntries(t, topics)
    }
}

function findMarkdownFiles(directory) {
    return globby('**/*.md', {
        cwd: directory,
        absolute: true,
        dot: true,
        followSymbolicLinks: false
    })
}

function takeOptionValue(t, argv, optionName, optionIndex) {
    const nextValue = argv[optionIndex + 1]

    if (!nextValue || nextValue.startsWith('-')) {
        throw new Error(`${optionName}${t(' 缺少对应的值。', ' requires a value.')}`)
    }

    return nextValue
}

function createPostTemplate({ title, date, tags, topics, description, category }) {
    return [
        '---',
        `title: ${yamlScalar(title)}`,
        `date: ${yamlScalar(date)}`,
        `tags: ${yamlInlineArray(tags)}`,
        ...(topics.length ? [`topics: ${yamlInlineArray(topics)}`] : []),
        `description: ${yamlScalar(description)}`,
        `category: ${yamlScalar(category)}`,
        '---',
        '',
        ''
    ].join('\n')
}

function createFileName(t, title) {
    const sanitized = title
        .trim()
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')

    if (!sanitized) {
        throw new Error(t('标题不能为空。', 'Title cannot be empty.'))
    }

    return `${sanitized}.md`
}

async function assertFileDoesNotExist(t, filePath, rootDir) {
    try {
        await fs.access(filePath)
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return
        }
        throw error
    }

    throw new Error(`${t('文件已存在：', 'File already exists: ')}${toPosixPath(path.relative(rootDir, filePath))}`)
}

function normalizeTagsInput(rawValues) {
    return rawValues
        .flatMap((value) => value.split(/[，,]/))
        .map((value) => value.trim())
        .filter(Boolean)
        .filter((value, index, array) => array.indexOf(value) === index)
}

function normalizeTopicsInput(rawValues) {
    return rawValues
        .flatMap((value) => value.split(/[，,]/))
        .map((value) =>
            value
                .split(/[\\/]+/)
                .map((segment) => segment.trim())
                .filter(Boolean)
                .join('/')
        )
        .filter(Boolean)
        .filter((value, index, array) => array.indexOf(value) === index)
}

function incrementCounter(map, key) {
    map.set(key, (map.get(key) ?? 0) + 1)
}

function sortCounterEntries(t, map) {
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], t('zh-CN', 'en')))
}

function formatDateTime(date, timezoneOffset) {
    const [hours, minutes] = timezoneOffset.slice(1).split(':').map(Number)
    const offset = (hours * 60 + minutes) * (timezoneOffset.startsWith('-') ? -1 : 1)
    return new Date(date.getTime() + offset * 60_000).toISOString().slice(0, 19).replace('T', ' ')
}

function yamlScalar(value) {
    if (!value) return "''"

    const unsafeCharacters = new Set('#[]{}!,&*|>\'"%@`')
    const hasUnsafeCharacters = [...value].some((character) => unsafeCharacters.has(character))
    return hasUnsafeCharacters || /^\s|\s$/u.test(value) ? JSON.stringify(value) : value
}

function yamlInlineArray(values) {
    if (!values.length) return '[]'
    return `[${values.map((value) => yamlScalar(value)).join(', ')}]`
}

function printHelp(t, metadata) {
    console.log(t('用法', 'Usage'))
    console.log(`  tio2 new "${t('文章标题', 'Article title')}" [${t('选项', 'Options')}]`)
    console.log(
        `  ${t('（会同时创建同名图片目录，供正文使用相对路径引用）', '(Also creates a matching image directory for relative image references)')}`
    )
    console.log('')
    console.log(t('示例', 'Examples'))
    console.log(`  tio2 new "${t('TiO₂ 写作流', 'TiO₂ writing workflow')}"`)
    console.log(
        `  tio2 new "${t('TiO₂ 写作流', 'TiO₂ writing workflow')}" -c ${t('开发', 'Development')} -t TiO2,CLI -d "${t('记录博客写作流程', 'Notes on the writing workflow')}"`
    )
    console.log(`  tio2 new "${t('年度回顾', 'Annual review')}" -p ${t('年度总结', 'annual-review')}`)
    console.log(`  tio2 new "${t('TiO₂ 写作流', 'TiO₂ writing workflow')}" --dry-run`)
    console.log('')
    console.log(t('选项', 'Options'))
    console.log(`  -c, --category      ${t('指定分类', 'Set category')}`)
    console.log(
        `  -t, --tags          ${t('指定标签，多个标签用英文逗号或中文逗号分隔', 'Set tags, separated by commas')}`
    )
    console.log(
        `  -p, --topics        ${t('指定专题路径，多个专题用逗号分隔，例如 ', 'Set topic paths, separated by commas, e.g. ')}${t('年度总结', 'annual-review')}/2026`
    )
    console.log(`  -d, --description   ${t('指定摘要', 'Set description')}`)
    console.log(`      --dry-run       ${t('只预览，不写入文件', 'Preview without writing files')}`)
    console.log(`  -h, --help          ${t('显示帮助', 'Show help')}`)

    printMetadataSuggestions(t, metadata)
}

function printCreationSummary(
    t,
    { dryRun, filePath, assetDirectoryPath, sampleImageReference, title, date, category, tags, topics, description }
) {
    console.log(
        dryRun
            ? t('已生成预览（未写入文件）', 'Preview generated (no files written)')
            : t('已创建新文章', 'Article created')
    )
    printKeyValueRows([
        [t('文件路径', 'File path'), filePath],
        [t('图片目录', 'Image directory'), assetDirectoryPath],
        [t('图片示例', 'Image example'), sampleImageReference],
        [t('标题', 'Title'), title],
        [t('日期时间', 'Date and time'), date],
        [t('分类', 'Category'), category],
        [t('标签', 'Tags'), tags],
        [t('专题', 'Topics'), topics],
        [t('摘要', 'Description'), description]
    ])
}

function printMetadataSuggestions(t, metadata) {
    console.log(`
${t('现有分类', 'Existing categories')}`)
    printRankedList(t, metadata.categories)

    console.log(`
${t('可用专题', 'Available topics')}`)
    printRankedList(t, metadata.topics)

    console.log(`
${t('常用标签（Top ', 'Popular tags (top ')}${Math.min(TOP_TAG_LIMIT, metadata.tags.length)} / ${metadata.tags.length}${t('）', ')')}`)
    printRankedList(t, metadata.tags.slice(0, TOP_TAG_LIMIT))
}

function printKeyValueRows(rows) {
    const labelWidth = Math.max(...rows.map(([label]) => getDisplayWidth(label)))

    for (const [label, value] of rows) {
        console.log(`  ${padDisplay(label, labelWidth)}  ${value}`)
    }
}

function printRankedList(t, entries) {
    if (!entries.length) {
        console.log(`  ${t('（暂无）', '(none)')}`)
        return
    }

    const indexWidth = String(entries.length).length
    const labelWidth = Math.max(...entries.map(([label]) => getDisplayWidth(label)))

    for (const [index, [label, count]] of entries.entries()) {
        const order = `${String(index + 1).padStart(indexWidth, ' ')}.`
        console.log(`  ${order} ${padDisplay(label, labelWidth)}  ${count}`)
    }
}

function padDisplay(value, width) {
    const gap = width - getDisplayWidth(value)
    return value + ' '.repeat(Math.max(0, gap))
}

function getDisplayWidth(value) {
    return [...value].reduce((sum, character) => sum + (character.charCodeAt(0) > 255 ? 2 : 1), 0)
}

function indentBlock(value, spaces) {
    const prefix = ' '.repeat(spaces)
    return value
        .split('\n')
        .map((line) => `${prefix}${line}`)
        .join('\n')
}

function toPosixPath(value) {
    return value.split(path.sep).join('/')
}

function getTopicKeyFromFile(filePath, topicsDir) {
    const relativePath = toPosixPath(path.relative(topicsDir, filePath))
    const directory = path.posix.dirname(relativePath)

    if (!directory || directory === '.') {
        return ''
    }

    return directory
}

main().catch((error) => {
    console.error(`\n[post:new] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
})
