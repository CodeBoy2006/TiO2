<template>
    <aside
        id="document-inspector"
        ref="panel"
        class="inspector-drawer"
        tabindex="-1"
        :aria-label="t('文档信息', 'Document information')"
        @keydown.esc.stop="emit('close')"
    >
        <header class="inspector-drawer__header">
            <div
                class="segmented-control inspector-tabs"
                role="group"
                :aria-label="t('文档信息视图', 'Document information view')"
            >
                <button
                    type="button"
                    :class="['segment-button', { active: tab === 'details' }]"
                    :aria-pressed="tab === 'details'"
                    @click="tab = 'details'"
                >
                    {{ t('属性', 'Properties') }}
                </button>
                <button
                    type="button"
                    :class="['segment-button', { active: tab === 'structure' }]"
                    :aria-pressed="tab === 'structure'"
                    @click="tab = 'structure'"
                >
                    {{ t('结构', 'Structure') }}
                </button>
            </div>

            <button class="ghost-button" type="button" @click="emit('close')">{{ t('关闭', 'Close') }}</button>
        </header>

        <div v-if="tab === 'details'" class="inspector-drawer__body">
            <div class="form-grid form-grid--single">
                <template v-if="draft.kind === 'post' || draft.kind === 'topic'">
                    <label class="field">
                        <span>{{ t('发布时间', 'Publication date') }}</span>
                        <input
                            v-model="draft.date"
                            type="text"
                            placeholder="YYYY-MM-DD HH:mm:ss"
                            :disabled="isSaving"
                        />
                    </label>
                    <label class="field">
                        <span>{{ t('更新时间', 'Last updated') }}</span>
                        <input
                            v-model="draft.lastUpdated"
                            type="text"
                            placeholder="YYYY-MM-DD HH:mm:ss"
                            :disabled="isSaving"
                        />
                    </label>
                    <label class="field">
                        <span>{{ t('分类', 'Category') }}</span>
                        <input v-model="draft.category" type="text" list="cms-category-options" :disabled="isSaving" />
                    </label>
                </template>
                <label class="field field--full">
                    <span>{{ t('摘要', 'Description') }}</span>
                    <textarea v-model="draft.description" rows="4" :disabled="isSaving"></textarea>
                </label>

                <FoundationFields
                    v-if="draft.kind === 'foundation'"
                    v-model="draft"
                    :domains="foundationDomains"
                    :entries="foundationEntries"
                    :disabled="isSaving"
                    :relation-warnings="foundationRelationWarnings"
                />

                <label v-if="draft.kind !== 'foundation'" class="field">
                    <span>{{ t('排序', 'Order') }}</span>
                    <input v-model="draft.order" type="number" :disabled="isSaving" />
                </label>

                <CsvSuggestionField
                    v-if="draft.kind !== 'foundation'"
                    v-model="draft.tagsText"
                    :label="t('标签', 'Tags')"
                    placeholder="framework, cms"
                    :suggestions="tagSuggestions"
                    :disabled="isSaving"
                />

                <CsvSuggestionField
                    v-if="draft.kind !== 'foundation'"
                    v-model="draft.topicsText"
                    :label="t('所属专题', 'Topics')"
                    :placeholder="t('TiO2/Core, 年度总结', 'TiO2/Core, annual-review')"
                    :suggestions="topicSuggestions"
                    :disabled="isSaving"
                />

                <section v-if="draft.kind === 'post' || draft.kind === 'topic'" class="cover-fields field--full">
                    <header class="cover-fields__header">
                        <div>
                            <strong>{{ t('文章封面', 'Article cover') }}</strong>
                            <span>{{
                                t('仅使用当前文章显式配置的封面。', 'Uses the cover configured for this article.')
                            }}</span>
                        </div>
                    </header>

                    <div
                        v-if="coverPreviewSrc"
                        :class="['cover-preview', { 'cover-preview--contain': draft.coverFit === 'contain' }]"
                    >
                        <img
                            :src="coverPreviewSrc"
                            :alt="draft.coverAlt"
                            :style="{ objectPosition: draft.coverPosition || 'center' }"
                        />
                    </div>

                    <label class="field field--full">
                        <span>{{ t('封面路径', 'Cover path') }}</span>
                        <input
                            v-model="draft.coverSrc"
                            type="text"
                            placeholder="/covers/article-name.svg"
                            :disabled="isSaving"
                        />
                    </label>
                    <button class="quiet-button" type="button" :disabled="isSaving" @click="showCoverPicker = true">
                        {{ t('选择图片…', 'Choose image…') }}
                    </button>

                    <label class="field field--full">
                        <span>{{ t('替代文本', 'Alternative text') }}</span>
                        <input v-model="draft.coverAlt" type="text" :disabled="isSaving" />
                    </label>

                    <label class="field">
                        <span>{{ t('呈现方式', 'Display mode') }}</span>
                        <select v-model="draft.coverFit" :disabled="isSaving">
                            <option value="cover">{{ t('裁切填满', 'Crop to fill') }}</option>
                            <option value="contain">{{ t('完整展示', 'Show full image') }}</option>
                        </select>
                    </label>

                    <label class="field">
                        <span>{{ t('焦点位置', 'Focal point') }}</span>
                        <input
                            v-model="draft.coverPosition"
                            type="text"
                            placeholder="center / 60% 45%"
                            :disabled="isSaving"
                        />
                    </label>
                </section>

                <details class="advanced-fields">
                    <summary>{{ t('高级属性', 'Advanced properties') }}</summary>
                    <label class="field">
                        <span>{{ t('附加属性（JSON）', 'Additional properties (JSON)') }}</span>
                        <textarea
                            v-model="draft.extraFrontmatterJson"
                            rows="12"
                            :disabled="isSaving"
                            spellcheck="false"
                        ></textarea>
                    </label>
                </details>
            </div>
        </div>

        <div v-else class="inspector-drawer__body">
            <p class="field-hint">{{ t('以下结构来自已保存的内容。', 'Structure is based on the saved content.') }}</p>
            <div class="token-block">
                <strong>{{ t('文件位置', 'Location') }}</strong>
                <p class="muted">{{ currentDocument.sourcePath }}</p>
            </div>

            <div class="token-block">
                <strong>{{ t('内容摘录', 'Excerpt') }}</strong>
                <p class="muted">{{ currentDocument.excerpt || t('暂无摘要', 'No excerpt') }}</p>
            </div>

            <div class="token-block">
                <strong>{{ t('标题大纲', 'Headings') }}</strong>
                <ul>
                    <li v-for="heading in currentDocument.headings" :key="heading.slug">
                        H{{ heading.level }} · {{ heading.title }}
                    </li>
                    <li v-if="!currentDocument.headings.length" class="muted">{{ t('无 heading', 'No headings') }}</li>
                </ul>
            </div>

            <div class="token-block">
                <strong>{{ t('引用', 'References') }}</strong>
                <ul>
                    <li v-for="reference in currentDocument.references" :key="reference.raw">
                        {{ reference.embed ? 'Embed' : 'Link' }} · {{ reference.raw }}
                    </li>
                    <li v-if="!currentDocument.references.length" class="muted">
                        {{ t('无 wiki 引用', 'No wiki references') }}
                    </li>
                </ul>
            </div>

            <div class="token-block">
                <strong>{{ t('资源目录', 'Assets') }}</strong>
                <p class="muted">
                    {{
                        currentDocument.assetDirectoryPath ??
                        t('当前文档没有独立资源目录', 'This document has no separate asset directory')
                    }}
                </p>
            </div>
        </div>
    </aside>
    <ImagePicker
        v-if="showCoverPicker"
        :source-path="currentDocument.sourcePath"
        cover
        @close="showCoverPicker = false"
        @select="selectCover"
    />
