<template>
    <dialog ref="dialog" class="modal-card" aria-labelledby="operation-title" @cancel.prevent="!busy && emit('close')">
        <header class="modal-header">
            <div>
                <h2 id="operation-title">{{ dialogTitle }}</h2>
                <p class="modal-subtitle">{{ dialogDescription }}</p>
            </div>
            <button class="ghost-button" type="button" :disabled="busy" @click="emit('close')">
                {{ t('关闭', 'Close') }}
            </button>
        </header>
        <p v-if="errorMessage" class="notice-banner notice-banner--error" role="alert">{{ errorMessage }}</p>

        <form v-if="mode === 'create'" class="modal-form" @submit.prevent="emit('submit-create')">
            <div class="form-grid">
                <label class="field field--full">
                    <span>{{ t('标题', 'Title') }}</span>
                    <input
                        v-model="createDraft.title"
                        ref="titleInput"
                        type="text"
                        required
                        :disabled="busy"
                        :placeholder="t('想写点什么？', 'What would you like to write?')"
                    />
                </label>
                <label class="field">
                    <span>{{ t('内容类型', 'Content type') }}</span>
                    <select v-model="createDraft.kind" :disabled="busy">
                        <option value="post">{{ t('文章', 'Article') }}</option>
                        <option value="topic">{{ t('专题文章', 'Topic article') }}</option>
                        <option value="foundation">{{ t('知识条目', 'Foundation') }}</option>
                        <option value="page">{{ t('页面', 'Page') }}</option>
                        <option value="topicMeta">{{ t('专题设置', 'Topic settings') }}</option>
                    </select>
                </label>
                <label class="field">
                    <span>{{ t('保存目录', 'Folder') }}</span>
                    <input v-model="createTargetDirectory" type="text" required :disabled="busy" />
                </label>
                <template v-if="createDraft.kind === 'foundation'">
                    <label class="field field--full">
                        <span>{{ t('条目 ID（同时作为文件名）', 'Entry ID (also the filename)') }}</span>
                        <input
                            v-model="createFileName"
                            :placeholder="suggestedFileName || 'e.g. vector-clock'"
                            type="text"
                            pattern="[a-z0-9]+(-[a-z0-9]+)*"
                            :disabled="busy"
                        />
                        <span class="field-hint">{{
                            t(
                                '使用英文小写和连字符，例如 vector-clock。',
                                'Use lowercase letters and hyphens, e.g. vector-clock.'
                            )
                        }}</span>
                    </label>
                    <label class="field field--full">
                        <span>{{ t('摘要', 'Description') }}</span>
                        <textarea v-model="createDraft.description" rows="2" required :disabled="busy"></textarea>
                    </label>
                    <FoundationFields
                        v-model="createDraft"
                        :domains="foundationDomains"
                        :entries="[]"
                        :disabled="busy"
                        creating
                    />
                </template>
            </div>
            <details v-if="createDraft.kind !== 'foundation'" class="advanced-fields">
                <summary>{{ t('文件选项', 'File options') }}</summary>
                <label v-if="createDraft.kind !== 'foundation' && createDraft.kind !== 'topicMeta'" class="field">
                    <span>{{ t('文件名', 'Filename') }}</span>
                    <input v-model="createFileName" :placeholder="suggestedFileName" type="text" :disabled="busy" />
                    <span class="field-hint">{{
                        t(
                            '留空时根据标题生成；创建后修改标题不会改变文件名。',
                            'Generated from the title when blank. Later title edits keep the filename.'
                        )
                    }}</span>
                </label>
                <p v-if="createDraft.kind === 'topicMeta'" class="field-hint">{{ topicMetaFilename }}</p>
                <label v-if="canCreateAssetDirectory" class="checkbox-field">
                    <input v-model="createAssetDirectory" type="checkbox" :disabled="busy" />
                    <span>{{ t('同时创建同名资源目录', 'Also create a matching asset directory') }}</span>
                </label>
            </details>
            <p class="creation-path">
                <span>{{ t('保存到', 'Save to') }}</span>
                {{
                    createTargetPath ||
                    t('填写标题和有效目录后显示路径', 'Enter a title and valid folder to see the path')
                }}
            </p>

            <footer class="modal-footer">
                <button class="ghost-button" type="button" :disabled="busy" @click="emit('close')">
                    {{ t('取消', 'Cancel') }}
                </button>
                <button
                    class="primary-button"
                    type="submit"
                    :disabled="
                        !createTargetPath ||
                        !createDraft.title.trim() ||
                        (createDraft.kind === 'foundation' && !createDraft.domains.length) ||
                        busy
                    "
                >
                    {{ busy ? t('创建中…', 'Creating…') : t('创建并开始写作', 'Create and start writing') }}
                </button>
            </footer>
        </form>

        <form v-else-if="mode === 'move'" class="modal-form" @submit.prevent="emit('submit-move')">
            <div class="form-grid">
                <label class="field field--full">
                    <span>{{ t('原位置', 'Current location') }}</span>
                    <input :value="moveSourcePath" type="text" disabled />
                </label>

                <label class="field">
                    <span>{{ t('目标目录', 'Destination folder') }}</span>
                    <input
                        v-model="moveTargetDirectory"
                        type="text"
                        placeholder="posts / topics / foundations / pages"
                        :disabled="busy"
                    />
                </label>

                <label v-if="!moveIsTopicMeta" class="field">
                    <span>{{ t('文件名', 'Filename') }}</span>
                    <input v-model="moveFileName" type="text" :disabled="busy" />
                </label>

                <label v-else class="field">
                    <span>{{ t('文件名', 'Filename') }}</span>
                    <input type="text" :value="topicMetaFilename" disabled />
                </label>

                <label class="field field--full">
                    <span>{{ t('目标路径', 'Destination path') }}</span>
                    <input
                        :value="moveTargetPath || t('请先填写合法目录和文件名', 'Enter a valid directory and filename')"
                        type="text"
                        disabled
                    />
                </label>
            </div>

            <label v-if="moveHasAssetDirectory" class="checkbox-field">
                <input v-model="moveAssetDirectory" type="checkbox" :disabled="busy" />
                <span>{{ t('同步移动同名资源目录', 'Move the matching asset directory too') }}</span>
            </label>

            <footer class="modal-footer">
                <button class="ghost-button" type="button" :disabled="busy" @click="emit('close')">
                    {{ t('取消', 'Cancel') }}
                </button>
                <button class="primary-button" type="submit" :disabled="!moveTargetPath || busy">
                    {{ busy ? t('移动中…', 'Moving…') : t('确认移动', 'Confirm move') }}
                </button>
            </footer>
        </form>

        <form v-else class="modal-form" @submit.prevent="emit('submit-delete')">
            <div class="token-block token-block--danger">
                <strong>{{ t('即将删除', 'About to delete') }}</strong>
                <p class="muted">{{ deleteSourcePath }}</p>
            </div>

            <label v-if="deleteAssetDirectoryPath" class="checkbox-field">
                <input v-model="deleteRemoveAssetDirectory" type="checkbox" :disabled="busy" />
                <span
                    >{{ t('同时删除资源目录', 'Also delete the asset directory') }} {{ deleteAssetDirectoryPath }}</span
                >
            </label>

            <p class="modal-subtitle">
                {{
                    t(
                        '删除后将直接写入磁盘，无法从 CMS 内撤销。',
                        'Deletion is saved to disk immediately and cannot be undone in the CMS.'
                    )
                }}
            </p>

            <footer class="modal-footer">
                <button class="ghost-button" type="button" :disabled="busy" @click="emit('close')">
                    {{ t('取消', 'Cancel') }}
                </button>
                <button class="danger-button" type="submit" :disabled="busy">
                    {{ busy ? t('删除中…', 'Deleting…') : t('确认删除', 'Confirm deletion') }}
                </button>
            </footer>
        </form>
    </dialog>
