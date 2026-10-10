<template>
    <div :class="['shell', { 'shell--navigation-hidden': !navigationOpen || focusMode, 'shell--focus': focusMode }]">
        <aside
            v-show="navigationOpen && !focusMode"
            id="content-navigation"
            class="sidebar"
            @keydown.esc.stop="closeNavigation"
        >
            <ContentNavigator
                ref="navigator"
                :library="library"
                :selected-source-path="selectedSourcePath"
                :expanded-paths="expandedPaths"
                :recent-paths="recentPaths"
                :busy="isStructureBusy || isSaving || isLoadingDocument"
                :loading="isLoadingLibrary"
                @toggle="toggleExpandedPath"
                @select="handleSelectDocument"
                @create="openCreateDialog"
                @refresh="refreshLibrary()"
                @close="closeNavigation"
            >
                <span class="section-note">{{ library?.documents.length ?? 0 }} {{ t('篇文档', 'documents') }}</span>
                <label class="theme-select">
                    <span class="sr-only">{{ t('外观', 'Appearance') }}</span>
                    <select v-model="themeMode">
                        <option v-for="option in themeModeOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                        </option>
                    </select>
                </label>
            </ContentNavigator>
        </aside>

        <main class="workspace">
            <div class="workspace-commandbar">
                <div class="workspace-context">
                    <button
                        v-show="!focusMode"
                        ref="navigationTrigger"
                        class="ghost-button"
                        type="button"
                        aria-controls="content-navigation"
                        :aria-expanded="navigationOpen"
                        @click="toggleNavigation"
                    >
                        {{ t('内容', 'Library') }}
                    </button>
                    <span v-if="focusMode && draft" class="focus-document-title" :title="currentDocument?.sourcePath">
                        {{ draft.title || t('未命名文档', 'Untitled document') }}
                    </span>
                    <span v-if="currentDocument && !focusMode" class="document-kind">{{
                        kindLabels[currentDocument.kind]
                    }}</span>
                    <span v-if="currentDocument" class="save-state" role="status">
                        {{
                            isLoadingDocument
                                ? t('打开中…', 'Opening…')
                                : isSaving
                                  ? t('保存中…', 'Saving…')
                                  : isDirty
                                    ? t('未保存', 'Unsaved')
                                    : t('已保存到本地', 'Saved locally')
                        }}
                    </span>
                </div>
                <div v-if="currentDocument && draft" class="workspace-toolbar__actions">
                    <button
                        ref="focusModeTrigger"
                        class="ghost-button"
                        type="button"
                        :aria-pressed="focusMode"
                        :title="
                            focusMode
                                ? t('Esc 退出专注写作', 'Esc to exit focus mode')
                                : t('展开正文，收起导航与预览', 'Expand the editor and hide navigation and preview')
                        "
                        :disabled="isLoadingDocument"
                        @click="toggleFocusMode"
                    >
                        {{ focusMode ? t('退出专注', 'Exit focus') : t('专注写作', 'Focus writing') }}
                    </button>
                    <details
                        v-show="!focusMode"
                        ref="documentActions"
                        class="document-actions"
                        @keydown.esc.stop="closeDocumentActions"
                    >
                        <summary class="ghost-button">{{ t('更多', 'More') }}</summary>
                        <div class="document-actions__items" @click="closeDocumentActions">
                            <button
                                type="button"
                                :disabled="isStructureBusy || isSaving || isLoadingDocument"
                                @click="openCreateDialog(getPreferredCreateDirectory())"
                            >
                                {{ t('在此目录新建', 'New in this folder') }}
                            </button>
                            <button
                                type="button"
                                :disabled="!canModifyCurrentDocument"
                                @click="openMoveDialog(currentDocument.sourcePath)"
                            >
                                {{ t('移动 / 重命名', 'Move / rename') }}
                            </button>
                            <button
                                type="button"
                                :disabled="!isDirty || isSaving || isLoadingDocument"
                                @click="resetDraft"
                            >
                                {{ t('放弃未保存修改', 'Discard changes') }}
                            </button>
                            <button
                                class="danger-text"
                                type="button"
                                :disabled="!canModifyCurrentDocument"
                                @click="openDeleteDialog(currentDocument.sourcePath)"
                            >
                                {{ t('删除文档', 'Delete document') }}
                            </button>
                        </div>
                    </details>
                    <button class="primary-button" type="button" :disabled="!canSave" @click="saveCurrentDocument">
                        {{ isSaving ? t('保存中…', 'Saving…') : t('保存', 'Save') }}
                    </button>
                </div>
            </div>
            <p v-if="errorMessage && !dialogMode" class="notice-banner notice-banner--error" role="alert">
                {{ errorMessage }}
            </p>

            <div v-if="currentDocument && draft" class="workspace-shell">
                <header v-show="!focusMode" class="workspace-document-header">
                    <label class="workspace-title-field">
                        <span class="sr-only">{{ t('标题', 'Title') }}</span>
                        <input
                            v-model="draft.title"
                            class="workspace-title-input"
                            type="text"
                            :placeholder="t('未命名文档', 'Untitled document')"
                            :disabled="isSaving || isLoadingDocument"
                        />
                    </label>
                    <p class="workspace-path" :title="currentDocument.sourcePath">{{ currentDocument.sourcePath }}</p>
                </header>
                <div v-show="!focusMode" class="workspace-secondary-bar">
                    <div class="segmented-control" role="group" :aria-label="t('切换视图', 'Change view')">
                        <button
                            v-for="option in workspaceViewModeOptions"
                            :key="option.value"
                            type="button"
                            :class="['segment-button', { active: workspaceViewMode === option.value }]"
                            :aria-pressed="workspaceViewMode === option.value"
                            @click="workspaceViewMode = option.value"
                        >
                            {{ option.label }}
                        </button>
                    </div>
                    <div class="workspace-display-controls">
                        <button
                            type="button"
                            :class="['quiet-button', { active: inspectorOpen && inspectorTab === 'details' }]"
                            :aria-expanded="inspectorOpen && inspectorTab === 'details'"
                            aria-controls="document-inspector"
                            @click="toggleInspector('details', $event)"
                        >
                            {{ t('属性', 'Properties') }}
                        </button>
                        <button
                            type="button"
                            :class="['quiet-button', { active: inspectorOpen && inspectorTab === 'structure' }]"
                            :aria-expanded="inspectorOpen && inspectorTab === 'structure'"
                            aria-controls="document-inspector"
                            @click="toggleInspector('structure', $event)"
                        >
                            {{ t('结构', 'Structure') }}
                        </button>
                        <a
                            class="quiet-button preview-link"
                            :href="currentPreviewHref"
                            target="_blank"
                            rel="noreferrer"
                            >{{ t('打开预览', 'Open preview') }}</a
                        >
                    </div>
                </div>
                <div :class="['workspace-canvas', { 'workspace-canvas--inspector': inspectorOpen && !focusMode }]">
                    <div class="workspace-stage">
                        <div :class="['stage-panes', `stage-panes--${focusMode ? 'editor' : workspaceViewMode}`]">
                            <section
                                v-show="showEditorPane"
                                class="stage-panel stage-panel--editor"
                                :aria-label="t('正文编辑', 'Document editor')"
                            >
                                <MarkdownEditor
                                    ref="markdownEditor"
                                    :key="currentDocument.sourcePath"
                                    v-model="draft.body"
                                    :source-path="currentDocument.sourcePath"
                                    :library="library"
                                    :read-only="isSaving || isLoadingDocument"
                                    @busy="isUploadingImages = $event"
                                    @save="saveCurrentDocument"
                                />
                            </section>
                            <section
                                v-if="showPreviewPane"
                                class="stage-panel stage-panel--preview"
                                :aria-label="t('站点预览', 'Site preview')"
                            >
                                <header class="stage-panel__header">
                                    <span class="preview-status" role="status">{{ previewStatusText }}</span>
                                    <button
                                        class="quiet-button"
                                        type="button"
                                        @click="refreshPreview"
                                        :disabled="isSaving"
                                    >
                                        {{ t('刷新', 'Refresh') }}
                                    </button>
                                </header>
                                <div class="preview-frame-shell">
                                    <p class="preview-frame-banner">
                                        {{
                                            isDirty
                                                ? t(
                                                      '未保存修改不会显示在站点预览中。',
                                                      'Unsaved changes are not included in the site preview.'
                                                  )
                                                : t(
                                                      '显示站点生成结果；保存后需等待重新生成。',
                                                      'Shows the generated site. Changes appear after the site rebuilds.'
                                                  )
                                        }}
                                    </p>
                                    <iframe
                                        class="preview-frame"
                                        :src="currentPreviewFrameHref"
                                        :title="t('站点预览', 'Site preview')"
                                        loading="eager"
                                    />
                                </div>
                            </section>
                        </div>
                    </div>
                    <DocumentInspector
                        v-if="inspectorOpen"
                        v-show="!focusMode"
                        v-model:draft="draft"
                        v-model:tab="inspectorTab"
                        :current-document="currentDocument"
                        :is-saving="isSaving || isLoadingDocument"
                        :tag-suggestions="tagSuggestions"
                        :topic-suggestions="topicSuggestions"
                        :foundation-domains="library?.content.foundationDomains ?? []"
                        :foundation-entries="
                            foundationEntries.filter(
                                (entry) => entry.id !== getDocumentFileStem(currentDocument.sourcePath)
                            )
                        "
                        :preview-origin="effectivePreviewOrigin"
                        :foundation-relation-warnings="foundationRelationWarnings"
                        @close="closeInspector"
                    />
                </div>
                <p v-show="!focusMode" class="workspace-feedback" role="status">
                    {{ successMessage || t('⌘ / Ctrl + S 保存到本地文件', '⌘ / Ctrl + S to save locally') }}
                </p>
            </div>
            <div v-else class="workspace-empty">
                <h2>
                    {{
                        isLoadingLibrary
                            ? t('正在打开工作台…', 'Opening your workspace…')
                            : t('开始写作', 'Start writing')
                    }}
                </h2>
                <p>
                    {{
                        t(
                            '打开一篇文档继续写作，或创建新的内容。',
                            'Open a document to continue writing, or create something new.'
                        )
                    }}
                </p>
                <button
                    class="primary-button"
                    type="button"
                    :disabled="isStructureBusy || !library"
                    @click="openCreateDialog()"
                >
                    {{ t('新建文档', 'New document') }}
                </button>
            </div>
        </main>
        <datalist id="cms-category-options">
            <option v-for="category in categorySuggestions" :key="category" :value="category" />
        </datalist>
        <DocumentOperationsDialog
            v-if="dialogMode"
            v-model:create-asset-directory="createAssetDirectory"
            v-model:create-draft="createDraft"
            v-model:create-file-name="createFileName"
            v-model:create-target-directory="createTargetDirectory"
            v-model:delete-remove-asset-directory="deleteRemoveAssetDirectory"
            v-model:move-asset-directory="moveAssetDirectory"
            v-model:move-file-name="moveFileName"
            v-model:move-target-directory="moveTargetDirectory"
            :busy="isStructureBusy"
            :error-message="errorMessage"
            :can-create-asset-directory="canCreateAssetDirectory"
            :create-target-path="createTargetPath"
            :delete-asset-directory-path="deleteAssetDirectoryPath"
            :delete-source-path="deleteSourcePath"
            :mode="dialogMode"
            :move-has-asset-directory="moveHasAssetDirectory"
            :move-is-topic-meta="moveIsTopicMeta"
            :move-source-path="moveSourcePath"
            :move-target-path="moveTargetPath"
            :suggested-file-name="suggestedFileName"
            :topic-meta-filename="library?.content.topicMetaFilename ?? ''"
            :foundation-domains="library?.content.foundationDomains ?? []"
            @close="closeDialog"
            @submit-create="submitCreateDialog"
            @submit-delete="submitDeleteDialog"
            @submit-move="submitMoveDialog"
        />
    </div>
