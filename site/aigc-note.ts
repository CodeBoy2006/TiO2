import { type Translator } from '../packages/config/src/i18n.js'
import { AIGC_MODELS, type AigcModelKey, type PostFrontMatter } from '../packages/content-core/src/index'
import { escapeHtmlAttribute, escapeHtmlText } from '../.vitepress/theme/markdownRendering'

type AigcFrontMatter = Pick<PostFrontMatter, 'aigcRate' | 'aigcModels' | 'humanWritten'>

const TAPE_CELLS = 10
const MIN_PARTIAL_CELL = 0.2
const humanDeclaration = (t: Translator) => t('文本未使用AI生成。', 'This text was written without AI generation.')

// One continuous hand-drawn stroke: an entry loop, two humps and a long exit flick.
const SIGNATURE_PATH =
    'M1.3 8.9C3.1 7.6 5.5 3.6 5.3 2.2C5.1 0.9 3.7 1.5 3.6 3.5C3.5 5.7 3.9 8.8 4.8 9.4C5.8 10.1 6.6 5.3 8.5 5.3C10.1 5.3 9.6 9.3 11 9.3C12.5 9.3 12.9 5.1 14.7 5.1C16.4 5.1 15.9 9.2 17.5 9.2C20.8 9.2 23.6 6.3 27.8 6.6C31.6 6.9 34.6 9.4 38.7 5.4'

/** Fill level (0–1) of each of the ten tape cells; a non-empty partial cell keeps a visible sliver. */
export function aigcTapeFills(rate: number): number[] {
    return Array.from({ length: TAPE_CELLS }, (_, index) => {
        const fill = Math.max(0, Math.min(1, rate / 10 - index))
        const visible = fill > 0 && fill < MIN_PARTIAL_CELL ? MIN_PARTIAL_CELL : fill
        return Math.round(visible * 100) / 100
    })
}

export function renderAigcSignature(className = 'aigc-sig') {
    return `<svg class="${className}" viewBox="0 0 40 12" aria-hidden="true" focusable="false"><path pathLength="100" d="${SIGNATURE_PATH}"></path></svg>`
}

export function renderAigcMark(model: AigcModelKey) {
    const meta = AIGC_MODELS[model]
    if (!meta) return ''
    return `<i class="aigc-mark${meta.monochrome ? ' aigc-mark--mono' : ''}" style="--aigc-icon:url(${escapeHtmlAttribute(meta.icon)})"></i>`
}

/** The marginal AIGC note shown in list entries: a signature for human-written posts, otherwise the ten-cell tape. */
export function renderAigcNote(t: Translator, frontMatter: AigcFrontMatter) {
    if (frontMatter.humanWritten) {
        return `<span class="aigc-note aigc-note--human" role="img" aria-label="${humanDeclaration(t)}" title="${t('亲笔', 'Human-written')} · ${humanDeclaration(t)}">${renderAigcSignature()}<span class="aigc-note__label aigc-note__hand" aria-hidden="true">${t('亲笔', 'Human-written')}</span></span>`
    }

    const rate = frontMatter.aigcRate
    if (rate === undefined) return ''

    const models = (frontMatter.aigcModels ?? []).filter((model) => AIGC_MODELS[model])
    const labels = models.map((model) => AIGC_MODELS[model].label)
    const ariaLabel = `${t('AIGC 率 ', 'AI-generated content: ')}${rate}%${labels.length ? `${t('，模型：', '; models: ')}${labels.join(t('、', ', '))}` : ''}`
    const title = [
        `${t('AIGC 率 ', 'AI-generated content: ')}${rate}%`,
        ...models.map((model) => `${AIGC_MODELS[model].label} · ${AIGC_MODELS[model].vendor}`)
    ].join('\n')
    const marks = models.length
        ? `<span class="aigc-marks" aria-hidden="true">${models.map(renderAigcMark).join('')}</span>`
        : ''
    const cells = aigcTapeFills(rate)
        .map((fill, index) => `<i style="--f:${fill};--k:${index}"></i>`)
        .join('')

    return `<span class="aigc-note" role="img" aria-label="${escapeHtmlAttribute(ariaLabel)}" title="${escapeHtmlAttribute(title)}">${marks}<span class="aigc-tape" aria-hidden="true">${cells}</span><span class="aigc-note__label aigc-note__value" aria-hidden="true">${rate}%</span></span>`
}

/** One-line disclosure for article colophons: the note followed by model names or the human declaration. */
export function renderAigcSummary(t: Translator, frontMatter: AigcFrontMatter) {
    const note = renderAigcNote(t, frontMatter)
    if (!note) return ''
    const detail = frontMatter.humanWritten
        ? humanDeclaration(t)
        : (frontMatter.aigcModels ?? []).flatMap((model) => AIGC_MODELS[model]?.label ?? []).join(' · ')
    return `<span class="aigc-summary">${note}${detail ? `<span class="aigc-summary__detail">${escapeHtmlText(detail)}</span>` : ''}</span>`
}

/** The article's closing disclosure keeps the circular rate and readable model names. */
export function renderAigcDisclosure(t: Translator, frontMatter: AigcFrontMatter) {
    const rate = frontMatter.aigcRate
    if (frontMatter.humanWritten || rate === undefined) return renderAigcSummary(t, frontMatter)
    const models = (frontMatter.aigcModels ?? [])
        .filter((model) => AIGC_MODELS[model])
        .map(
            (model) =>
                `<span class="aigc-model">${renderAigcMark(model)}<span>${escapeHtmlText(AIGC_MODELS[model].label)}</span></span>`
        )
        .join('')
    return `<span class="aigc-disclosure"><span class="aigc-ring" role="img" aria-label="${t('AIGC 率 ', 'AI-generated content: ')}${rate}%"><svg class="aigc-ring__svg" viewBox="0 0 82 82" aria-hidden="true" focusable="false"><circle class="aigc-ring__track" cx="41" cy="41" r="30"></circle><circle class="aigc-ring__progress" cx="41" cy="41" r="30" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100 - rate}"></circle></svg><span class="aigc-ring__value" aria-hidden="true">${rate}%</span></span>${models ? `<span class="aigc-models" aria-label="${t('使用的 AI 模型', 'AI models used')}">${models}</span>` : ''}</span>`
}
