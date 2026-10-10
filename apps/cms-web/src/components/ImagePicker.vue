<template>
    <dialog
        ref="dialog"
        class="modal-card image-picker"
        aria-labelledby="image-picker-title"
        @cancel.prevent="!busy && emit('close')"
    >
        <header class="modal-header">
            <div>
                <h2 id="image-picker-title">
                    {{ cover ? t('选择封面', 'Choose a cover') : t('插入图片', 'Insert image') }}
                </h2>
                <p class="modal-subtitle">
                    {{ t('搜索已有图片，或上传一张新图片。', 'Find an existing image or upload a new one.') }}
                </p>
            </div>
            <button class="ghost-button" type="button" :disabled="busy" @click="emit('close')">
                {{ t('关闭', 'Close') }}
            </button>
        </header>
        <div class="image-picker-search">
            <label class="field">
                <span class="sr-only">{{ t('搜索图片', 'Search images') }}</span>
                <input
                    ref="search"
                    v-model="query"
                    type="search"
                    :placeholder="t('搜索文件名或路径…', 'Search filenames or paths…')"
                />
            </label>
            <button class="quiet-button" type="button" :disabled="busy" @click="fileInput?.click()">
                {{ t('上传图片', 'Upload image') }}
            </button>
            <input
                ref="fileInput"
                class="sr-only"
                tabindex="-1"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                @change="upload"
            />
        </div>
        <p class="field-hint">
            {{
                t(
                    'PNG、JPEG、WebP、GIF、AVIF，最大 20 MB。上传后立即保存到图片目录。',
                    'PNG, JPEG, WebP, GIF or AVIF, up to 20 MB. Uploads are saved to the image folder immediately.'
                )
            }}
        </p>
        <p v-if="error" class="notice-banner notice-banner--error" role="alert">{{ error }}</p>
        <p v-if="loading || busy" role="status">
            {{ busy ? t('正在处理图片…', 'Processing image…') : t('正在读取图片…', 'Loading images…') }}
        </p>
        <p v-else-if="!filtered.length" class="muted">
            {{
                query
                    ? t('没有匹配的图片。试试其他名称。', 'No matches. Try another name.')
                    : t('还没有图片，上传第一张吧。', 'No images yet. Upload the first one.')
            }}
        </p>
        <div class="image-picker-grid" :aria-busy="loading || busy">
            <button
                v-for="asset in filtered.slice(0, visibleCount)"
                :key="asset.sourcePath"
                type="button"
                :class="['image-option', { selected: selected?.sourcePath === asset.sourcePath }]"
                :aria-pressed="selected?.sourcePath === asset.sourcePath"
                :disabled="busy"
                @click="select(asset)"
            >
                <img :src="asset.previewSrc" alt="" loading="lazy" />
                <span>{{ asset.name }}</span>
                <small>{{ asset.sourcePath }}</small>
            </button>
        </div>
        <button v-if="filtered.length > visibleCount" class="quiet-button" type="button" @click="visibleCount += 60">
            {{ t('显示更多图片', 'Show more images') }}
        </button>
        <label v-if="selected" class="field image-picker-alt">
            <span>{{ t('图片说明（替代文本）', 'Image description (alternative text)') }}</span>
            <input v-model="alt" type="text" :disabled="busy" />
        </label>
        <footer class="modal-footer">
            <button class="primary-button" type="button" :disabled="!selected || busy" @click="confirm">
                {{ cover ? t('使用此封面', 'Use cover') : t('插入图片', 'Insert image') }}
            </button>
        </footer>
    </dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fetchImages, preparePublicImage, uploadImage } from '../api'
import type { CmsImageAsset } from '../types'
import { t } from '../i18n'

const props = defineProps<{ sourcePath: string; cover?: boolean }>()
const emit = defineEmits<{ close: []; select: [asset: CmsImageAsset, alt: string] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const search = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const assets = ref<CmsImageAsset[]>([])
const selected = ref<CmsImageAsset | null>(null)
const query = ref('')
const alt = ref('')
const error = ref('')
const loading = ref(true)
const busy = ref(false)
const visibleCount = ref(60)
const filtered = computed(() =>
    assets.value.filter((asset) =>
        `${asset.name} ${asset.sourcePath}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())
    )
)
watch(query, () => {
    visibleCount.value = 60
})
let returnFocus: HTMLElement | null = null
function select(asset: CmsImageAsset) {
    selected.value = asset
    alt.value = asset.name.replace(/\.[^.]+$/u, '')
}
async function upload(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    error.value = ''
    if (file.size > 20 * 1024 * 1024) {
        error.value = t('图片超过 20 MB，请选择较小的文件。', 'This image exceeds 20 MB. Choose a smaller file.')
        input.value = ''
        return
    }
    busy.value = true
    try {
        const asset = await uploadImage(file)
        assets.value = [asset, ...assets.value.filter((item) => item.sourcePath !== asset.sourcePath)]
        query.value = ''
        select(asset)
        alt.value = file.name.replace(/\.[^.]+$/u, '')
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : t('上传失败，请重试。', 'Upload failed. Try again.')
    } finally {
        busy.value = false
        input.value = ''
    }
}
async function confirm() {
    if (!selected.value) return
    error.value = ''
    busy.value = true
    try {
        // Relative GIFs are not handled by the site's responsive-image pipeline.
        const needsPublicCopy = props.cover || (!selected.value.publicSrc && /\.gif$/iu.test(selected.value.name))
        const asset = needsPublicCopy ? await preparePublicImage(selected.value.sourcePath) : selected.value
        emit('select', asset, alt.value)
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : t('无法使用此图片。', 'Could not use this image.')
    } finally {
        busy.value = false
    }
}
onMounted(async () => {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.value?.showModal()
    search.value?.focus()
    try {
        assets.value = await fetchImages(props.sourcePath)
    } catch (cause) {
        error.value =
            cause instanceof Error
                ? cause.message
                : t('加载图片失败，请重新打开。', 'Could not load images. Reopen the picker to retry.')
    } finally {
        loading.value = false
    }
})
onBeforeUnmount(() => {
    dialog.value?.close()
    returnFocus?.focus()
})
</script>