</template>

<script setup lang="ts">
import { t } from './i18n'

import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
    createDocument,
    deleteDocument,
    fetchDocumentDetail,
    fetchLibrarySnapshot,
    moveDocument,
    saveDocument
} from './api'
import ContentNavigator from './components/ContentNavigator.vue'
import DocumentInspector from './components/DocumentInspector.vue'
import DocumentOperationsDialog from './components/DocumentOperationsDialog.vue'
import {
    buildCreateInputFromDraft,
    buildUpdateInputFromDraft,
    createEmptyDraft,
    createDraftFromDocument,
    isDraftDirty,
    suggestDocumentFileName,
    getFoundationRelationWarnings,
    uniqueDraftValues,
    type CmsDocumentDraft
} from './draft'
import {
    buildDocumentTargetPath,
    getDefaultDirectoryForKind,
    getDocumentAncestorPaths,
    getDocumentDirectoryPath,
    getDocumentFileStem,
    inferDefaultKindForDirectory,
    inferTopicsFromTargetPath,
    normalizePathInput
} from './library-tree'
import type { CmsThemeMode } from './theme-mode'
import type { CmsDocumentKind, CmsDocumentDetail, CmsDocumentUpdateInput, CmsLibrarySnapshot } from './types'
import { useCmsPreview } from './use-cms-preview'
import { useCmsTheme } from './use-cms-theme'

