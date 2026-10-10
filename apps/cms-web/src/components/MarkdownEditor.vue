<template>
    <div :class="['markdown-editor-shell', { 'markdown-editor-shell--readonly': readOnly }]">
        <div class="editor-insert-toolbar" role="toolbar" :aria-label="t('插入内容', 'Insert content')">
            <button class="quiet-button" type="button" :disabled="readOnly || uploading" @click="insertLink">
                {{ t('站内链接', 'Internal link') }}
            </button>
            <button class="quiet-button" type="button" :disabled="readOnly || uploading" @click="showImages = true">
                {{ t('图片', 'Image') }}
            </button>
            <span class="editor-hint" :class="{ 'editor-hint--status': uploading }" role="status">{{
                uploading
                    ? t('正在上传图片…', 'Uploading images…')
                    : t('输入 [[ 引用 · 可粘贴或拖入图片', 'Type [[ to link · Paste or drop images')
            }}</span>
        </div>
        <p v-if="imageError" class="notice-banner notice-banner--error" role="alert">{{ imageError }}</p>
        <div class="markdown-editor-toolbar">
            <div class="markdown-editor-toolbar__group">
                <span class="editor-pill"
                    >{{ metrics.lines }} {{ t('行', metrics.lines === 1 ? 'line' : 'lines') }}</span
                >
                <span class="editor-pill"
                    >{{ metrics.words }} {{ t('词', metrics.words === 1 ? 'word' : 'words') }}</span
                >
                <span class="editor-pill"
                    >{{ metrics.characters }}
                    {{ t('字符', metrics.characters === 1 ? 'character' : 'characters') }}</span
                >
            </div>

            <div class="markdown-editor-toolbar__group">
                <span class="editor-hint">{{ readOnly ? t('正在处理文档…', 'Updating document…') : 'Markdown' }}</span>
            </div>
        </div>

        <div ref="editorHost" class="markdown-editor-host" />
        <ImagePicker v-if="showImages" :source-path="sourcePath" @close="showImages = false" @select="insertImage" />
    </div>
</template>

<script setup lang="ts">
import { t } from '../i18n'

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { autocompletion, completionKeymap, startCompletion } from '@codemirror/autocomplete'
import { markdown } from '@codemirror/lang-markdown'
import {
    bracketMatching,
    defaultHighlightStyle,
    HighlightStyle,
    indentOnInput,
    syntaxHighlighting
} from '@codemirror/language'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import {
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    lineNumbers,
    placeholder as editorPlaceholder
} from '@codemirror/view'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getEditorMetrics } from '../editor-metrics'
import { buildLinkTargets, createWritingCompletion, imageMarkdown } from '../editor-completion'
import type { CmsImageAsset, CmsLibrarySnapshot } from '../types'
import { uploadImage } from '../api'
import ImagePicker from './ImagePicker.vue'

const props = withDefaults(
    defineProps<{
        modelValue: string
        placeholder?: string
        readOnly?: boolean
        sourcePath: string
        library: CmsLibrarySnapshot | null
    }>(),
    {
        placeholder: t('开始编写 Markdown…', 'Start writing Markdown…'),
        readOnly: false
    }
)

const emit = defineEmits<{
    'update:modelValue': [value: string]
    save: []
    busy: [value: boolean]
}>()

const editorHost = ref<HTMLDivElement | null>(null)
const metrics = computed(() => getEditorMetrics(props.modelValue))
const targets = computed(() => buildLinkTargets(props.library))
const showImages = ref(false)
const imageError = ref('')
const uploading = ref(false)
// Keep the existing syntax vocabulary readable on both workbench surfaces.
const highlightStyle = HighlightStyle.define(
    defaultHighlightStyle.specs.map((style) => ({
        ...style,
        ...(style.color ? { color: `color-mix(in srgb, ${style.color} 40%, var(--cms-text-1))` } : {})
    }))
)

let editorView: EditorView | null = null
const readOnlyCompartment = new Compartment()
const editableCompartment = new Compartment()

