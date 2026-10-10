<template>
    <div class="field field--full">
        <label class="field">
            <span>{{ label }}</span>
            <input v-model="value" type="text" :placeholder="placeholder" :disabled="disabled" />
        </label>
        <div v-if="suggestions.length" class="field-suggestions">
            <button
                v-for="suggestion in suggestions"
                :key="suggestion"
                class="suggestion-chip"
                type="button"
                :disabled="disabled"
                @click="value = appendCsvValue(value, suggestion)"
            >
                {{ suggestion }}
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { appendCsvValue } from '../draft'

defineProps<{
    label: string
    placeholder: string
    suggestions: string[]
    disabled: boolean
}>()

const value = defineModel<string>({ required: true })
</script>