</template>

<script setup lang="ts">
import { t } from '../i18n'

import { computed, onMounted, ref } from 'vue'
import type { CmsDocumentDraft } from '../draft'
import type { CmsDocumentDetail } from '../types'
import CsvSuggestionField from './CsvSuggestionField.vue'
import FoundationFields from './FoundationFields.vue'
import ImagePicker from './ImagePicker.vue'
import type { CmsImageAsset } from '../types'

type InspectorTab = 'details' | 'structure'

const props = defineProps<{
    currentDocument: CmsDocumentDetail
    isSaving: boolean
    tagSuggestions: string[]
    topicSuggestions: string[]
    foundationDomains: Array<{ id: string; title: string }>
    foundationEntries: Array<{ id: string; title: string }>
    previewOrigin: string
    foundationRelationWarnings: string[]
}>()

const emit = defineEmits<{
    close: []
}>()
const draft = defineModel<CmsDocumentDraft>('draft', { required: true })
const panel = ref<HTMLElement | null>(null)
const showCoverPicker = ref(false)
const selectedCover = ref<CmsImageAsset | null>(null)
function selectCover(asset: CmsImageAsset, alt: string) {
    selectedCover.value = asset
    draft.value.coverSrc = asset.publicSrc || asset.src
    draft.value.coverAlt = alt
    showCoverPicker.value = false
}
onMounted(() => panel.value?.focus())
const tab = defineModel<InspectorTab>('tab', { required: true })
const coverPreviewSrc = computed(() => {
    const source = draft.value.coverSrc.trim()
    if (!source) return ''
    if (selectedCover.value?.publicSrc === source) return selectedCover.value.previewSrc

    try {
        return new URL(source, `${props.previewOrigin}/`).toString()
    } catch {
        return ''
    }
})
</script>
