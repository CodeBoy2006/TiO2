import { createTranslator } from '../../packages/config/src/i18n.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { aigcTapeFills, renderAigcDisclosure, renderAigcNote, renderAigcSummary } from '../../site/aigc-note.js'

function cellFills(html: string) {
    return [...html.matchAll(/<i style="--f:([\d.]+);--k:(\d+)"><\/i>/g)].map((match) => Number(match[1]))
}

test('TiO2 AIGC note renders nothing without a disclosure', () => {
    assert.equal(renderAigcNote(createTranslator('zh-CN'), {}), '')
    assert.equal(renderAigcNote(createTranslator('zh-CN'), { aigcModels: ['openai'] }), '')
})

test('TiO2 AIGC note fills ten cells in two groups of five', () => {
    assert.deepEqual(aigcTapeFills(0), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    assert.deepEqual(aigcTapeFills(75), [1, 1, 1, 1, 1, 1, 1, 0.5, 0, 0])
    assert.deepEqual(aigcTapeFills(100), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
    assert.deepEqual(aigcTapeFills(76.7), [1, 1, 1, 1, 1, 1, 1, 0.67, 0, 0])
    assert.deepEqual(aigcTapeFills(1), [0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0])
})

test('TiO2 AIGC note labels the rate and registered vendor marks', () => {
    const html = renderAigcNote(createTranslator('zh-CN'), { aigcRate: 75, aigcModels: ['openai', 'gemini'] })

    assert.match(html, /role="img" aria-label="AIGC 率 75%，模型：OpenAI、Gemini"/)
    assert.match(html, /title="AIGC 率 75%\nOpenAI · OpenAI\nGemini · Google"/)
    assert.deepEqual(cellFills(html), [1, 1, 1, 1, 1, 1, 1, 0.5, 0, 0])
    assert.match(html, /<i class="aigc-mark aigc-mark--mono" style="--aigc-icon:url\(\/ai-icons\/openai\.svg\)"><\/i>/)
    assert.match(html, /<i class="aigc-mark" style="--aigc-icon:url\(\/ai-icons\/gemini-color\.svg\)"><\/i>/)
    assert.match(html, /aigc-note__value" aria-hidden="true">75%<\/span>/)
})

test('TiO2 AIGC note shows an empty tape for an explicit zero rate', () => {
    const html = renderAigcNote(createTranslator('zh-CN'), { aigcRate: 0 })

    assert.match(html, /aria-label="AIGC 率 0%"/)
    assert.ok(!html.includes('aigc-marks'))
    assert.deepEqual(cellFills(html), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
})

test('TiO2 AIGC note prefers the human-written signature', () => {
    const html = renderAigcNote(createTranslator('zh-CN'), { humanWritten: true, aigcRate: 0 })

    assert.match(html, /class="aigc-note aigc-note--human" role="img" aria-label="文本未使用AI生成。"/)
    assert.match(html, /<svg class="aigc-sig"/)
    assert.match(html, />亲笔<\/span>/)
    assert.ok(!html.includes('aigc-tape'))
})

test('TiO2 AIGC summary names the models or the human declaration', () => {
    assert.equal(renderAigcSummary(createTranslator('zh-CN'), {}), '')
    assert.match(
        renderAigcSummary(createTranslator('zh-CN'), { aigcRate: 75, aigcModels: ['openai', 'gemini'] }),
        /<span class="aigc-summary__detail">OpenAI · Gemini<\/span>/
    )
    assert.match(
        renderAigcSummary(createTranslator('zh-CN'), { humanWritten: true }),
        /<span class="aigc-summary__detail">文本未使用AI生成。<\/span>/
    )
    assert.ok(!renderAigcSummary(createTranslator('zh-CN'), { aigcRate: 10 }).includes('aigc-summary__detail'))
})

test('TiO2 closing disclosure renders exact circular rates and preserves human declarations', () => {
    for (const rate of [0, 76.7, 100]) {
        const html = renderAigcDisclosure(createTranslator('zh-CN'), {
            aigcRate: rate,
            aigcModels: ['openai', 'gemini']
        })
        assert.ok(html.includes(`aria-label="AIGC 率 ${rate}%"`))
        assert.ok(html.includes(`stroke-dashoffset="${100 - rate}"`))
        assert.match(html, /pathLength="100" stroke-dasharray="100"/)
        assert.match(html, />OpenAI<\/span>/)
        assert.match(html, />Gemini<\/span>/)
        assert.doesNotMatch(html, /aigc-tape/)
    }
    assert.equal(renderAigcDisclosure(createTranslator('zh-CN'), {}), '')
    assert.equal(renderAigcDisclosure(createTranslator('zh-CN'), { aigcModels: ['openai'] }), '')
    const human = renderAigcDisclosure(createTranslator('zh-CN'), { humanWritten: true, aigcRate: 0 })
    assert.match(human, /文本未使用AI生成。/)
    assert.doesNotMatch(human, /aigc-ring/)
})