const MarkdownEditor = defineAsyncComponent(() => import('./components/MarkdownEditor.vue'))
type WorkspaceViewMode = 'editor' | 'split' | 'preview'
type InspectorTab = 'details' | 'structure'

const library = ref<CmsLibrarySnapshot | null>(null)
const currentDocument = ref<CmsDocumentDetail | null>(null)
const selectedSourcePath = ref('')
const expandedPaths = ref<string[]>([])
const navigationOpen = ref(window.innerWidth > 900)
const navigator = ref<InstanceType<typeof ContentNavigator> | null>(null)
const navigationTrigger = ref<HTMLButtonElement | null>(null)
const documentActions = ref<HTMLDetailsElement | null>(null)
const recentPaths = ref<string[]>([])
let inspectorTrigger: HTMLElement | null = null
let operationTrigger: HTMLElement | null = null
const errorMessage = ref('')
const successMessage = ref('')
const isLoadingLibrary = ref(false)
const isSaving = ref(false)
const isUploadingImages = ref(false)
const isLoadingDocument = ref(false)
const isStructureBusy = ref(false)
const draft = ref<CmsDocumentDraft | null>(null)
const baselineInput = ref<CmsDocumentUpdateInput | null>(null)
const dialogMode = ref<'create' | 'move' | 'delete' | ''>('')
const workspaceViewMode = ref<WorkspaceViewMode>('editor')
const focusMode = ref(false)
const focusModeTrigger = ref<HTMLButtonElement | null>(null)
const markdownEditor = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const inspectorOpen = ref(false)
const inspectorTab = ref<InspectorTab>('details')
const { themeMode } = useCmsTheme()
const {
    effectivePreviewOrigin,
    currentPreviewFrameHref,
    currentPreviewHref,
    previewStatusText,
    refreshPreview,
    syncPreviewOrigin
} = useCmsPreview(currentDocument)

