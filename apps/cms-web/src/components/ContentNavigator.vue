<template>
    <div class="navigator">
        <header class="navigator-header">
            <h1>
                TiO₂ <span>{{ t('工作台', 'Workbench') }}</span>
            </h1>
            <button class="quiet-button" type="button" @click="emit('close')">{{ t('收起', 'Hide') }}</button>
        </header>
        <label class="navigator-search">
            <span class="sr-only">{{ t('搜索文档', 'Search documents') }}</span>
            <input
                ref="searchInput"
                v-model="query"
                type="search"
                :placeholder="t('搜索标题、路径、标签…', 'Search title, path, tags…')"
                @keydown.down.prevent="focusResult(0)"
                @keydown.enter.prevent="openFirstResult"
            />
        </label>
        <div class="navigator-toolbar">
            <button class="ghost-button" type="button" :disabled="busy || !library" @click="emit('create')">
                {{ t('新建文档', 'New document') }}
            </button>
            <button class="quiet-button" type="button" :disabled="loading" @click="emit('refresh')">
                {{ loading ? t('加载中…', 'Loading…') : t('刷新', 'Refresh') }}
            </button>
        </div>
        <nav class="navigator-content" :aria-label="t('内容导航', 'Content navigation')">
            <template v-if="query.trim()">
                <p class="section-label" role="status">{{ results.length }} {{ t('个结果', 'results') }}</p>
                <ul
                    ref="resultsList"
                    class="search-results"
                    @keydown.down.prevent="stepResult($event, 1)"
                    @keydown.up.prevent="stepResult($event, -1)"
                >
                    <li v-for="item in results" :key="item.sourcePath">
                        <button
                            type="button"
                            :class="['search-result', { active: selectedSourcePath === item.sourcePath }]"
                            :aria-current="selectedSourcePath === item.sourcePath ? 'page' : undefined"
                            @click="emit('select', item.sourcePath)"
                        >
                            <span>{{ item.title }}</span>
                            <small :title="item.sourcePath">{{ item.sourcePath }}</small>
                        </button>
                    </li>
                </ul>
                <p v-if="!results.length" class="sidebar-state">
                    {{ t('没有找到文档，试试标题、路径或标签。', 'No documents found. Try a title, path or tag.') }}
                </p>
            </template>
            <template v-else-if="library">
                <section v-if="recentDocuments.length > 1" class="recent-documents">
                    <h2 class="section-label">{{ t('最近打开', 'Recently opened') }}</h2>
                    <button
                        v-for="item in recentDocuments"
                        :key="item.sourcePath"
                        type="button"
                        class="tree-document"
                        :title="item.sourcePath"
                        @click="emit('select', item.sourcePath)"
                    >
                        {{ item.title }}
                    </button>
                </section>
                <section v-for="root in library.tree" :key="root.path" class="tree-root">
                    <header class="tree-row tree-root__header">
                        <button
                            class="tree-row__main"
                            type="button"
                            :aria-expanded="expandedPaths.includes(root.path)"
                            @click="emit('toggle', root.path)"
                        >
                            <span
                                :class="['tree-caret', { 'tree-caret--open': expandedPaths.includes(root.path) }]"
                                aria-hidden="true"
                            />
                            <span class="tree-row__label">{{ rootLabels[root.rootKey] }}</span>
                            <span class="tree-count">{{ root.documentCount }}</span>
                        </button>
                        <button
                            class="tree-create"
                            type="button"
                            :disabled="busy"
                            :aria-label="`${t('在此目录新建：', 'Create in ')}${root.path}`"
                            @click="emit('create', root.path)"
                        >
                            {{ t('新建', 'New') }}
                        </button>
                    </header>
                    <ContentTreeBranch
                        v-if="expandedPaths.includes(root.path)"
                        :nodes="root.children"
                        :expanded-paths="expandedPaths"
                        :selected-source-path="selectedSourcePath"
                        :busy="busy"
                        @toggle="emit('toggle', $event)"
                        @select="emit('select', $event)"
                        @create="emit('create', $event)"
                    />
                </section>
            </template>
            <p v-else class="sidebar-state">
                {{
                    loading
                        ? t('正在读取内容…', 'Loading your library…')
                        : t('内容尚未加载，请重试刷新。', 'Library unavailable. Try refreshing.')
                }}
            </p>
        </nav>
        <footer class="navigator-footer"><slot /></footer>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '../i18n'
import { searchLibraryDocuments } from '../library-tree'
import type { CmsLibrarySnapshot, CmsLibraryTreeRootKey } from '../types'
import ContentTreeBranch from './ContentTreeBranch.vue'

const props = defineProps<{
    library: CmsLibrarySnapshot | null
    selectedSourcePath: string
    expandedPaths: string[]
    recentPaths: string[]
    busy: boolean
    loading: boolean
}>()
const emit = defineEmits<{
    select: [path: string]
    toggle: [path: string]
    create: [path?: string]
    refresh: []
    close: []
}>()
const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const resultsList = ref<HTMLUListElement | null>(null)
const results = computed(() => searchLibraryDocuments(props.library?.documents ?? [], query.value))
const recentDocuments = computed(() =>
    props.recentPaths
        .map((path) => props.library?.documents.find((item) => item.sourcePath === path))
        .filter((item) => item !== undefined)
)
const rootLabels: Record<CmsLibraryTreeRootKey, string> = {
    posts: t('文章', 'Articles'),
    topics: t('专题', 'Topics'),
    foundations: t('知识库', 'Foundations'),
    pages: t('页面', 'Pages')
}
function focusResult(index: number) {
    const buttons = resultsList.value?.querySelectorAll('button')
    if (!buttons?.length) return
    buttons[Math.max(0, Math.min(index, buttons.length - 1))].focus()
}
function stepResult(event: KeyboardEvent, offset: number) {
    const buttons = Array.from(resultsList.value?.querySelectorAll('button') ?? [])
    const index = buttons.indexOf(event.target as HTMLButtonElement)
    if (index === 0 && offset < 0) searchInput.value?.focus()
    else focusResult(index + offset)
}
function openFirstResult() {
    if (results.value[0]) emit('select', results.value[0].sourcePath)
}
defineExpose({ focusSearch: () => searchInput.value?.focus() })
</script>
