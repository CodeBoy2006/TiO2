import assert from 'node:assert/strict'
import test from 'node:test'
import { CompletionContext } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import type { EditorView } from '@codemirror/view'
import { buildLinkTargets, createWritingCompletion, imageMarkdown } from '../../apps/cms-web/src/editor-completion'
import type { CmsLibraryItem, CmsLibrarySnapshot } from '../../apps/cms-web/src/types'

function item(sourcePath: string, title: string, kind: CmsLibraryItem['kind'] = 'post'): CmsLibraryItem {
    return { sourcePath, title, kind, description: '', category: '', tags: [], topics: [], date: '' }
}
const library: CmsLibrarySnapshot = {
    documents: [
        item('posts/a.md', '同名'),
        item('posts/b.md', '同名'),
        item('posts/hello.md', '你好'),
        item('pages/about.md', 'About', 'page'),
        item('pages/topics.md', 'Topics', 'page'),
        item('topics/计算/_meta.md', '计算专题', 'topicMeta'),
        {
            ...item('foundations/vector-clock.md', '向量时钟', 'foundation'),
            foundation: { id: 'vector-clock', kind: 'definition', equivalent_to: [], contrasts_with: [] },
            aliases: ['Vector clock']
        }
    ],
    stats: { post: 3, topic: 0, foundation: 1, page: 2, topicMeta: 1 },
    tree: [
        { type: 'root', rootKey: 'topics', path: 'topics', documentCount: 1, children: [] },
        { type: 'root', rootKey: 'pages', path: 'pages', documentCount: 2, children: [] }
    ],
    content: { topicMetaFilename: '_meta.md', foundationDomains: [] }
}

test('link targets use stable knowledge IDs, topic keys, and unambiguous article titles', () => {
    const targets = buildLinkTargets(library)
    assert.equal(targets.find((target) => target.title === '你好')?.wiki, '你好')
    assert.ok(targets.filter((target) => target.title === '同名').every((target) => target.wiki === null))
    assert.equal(targets.find((target) => target.kind === 'foundation')?.wiki, 'foundation:vector-clock')
    assert.equal(targets.find((target) => target.kind === 'topicMeta')?.wiki, 'topic:计算')
    assert.equal(targets.find((target) => target.kind === 'page')?.wiki, null)
    assert.equal(imageMarkdown('/uploads/image.png', 'a [diagram]'), '![a \\[diagram\\]](/uploads/image.png)')
})

test('writing completion handles aliases, code exclusions, heading slugs and existing link labels', async () => {
    const source = createWritingCompletion(
        () => buildLinkTargets(library),
        () => 'posts/hello.md',
        (message) => assert.fail(message)
    )
    const complete = (doc: string, pos = doc.length) =>
        source(new CompletionContext(EditorState.create({ doc, extensions: [markdown()] }), pos, true))
    const alias = await complete('[[Vector')
    assert.equal(alias?.options[0].label, '向量时钟')
    assert.equal(await complete('```md\n[[Vector'), null)
    assert.equal(await complete('`[[Vector`', 9), null)
    assert.equal(await complete('普通文字'), null)
    const heading = await complete('# 第一节\n\n[[#第')
    assert.equal(heading?.options[0].detail, '#第一节')
    const existing = '[[你|链接文字]]'
    let state = EditorState.create({ doc: existing, extensions: [markdown()] })
    const result = await source(new CompletionContext(state, 3, true))
    const option = result?.options[0]
    assert.equal(typeof option?.apply, 'function')
    if (option && typeof option.apply === 'function') {
        const view = {
            get state() {
                return state
            },
            dispatch(spec: Parameters<EditorState['update']>[0]) {
                state = state.update(spec).state
            }
        } as EditorView
        option.apply(view, option, result!.from, 3)
        assert.equal(state.doc.toString(), '[[你好|链接文字]]')
        state = state.update({ changes: { from: 0, to: state.doc.length, insert: '[[同名' } }).state
        const duplicate = await source(new CompletionContext(state, state.doc.length, true))
        const completion = duplicate!.options[0]
        assert.equal(typeof completion.apply, 'function')
        if (typeof completion.apply === 'function')
            completion.apply(view, completion, duplicate!.from, state.doc.length)
        assert.equal(state.doc.toString(), '[同名](/posts/a.html)')
    }
    const path = await complete('[链接](/pages/abo')
    assert.equal(path?.options[0].label, 'About')
    const embed = await complete('![[About')
    assert.equal(embed?.options.length, 0)
    for (const [doc, expected] of [
        ['# 第一节\n\n[[#第', '# 第一节\n\n[[#第一节]]'],
        ['[链接](/pages/abo', '[链接](/pages/about.html)'],
        ['[链接](/pages/abo)', '[链接](/pages/about.html)'],
        ['[链接](/pages/abo "提示文字")', '[链接](/pages/about.html "提示文字")'],
        ["[链接](/pages/abo '提示文字')", "[链接](/pages/about.html '提示文字')"],
        ['[链接](/pages/abo (提示文字))', '[链接](/pages/about.html (提示文字))']
    ]) {
        let current = EditorState.create({ doc, extensions: [markdown()] })
        const pos = doc.includes('/pages/abo') ? doc.indexOf('/pages/abo') + '/pages/abo'.length : doc.length
        const completion = await source(new CompletionContext(current, pos, true))
        const selected = completion!.options[0]
        const view = {
            get state() {
                return current
            },
            dispatch(spec: Parameters<EditorState['update']>[0]) {
                current = current.update(spec).state
            }
        } as EditorView
        assert.equal(typeof selected.apply, 'function')
        if (typeof selected.apply === 'function') selected.apply(view, selected, completion!.from, pos)
        assert.equal(current.doc.toString(), expected)
    }
    const foundationSource = createWritingCompletion(
        () => buildLinkTargets(library),
        () => 'foundations/vector-clock.md',
        assert.fail
    )
    for (const [doc, expected] of [
        ['# 定义\n\n[[#定', '# 定义\n\n[定义](#定义)'],
        ['# 定义\n\n[[foundation:vector-clock#定', '# 定义\n\n[定义](/foundations/vector-clock.html#定义)']
    ]) {
        let current = EditorState.create({ doc, extensions: [markdown()] })
        const completion = await foundationSource(new CompletionContext(current, doc.length, true))
        const selected = completion!.options[0]
        const view = {
            get state() {
                return current
            },
            dispatch(spec: Parameters<EditorState['update']>[0]) {
                current = current.update(spec).state
            }
        } as EditorView
        if (typeof selected.apply === 'function') selected.apply(view, selected, completion!.from, doc.length)
        assert.equal(current.doc.toString(), expected)
    }
})