const createDraft = ref<CmsDocumentDraft>(createEmptyDraft('post'))
const createTargetDirectory = ref('')
const createFileName = ref('')
const createAssetDirectory = ref(true)

const moveSourcePath = ref('')
const moveTargetDirectory = ref('')
const moveFileName = ref('')
const moveHasAssetDirectory = ref(false)
const moveAssetDirectory = ref(true)

const deleteSourcePath = ref('')
const deleteAssetDirectoryPath = ref<string | null>(null)
const deleteRemoveAssetDirectory = ref(true)
let documentLoadSequence = 0

const kindLabels: Record<CmsDocumentKind, string> = {
    post: t('文章', 'Article'),
    topic: t('专题文章', 'Topic article'),
    foundation: t('知识条目', 'Foundation'),
    page: t('页面', 'Page'),
    topicMeta: t('专题设置', 'Topic settings')
}
const themeModeOptions: Array<{ value: CmsThemeMode; label: string }> = [
    { value: 'system', label: t('系统', 'System') },
    { value: 'light', label: t('浅色', 'Light') },
    { value: 'dark', label: t('深色', 'Dark') }
]
const workspaceViewModeOptions: Array<{ value: WorkspaceViewMode; label: string }> = [
    { value: 'editor', label: t('编辑', 'Editor') },
    { value: 'split', label: t('分屏', 'Split') },
    { value: 'preview', label: t('预览', 'Preview') }
]