function createExtensions() {
    return [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        markdown(),
        autocompletion({
            override: [
                createWritingCompletion(
                    () => targets.value,
                    () => props.sourcePath,
                    (message) => {
                        imageError.value = message
                    }
                )
            ],
            defaultKeymap: false,
            icons: false,
            maxRenderedOptions: 30
        }),
        Prec.highest(keymap.of(completionKeymap)),
        EditorView.domEventHandlers({
            paste(event) {
                return receiveImages(event, Array.from(event.clipboardData?.files ?? []))
            },
            drop(event, view) {
                const files = Array.from(event.dataTransfer?.files ?? [])
                const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
                return receiveImages(event, files, position ?? undefined)
            }
        }),
        syntaxHighlighting(highlightStyle, { fallback: true }),
        bracketMatching(),
        indentOnInput(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': t('Markdown 正文', 'Markdown body') }),
        editorPlaceholder(props.placeholder),
        Prec.high(
            keymap.of([
                {
                    key: 'Mod-s',
                    run: () => {
                        if (!uploading.value) emit('save')
                        return true
                    }
                },
                indentWithTab,
                ...defaultKeymap,
                ...historyKeymap
            ])
        ),
        EditorView.updateListener.of((update) => {
            if (!update.docChanged) return

            emit('update:modelValue', update.state.doc.toString())
        }),
        readOnlyCompartment.of(EditorState.readOnly.of(props.readOnly)),
        editableCompartment.of(EditorView.editable.of(!props.readOnly))
    ]
}

function mountEditor() {
    if (!editorHost.value) return

    editorView = new EditorView({
        state: EditorState.create({
            doc: props.modelValue,
            extensions: createExtensions()
        }),
        parent: editorHost.value
    })
}

function destroyEditor() {
    editorView?.destroy()
    editorView = null
}

watch(
    () => props.modelValue,
    (nextValue) => {
        if (!editorView) return

        const currentValue = editorView.state.doc.toString()
        if (nextValue === currentValue) return

        editorView.dispatch({
            changes: {
                from: 0,
                to: editorView.state.doc.length,
                insert: nextValue
            }
        })
    }
)

watch(
    () => props.readOnly || uploading.value,
    (readOnly) => {
        if (!editorView) return

        editorView.dispatch({
            effects: [
                readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
                editableCompartment.reconfigure(EditorView.editable.of(!readOnly))
            ]
        })
    }
)

function insertLink() {
    if (!editorView || props.readOnly) return
    const { from, to } = editorView.state.selection.main
    const label = editorView.state.sliceDoc(from, to).replace(/[[\]|\n]/gu, ' ')
    editorView.dispatch({
        changes: { from, to, insert: `[[${label ? `|${label}` : ''}]]` },
        selection: { anchor: from + 2 },
        userEvent: 'input'
    })
    editorView.focus()
    startCompletion(editorView)
}

async function insertImage(asset: CmsImageAsset, alt: string) {
    if (!editorView || props.readOnly) return
    showImages.value = false
    editorView.dispatch(editorView.state.replaceSelection(imageMarkdown(asset.src, alt)))
    await nextTick()
    editorView?.focus()
}

function receiveImages(event: Event, files: File[], position?: number) {
    if (!files.length || !files.some((file) => file.type.startsWith('image/'))) return false
    event.preventDefault()
    if (props.readOnly || uploading.value || !editorView) return true
    const range = position === undefined ? editorView.state.selection.main : { from: position, to: position }
    void uploadFiles(files, range.from, range.to)
    return true
}

async function uploadFiles(files: File[], from: number, to: number) {
    uploading.value = true
    emit('busy', true)
    imageError.value = ''
    const inserted: string[] = []
    try {
        for (const file of files) {
            if (!file.type.startsWith('image/')) continue
            if (file.size > 20 * 1024 * 1024)
                throw new Error(
                    t('图片超过 20 MB，请选择较小的文件。', 'This image exceeds 20 MB. Choose a smaller file.')
                )
            const asset = await uploadImage(file)
            inserted.push(imageMarkdown(asset.src, file.name.replace(/\.[^.]+$/u, '')))
        }
    } catch (cause) {
        imageError.value = cause instanceof Error ? cause.message : t('上传失败，请重试。', 'Upload failed. Try again.')
    } finally {
        if (editorView && inserted.length) {
            const text = inserted.join('\n\n')
            editorView.dispatch({
                changes: { from, to, insert: text },
                selection: { anchor: from + text.length },
                userEvent: 'input'
            })
        }
        uploading.value = false
        emit('busy', false)
        await nextTick()
        editorView?.focus()
    }
}

onMounted(mountEditor)
onBeforeUnmount(destroyEditor)

defineExpose({
    focus() {
        if (!editorView) return
        editorView.requestMeasure()
        editorView.focus()
        editorView.dispatch({ effects: EditorView.scrollIntoView(editorView.state.selection.main) })
    }
})
</script>
