<template>
    <label class="field">
        <span>{{ t('知识类型', 'Knowledge type') }}</span>
        <select v-model="draft.foundationKind" :disabled="disabled">
            <option v-for="kind in FOUNDATION_KINDS" :key="kind" :value="kind">
                {{ t(FOUNDATION_KIND_LABELS[kind], FOUNDATION_KIND_ENGLISH[kind]) }}
            </option>
        </select>
    </label>
    <EntryListField v-model="draft.domains" :label="t('所属领域', 'Domains')" :options="domains" :disabled="disabled" />
    <p v-if="!domains.length" class="field-hint">
        {{
            t(
                '请先在项目配置 foundations.groups 中添加领域。',
                'Add domains to foundations.groups in the project configuration first.'
            )
        }}
    </p>
    <template v-if="!creating">
        <label class="field">
            <span>{{ t('别名（每行一个）', 'Aliases (one per line)') }}</span>
            <textarea v-model="draft.aliasesText" rows="3" :disabled="disabled" />
        </label>
        <div v-if="relationWarnings?.length" class="notice-banner notice-banner--error" role="status">
            <p>
                {{
                    t(
                        '关系尚未完整，站点生成前需要完成以下修改：',
                        'Relations are incomplete. Finish these changes before the site can build:'
                    )
                }}
            </p>
            <ul>
                <li v-for="warning in relationWarnings" :key="warning">{{ warning }}</li>
            </ul>
        </div>
        <details class="advanced-fields">
            <summary>{{ t('知识关系', 'Knowledge relations') }} · {{ relationCount }}</summary>
            <p class="field-hint">
                {{ t('选择关系所指向的已有知识条目。', 'Choose the existing entries each relation points to.') }}
            </p>
            <p class="field-hint">
                {{
                    t(
                        '等价与对比是双向关系：添加或移除时，需要保存两端条目。',
                        'Equivalent and contrasting relations are reciprocal: save both entries when adding or removing a relation.'
                    )
                }}
            </p>
            <EntryListField
                v-for="field in FOUNDATION_RELATION_FIELDS"
                :key="field"
                v-model="draft.relations[field]"
                :label="relationLabels[field]"
                :options="entries"
                :disabled="disabled"
            />
        </details>
    </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
    FOUNDATION_KINDS,
    FOUNDATION_KIND_LABELS,
    FOUNDATION_KIND_ENGLISH,
    FOUNDATION_RELATION_FIELDS
} from '../../../../packages/content-core/src/foundations'
import { t } from '../i18n'
import type { CmsDocumentDraft } from '../draft'
import EntryListField from './EntryListField.vue'

defineProps<{
    domains: Array<{ id: string; title: string }>
    entries: Array<{ id: string; title: string }>
    disabled: boolean
    creating?: boolean
    relationWarnings?: string[]
}>()
const draft = defineModel<CmsDocumentDraft>({ required: true })
const relationCount = computed(() =>
    FOUNDATION_RELATION_FIELDS.reduce((count, field) => count + draft.value.relations[field].length, 0)
)
const relationLabels = {
    requires: t('依赖于', 'Requires'),
    uses: t('使用', 'Uses'),
    implemented_by: t('实现方式', 'Implemented by'),
    special_case_of: t('是其特例', 'Special case of'),
    equivalent_to: t('等价于', 'Equivalent to'),
    contrasts_with: t('对比于', 'Contrasts with')
}
</script>