const isDirty = computed(() => isDraftDirty(draft.value, baselineInput.value))
const canSave = computed(() =>
    Boolean(
        currentDocument.value &&
            draft.value &&
            isDirty.value &&
            !isSaving.value &&
            !isUploadingImages.value &&
            !isStructureBusy.value &&
            !isLoadingDocument.value
    )
)
const canModifyCurrentDocument = computed(() =>
    Boolean(
        currentDocument.value &&
            !isSaving.value &&
            !isUploadingImages.value &&
            !isStructureBusy.value &&
            !isDirty.value &&
            !isLoadingDocument.value
    )
)
const showEditorPane = computed(() => focusMode.value || workspaceViewMode.value !== 'preview')
const showPreviewPane = computed(() => !focusMode.value && workspaceViewMode.value !== 'editor')
const suggestedFileName = computed(() => suggestDocumentFileName(createDraft.value.title, createDraft.value.kind))
const foundationEntries = computed(() =>
    (library.value?.documents ?? [])
        .filter((item) => item.foundation && item.foundation.kind !== 'navigation')
        .map((item) => ({ id: item.foundation!.id, title: item.title }))
)
const foundationRelationWarnings = computed(() =>
    draft.value ? getFoundationRelationWarnings(draft.value, library.value?.documents ?? []) : []
)
const createTargetPath = computed(() => {
    if (!library.value) return ''
    try {
        return buildDocumentTargetPath(
            normalizePathInput(
                createTargetDirectory.value || getDefaultDirectoryForKind(createDraft.value.kind, library.value.tree)
            ),
            createFileName.value.trim() || suggestedFileName.value,
            createDraft.value.kind,
            library.value
        )
    } catch {
        return ''
    }
})
const canCreateAssetDirectory = computed(() => createDraft.value.kind === 'post' || createDraft.value.kind === 'topic')
const moveIsTopicMeta = computed(
    () =>
        library.value?.documents.some(
            (document) => document.sourcePath === moveSourcePath.value && document.kind === 'topicMeta'
        ) ?? false
)
const moveTargetPath = computed(() => {
    if (!library.value) return ''
    try {
        const kind = moveIsTopicMeta.value
            ? 'topicMeta'
            : inferDefaultKindForDirectory(moveTargetDirectory.value, library.value.tree)
        return buildDocumentTargetPath(
            normalizePathInput(moveTargetDirectory.value),
            moveFileName.value,
            kind,
            library.value
        )
    } catch {
        return ''
    }
})
const categorySuggestions = computed(() =>
    uniqueDraftValues(library.value?.documents.map((item) => item.category) ?? [])
)
const tagSuggestions = computed(() =>
    uniqueDraftValues((library.value?.documents ?? []).flatMap((item) => item.tags)).slice(0, 18)
)
const topicSuggestions = computed(() =>
    uniqueDraftValues((library.value?.documents ?? []).flatMap((item) => item.topics)).slice(0, 18)
)

function clearWorkspace() {
    focusMode.value = false
    documentLoadSequence += 1
    isLoadingDocument.value = false
    selectedSourcePath.value = ''
    currentDocument.value = null
    draft.value = null
    baselineInput.value = null
}

async function toggleFocusMode() {
    focusMode.value = !focusMode.value
    await nextTick()
    if (focusMode.value) markdownEditor.value?.focus()
    else focusModeTrigger.value?.focus()
}

async function toggleNavigation() {
    navigationOpen.value = !navigationOpen.value
    if (navigationOpen.value) {
        await nextTick()
        navigator.value?.focusSearch()
    }
}

function closeNavigation() {
    navigationOpen.value = false
    navigationTrigger.value?.focus()
}

function closeDocumentActions() {
    if (!documentActions.value) return
    documentActions.value.open = false
    documentActions.value.querySelector('summary')?.focus()
}

function handleWorkspaceKey(event: KeyboardEvent) {
    if (
        dialogMode.value ||
        document.querySelector('dialog[open]') ||
        event.defaultPrevented ||
        event.isComposing ||
        isUploadingImages.value
    )
        return
    if (focusMode.value && event.key === 'Escape') {
        event.preventDefault()
        void toggleFocusMode()
        return
    }
    if (!(event.metaKey || event.ctrlKey)) return
    if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveCurrentDocument()
        return
    }
    if (event.key.toLowerCase() !== 'k') return
    event.preventDefault()
    focusMode.value = false
    navigationOpen.value = true
    nextTick(() => navigator.value?.focusSearch())
}

function ensureExpandedPaths(paths: string[]) {
    expandedPaths.value = Array.from(new Set([...expandedPaths.value, ...paths]))
}

function toggleExpandedPath(path: string) {
    expandedPaths.value = expandedPaths.value.includes(path)
        ? expandedPaths.value.filter((value) => value !== path)
        : [...expandedPaths.value, path]
}

function getPreferredCreateDirectory() {
    if (currentDocument.value) {
        return getDocumentDirectoryPath(currentDocument.value.sourcePath)
    }

    return library.value ? getDefaultDirectoryForKind('post', library.value.tree) : ''
}

function confirmDiscardUnsavedChanges() {
    return (
        !isDirty.value ||
        window.confirm(
            t(
                '当前文档有未保存修改，确定要切换吗？',
                'This document has unsaved changes. Discard them and switch documents?'
            )
        )
    )
}

async function refreshLibrary(preferredSourcePath?: string) {
    isLoadingLibrary.value = true
    errorMessage.value = ''

    try {
        const snapshot = await fetchLibrarySnapshot()
        library.value = snapshot

        if (!snapshot.documents.length) {
            clearWorkspace()
            return
        }

        const requestedSourcePath = preferredSourcePath ?? selectedSourcePath.value
        const nextSourcePath =
            requestedSourcePath && snapshot.documents.some((item) => item.sourcePath === requestedSourcePath)
                ? requestedSourcePath
                : snapshot.documents[0].sourcePath

        ensureExpandedPaths(getDocumentAncestorPaths(nextSourcePath))

        if (!currentDocument.value || currentDocument.value.sourcePath !== nextSourcePath) {
            await loadDocument(nextSourcePath)
        } else {
            selectedSourcePath.value = nextSourcePath
        }
    } catch (error) {
        errorMessage.value =
            error instanceof Error ? error.message : t('加载内容索引失败。', 'Failed to load the content library.')
    } finally {
        isLoadingLibrary.value = false
    }
}

