<template>
    <ul class="tree-list">
        <li v-for="node in nodes" :key="node.path">
            <div v-if="node.type === 'directory'" class="tree-row">
                <button
                    class="tree-row__main"
                    type="button"
                    :aria-expanded="isExpanded(node.path)"
                    :title="node.path"
                    @click="$emit('toggle', node.path)"
                >
                    <span :class="['tree-caret', { 'tree-caret--open': isExpanded(node.path) }]" aria-hidden="true" />
                    <span class="tree-row__label">{{ node.name }}</span>
                    <span class="tree-count">{{ node.documentCount }}</span>
                </button>
                <button
                    class="tree-create"
                    type="button"
                    :disabled="busy"
                    :aria-label="`${t('在此目录新建：', 'Create in ')}${node.path}`"
                    @click="$emit('create', node.path)"
                >
                    {{ t('新建', 'New') }}
                </button>
            </div>
            <button
                v-else
                :class="['tree-document', { active: node.sourcePath === selectedSourcePath }]"
                type="button"
                :aria-current="node.sourcePath === selectedSourcePath ? 'page' : undefined"
                :title="`${node.title}\n${node.sourcePath}`"
                @click="$emit('select', node.sourcePath)"
            >
                {{ node.title }}
            </button>
            <ContentTreeBranch
                v-if="node.type === 'directory' && isExpanded(node.path)"
                :nodes="node.children"
                :expanded-paths="expandedPaths"
                :selected-source-path="selectedSourcePath"
                :busy="busy"
                @toggle="$emit('toggle', $event)"
                @select="$emit('select', $event)"
                @create="$emit('create', $event)"
            />
        </li>
    </ul>
</template>

<script setup lang="ts">
import { t } from '../i18n'
import type { CmsLibraryTreeNode } from '../types'

defineOptions({ name: 'ContentTreeBranch' })
const props = defineProps<{
    nodes: CmsLibraryTreeNode[]
    expandedPaths: string[]
    selectedSourcePath: string
    busy: boolean
}>()
defineEmits<{
    toggle: [path: string]
    select: [sourcePath: string]
    create: [directoryPath: string]
}>()
function isExpanded(path: string) {
    return props.expandedPaths.includes(path)
}
</script>
