<template>
    <div class="field field--full">
        <label class="field">
            <span>{{ label }}</span>
            <input
                v-model="query"
                :list="listId"
                :placeholder="t('搜索名称或 ID，选择后添加', 'Find a name or ID, then add')"
                :disabled="disabled"
                @change="addSelection"
                @keydown.enter.prevent="addSelection"
            />
        </label>
        <datalist :id="listId">
            <option v-for="option in availableOptions" :key="option.id" :value="option.id" :label="option.title" />
        </datalist>
        <p v-if="query && !availableOptions.some((option) => option.id === query.trim())" class="field-hint">
            {{ t('从建议中选择已有条目。', 'Choose an existing entry from the suggestions.') }}
        </p>
        <ul v-if="value.length" class="selected-entries">
            <li v-for="id in value" :key="id">
                <span :title="id">{{ options.find((option) => option.id === id)?.title || id }}</span>
                <button
                    type="button"
                    :disabled="disabled"
                    :aria-label="`${t('移除', 'Remove')} ${id}`"
                    @click="value = value.filter((entry) => entry !== id)"
                >
                    ×
                </button>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { t } from '../i18n'

const props = defineProps<{
    label: string
    options: Array<{ id: string; title: string }>
    disabled: boolean
}>()
const value = defineModel<string[]>({ required: true })
const query = ref('')
const listId = useId()
const availableOptions = computed(() => props.options.filter((option) => !value.value.includes(option.id)))
function addSelection() {
    const id = query.value.trim()
    if (!availableOptions.value.some((option) => option.id === id)) return
    value.value = [...value.value, id]
    query.value = ''
}
</script>