async function handleSelectDocument(sourcePath: string) {
    if (isSaving.value || isStructureBusy.value || isUploadingImages.value) return
    if (currentDocument.value?.sourcePath === sourcePath) {
        if (window.innerWidth <= 900) closeNavigation()
        return
    }

    if (!confirmDiscardUnsavedChanges()) {
        return
    }

    await loadDocument(sourcePath)
    if (window.innerWidth <= 900 && selectedSourcePath.value === sourcePath) closeNavigation()
}

async function loadDocument(sourcePath: string) {
    const loadSequence = ++documentLoadSequence
    isLoadingDocument.value = true
    errorMessage.value = ''
    successMessage.value = ''

    try {
        const document = await fetchDocumentDetail(sourcePath)
        if (loadSequence !== documentLoadSequence) return

        selectedSourcePath.value = sourcePath
        currentDocument.value = document
        draft.value = createDraftFromDocument(document)
        baselineInput.value = buildUpdateInputFromDraft(draft.value)
        recentPaths.value = [sourcePath, ...recentPaths.value.filter((path) => path !== sourcePath)].slice(0, 5)
        ensureExpandedPaths(getDocumentAncestorPaths(sourcePath))
    } catch (error) {
        if (loadSequence !== documentLoadSequence) return
        errorMessage.value =
            error instanceof Error ? error.message : t('加载文档详情失败。', 'Failed to load the document.')
    } finally {
        if (loadSequence === documentLoadSequence) isLoadingDocument.value = false
    }
}

function resetDraft() {
    if (!currentDocument.value || isUploadingImages.value) return
    if (!window.confirm(t('放弃当前文档的未保存修改？', 'Discard unsaved changes to this document?'))) return

    draft.value = createDraftFromDocument(currentDocument.value)
    baselineInput.value = buildUpdateInputFromDraft(draft.value)
    successMessage.value = ''
    errorMessage.value = ''
}

function toggleInspector(nextTab: InspectorTab, event: MouseEvent) {
    inspectorTrigger = event.currentTarget as HTMLElement
    if (inspectorOpen.value && inspectorTab.value === nextTab) {
        inspectorOpen.value = false
        return
    }

    inspectorTab.value = nextTab
    inspectorOpen.value = true
}

function closeInspector() {
    inspectorOpen.value = false
    inspectorTrigger?.focus()
}

async function saveCurrentDocument() {
    if (!draft.value || !canSave.value) return

    errorMessage.value = ''
    successMessage.value = ''
    isSaving.value = true

    try {
        if (draft.value.kind === 'foundation') {
            if (!draft.value.title.trim() || !draft.value.description.trim() || !draft.value.domains.length) {
                throw new Error(
                    t(
                        '知识条目需要标题、摘要和至少一个领域。',
                        'A foundation needs a title, description and at least one domain.'
                    )
                )
            }
            if (
                draft.value.foundationKind === 'navigation' &&
                Object.values(draft.value.relations).some((values) => values.length)
            ) {
                throw new Error(
                    t(
                        '导航条目不支持知识关系，请先移除关系或选择其他类型。',
                        'Navigation entries cannot have knowledge relations. Remove the relations or choose another type.'
                    )
                )
            }
        }
        const payload = buildUpdateInputFromDraft(draft.value)
        const updatedDocument = await saveDocument(payload)

        currentDocument.value = updatedDocument
        draft.value = createDraftFromDocument(updatedDocument)
        baselineInput.value = buildUpdateInputFromDraft(draft.value)
        successMessage.value = `${t('已保存 ', 'Saved ')}${updatedDocument.sourcePath}`

        await refreshLibrary()
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : t('保存失败。', 'Save failed.')
    } finally {
        isSaving.value = false
    }
}

function closeDialog() {
    if (isStructureBusy.value) return
    dialogMode.value = ''
    nextTick(() => operationTrigger?.focus())
}

function rememberOperationTrigger() {
    const active = document.activeElement
    operationTrigger =
        active instanceof HTMLElement ? (active.closest('details')?.querySelector('summary') ?? active) : null
}