</template>

<script setup lang="ts">
import { t } from '../i18n'

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CmsDocumentDraft } from '../draft'
import FoundationFields from './FoundationFields.vue'

type DialogMode = 'create' | 'move' | 'delete'
const dialogContent: Record<DialogMode, { title: string; description: string }> = {
    create: {
        title: t('新建文档', 'New document'),
        description: t(
            '先起一个标题，正文和其他属性可以在工作台继续完善。',
            'Start with a title. Write the body and add other properties in the workspace.'
        )
    },
    move: {
        title: t('移动 / 重命名文档', 'Move / rename document'),
        description: t('修改路径，可选同步资源目录。', 'Change the path and optionally move the asset directory.')
    },
    delete: {
        title: t('删除文档', 'Delete document'),
        description: t('删除会直接落盘。', 'Deletion is saved to disk immediately.')
    }
}

const props = defineProps<{
    busy: boolean
    errorMessage: string
    canCreateAssetDirectory: boolean
    createTargetPath: string
    deleteAssetDirectoryPath: string | null
    deleteSourcePath: string
    mode: DialogMode
    moveHasAssetDirectory: boolean
    moveIsTopicMeta: boolean
    moveSourcePath: string
    moveTargetPath: string
    suggestedFileName: string
    topicMetaFilename: string
    foundationDomains: Array<{ id: string; title: string }>
}>()
const emit = defineEmits<{
    close: []
    'submit-create': []
    'submit-delete': []
    'submit-move': []
}>()
const createAssetDirectory = defineModel<boolean>('createAssetDirectory', { required: true })
const createDraft = defineModel<CmsDocumentDraft>('createDraft', { required: true })
const createFileName = defineModel<string>('createFileName', { required: true })
const createTargetDirectory = defineModel<string>('createTargetDirectory', { required: true })
const deleteRemoveAssetDirectory = defineModel<boolean>('deleteRemoveAssetDirectory', { required: true })
const moveAssetDirectory = defineModel<boolean>('moveAssetDirectory', { required: true })
const moveFileName = defineModel<string>('moveFileName', { required: true })
const moveTargetDirectory = defineModel<string>('moveTargetDirectory', { required: true })

const dialog = ref<HTMLDialogElement | null>(null)
const titleInput = ref<HTMLInputElement | null>(null)
onMounted(() => {
    dialog.value?.showModal()
    titleInput.value?.focus()
})
onBeforeUnmount(() => dialog.value?.close())
const dialogTitle = computed(() => dialogContent[props.mode].title)
const dialogDescription = computed(() => dialogContent[props.mode].description)
</script>