function openCreateDialog(directoryPath = getPreferredCreateDirectory()) {
    const snapshot = library.value
    if (!snapshot || isStructureBusy.value || isSaving.value || isLoadingDocument.value || isUploadingImages.value)
        return
    rememberOperationTrigger()
    errorMessage.value = ''
    const normalizedDirectory = normalizePathInput(directoryPath) || getDefaultDirectoryForKind('post', snapshot.tree)
    const initialKind = inferDefaultKindForDirectory(normalizedDirectory, snapshot.tree)
    const initialTargetPath = (() => {
        try {
            return buildDocumentTargetPath(normalizedDirectory, 'draft', initialKind, snapshot)
        } catch {
            return `${normalizedDirectory}/draft.md`
        }
    })()

    createDraft.value = createEmptyDraft(initialKind, {
        topicsText:
            initialKind === 'topic' ? inferTopicsFromTargetPath(initialTargetPath, snapshot.tree).join(', ') : ''
    })
    createTargetDirectory.value = normalizedDirectory
    createFileName.value = ''
    createAssetDirectory.value = initialKind === 'post' || initialKind === 'topic'
    dialogMode.value = 'create'
}

async function openMoveDialog(sourcePath?: string | null) {
    if (!sourcePath) return
    rememberOperationTrigger()

    if (currentDocument.value?.sourcePath === sourcePath && isDirty.value) {
        errorMessage.value = t('请先保存或重置当前文档，再执行移动。', 'Save or reset this document before moving it.')
        return
    }

    errorMessage.value = ''
    isStructureBusy.value = true

    try {
        const document =
            currentDocument.value?.sourcePath === sourcePath
                ? currentDocument.value
                : await fetchDocumentDetail(sourcePath)
        moveSourcePath.value = sourcePath
        moveTargetDirectory.value = getDocumentDirectoryPath(sourcePath)
        moveFileName.value = document.kind === 'topicMeta' ? '' : getDocumentFileStem(sourcePath)
        moveHasAssetDirectory.value = Boolean(document.assetDirectoryPath)
        moveAssetDirectory.value = Boolean(document.assetDirectoryPath)
        dialogMode.value = 'move'
    } catch (error) {
        errorMessage.value =
            error instanceof Error ? error.message : t('读取待移动文档失败。', 'Failed to load the document to move.')
    } finally {
        isStructureBusy.value = false
    }
}

async function openDeleteDialog(sourcePath?: string | null) {
    if (!sourcePath) return
    rememberOperationTrigger()

    if (currentDocument.value?.sourcePath === sourcePath && isDirty.value) {
        errorMessage.value = t(
            '请先保存或重置当前文档，再执行删除。',
            'Save or reset this document before deleting it.'
        )
        return
    }

    errorMessage.value = ''
    isStructureBusy.value = true

    try {
        const document =
            currentDocument.value?.sourcePath === sourcePath
                ? currentDocument.value
                : await fetchDocumentDetail(sourcePath)
        deleteSourcePath.value = sourcePath
        deleteAssetDirectoryPath.value = document.assetDirectoryPath
        deleteRemoveAssetDirectory.value = Boolean(document.assetDirectoryPath)
        dialogMode.value = 'delete'
    } catch (error) {
        errorMessage.value =
            error instanceof Error ? error.message : t('读取待删除文档失败。', 'Failed to load the document to delete.')
    } finally {
        isStructureBusy.value = false
    }
}

async function submitCreateDialog() {
    if (!library.value || isStructureBusy.value) return
    if (!createTargetPath.value) {
        errorMessage.value = t('请先填写合法的目录和文件名。', 'Enter a valid directory and filename.')
        return
    }
    if (!createDraft.value.title.trim()) return
    if (createDraft.value.kind === 'foundation') {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(getDocumentFileStem(createTargetPath.value))) {
            errorMessage.value = t(
                '条目 ID 请使用英文小写、数字和连字符。',
                'Use lowercase letters, numbers and hyphens for the entry ID.'
            )
            return
        }
        if (!createDraft.value.domains.length || !createDraft.value.description.trim()) {
            errorMessage.value = t(
                '请填写摘要并选择至少一个领域。',
                'Add a description and choose at least one domain.'
            )
            return
        }
    }
    if (!confirmDiscardUnsavedChanges()) return

    errorMessage.value = ''
    successMessage.value = ''
    isStructureBusy.value = true

    try {
        if (createDraft.value.kind === 'topic' && !createDraft.value.topicsText.trim()) {
            createDraft.value.topicsText = inferTopicsFromTargetPath(createTargetPath.value, library.value.tree).join(
                ', '
            )
        }

        const payload = buildCreateInputFromDraft(createTargetPath.value, createDraft.value)
        payload.createAssetDirectory = canCreateAssetDirectory.value && createAssetDirectory.value

        const createdDocument = await createDocument(payload)
        successMessage.value = `${t('已创建 ', 'Created ')}${createdDocument.sourcePath}`
        dialogMode.value = ''
        ensureExpandedPaths(getDocumentAncestorPaths(createdDocument.sourcePath))

        await refreshLibrary(createdDocument.sourcePath)
        if (window.innerWidth <= 900) navigationOpen.value = false
        await nextTick()
        document.querySelector<HTMLElement>('.cm-content')?.focus()
    } catch (error) {
        errorMessage.value =
            error instanceof Error ? error.message : t('创建文档失败。', 'Failed to create the document.')
    } finally {
        isStructureBusy.value = false
    }
}

async function submitMoveDialog() {
    if (!moveTargetPath.value) {
        errorMessage.value = t('请先填写合法的目标路径。', 'Enter a valid target path.')
        return
    }

    errorMessage.value = ''
    successMessage.value = ''
    isStructureBusy.value = true

    try {
        const movedDocument = await moveDocument({
            sourcePath: moveSourcePath.value,
            targetPath: moveTargetPath.value,
            moveAssetDirectory: moveHasAssetDirectory.value && moveAssetDirectory.value
        })

        const wasCurrentDocument = currentDocument.value?.sourcePath === moveSourcePath.value
        successMessage.value = `${t('已移动到 ', 'Moved to ')}${movedDocument.sourcePath}`
        dialogMode.value = ''
        ensureExpandedPaths(getDocumentAncestorPaths(movedDocument.sourcePath))

        await refreshLibrary(wasCurrentDocument ? movedDocument.sourcePath : undefined)
    } catch (error) {
        errorMessage.value =
            error instanceof Error ? error.message : t('移动文档失败。', 'Failed to move the document.')
    } finally {
        isStructureBusy.value = false
    }
}

async function submitDeleteDialog() {
    if (!deleteSourcePath.value) {
        return
    }

    errorMessage.value = ''
    successMessage.value = ''
    isStructureBusy.value = true

    try {
        const result = await deleteDocument(deleteSourcePath.value, deleteRemoveAssetDirectory.value)

        successMessage.value = `${t('已删除 ', 'Deleted ')}${result.sourcePath}`
        dialogMode.value = ''

        await refreshLibrary()
    } catch (error) {
        errorMessage.value =
            error instanceof Error ? error.message : t('删除文档失败。', 'Failed to delete the document.')
    } finally {
        isStructureBusy.value = false
    }
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (!isDirty.value && !isUploadingImages.value) return
    event.preventDefault()
    event.returnValue = ''
}

watch(
    () => createDraft.value.kind,
    (kind) => {
        if (!library.value) return
        const normalizedDirectory = normalizePathInput(createTargetDirectory.value)
        const expectedRootDirectory = getDefaultDirectoryForKind(kind, library.value.tree)

        if (
            !normalizedDirectory ||
            (normalizedDirectory !== expectedRootDirectory &&
                !normalizedDirectory.startsWith(`${expectedRootDirectory}/`))
        ) {
            createTargetDirectory.value = expectedRootDirectory
        }

        createAssetDirectory.value = canCreateAssetDirectory.value

        createDraft.value.date = createEmptyDraft(kind).date

        if (kind === 'topicMeta') {
            createFileName.value = ''
        }

        if (kind === 'topic' && !createDraft.value.topicsText.trim()) {
            const targetPath = createTargetPath.value || `${createTargetDirectory.value}/draft.md`
            createDraft.value.topicsText = inferTopicsFromTargetPath(targetPath, library.value.tree).join(', ')
        }
    }
)

watch(
    () => isDirty.value || isUploadingImages.value,
    (value) => {
        if (typeof window === 'undefined') return

        if (value) {
            window.addEventListener('beforeunload', handleBeforeUnload)
            return
        }

        window.removeEventListener('beforeunload', handleBeforeUnload)
    },
    { immediate: true }
)

onMounted(async () => {
    window.addEventListener('keydown', handleWorkspaceKey)
    await Promise.all([refreshLibrary(), syncPreviewOrigin()])
})

onBeforeUnmount(() => {
    if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', handleBeforeUnload)
        window.removeEventListener('keydown', handleWorkspaceKey)
    }
})
</script>
