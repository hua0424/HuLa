<template>
  <div data-testid="aiclaw-command-policy-form">
    <div class="flex items-center gap-8px mb-8px">
      <span class="text-13px font-500">{{ t('aiclaw.command_policy.title') }}</span>
      <span
        class="text-11px px-8px py-2px rounded-4px bg-#13987f15 text-#13987f"
        :data-testid="`aiclaw-command-policy-scope-${scopeKind}`">
        {{ scopeKind === 'group' ? t('aiclaw.command_policy.scope_group') : t('aiclaw.command_policy.scope_default') }}
      </span>
      <span v-if="loading" class="text-11px text-#999">{{ t('aiclaw.thinking.review_loading') }}</span>
      <span v-else-if="loadError" class="text-11px text-#d03050">{{ t('aiclaw.command_policy.load_failed') }}</span>
    </div>
    <div v-if="scopeKind === 'group'" class="text-11px text-#999 mb-8px">
      {{ t('aiclaw.command_policy.offlist_hint') }}
    </div>
    <!-- 默认规则（代码常量，只读展示） -->
    <div
      v-for="row in defaults"
      :key="`default-${row.capabilityId}`"
      class="flex items-center justify-between py-4px text-12px">
      <span class="truncate" :title="row.capabilityId">{{ row.capabilityId }}</span>
      <span class="flex items-center gap-4px flex-shrink-0">
        <span class="text-11px px-6px py-1px rounded-4px bg-#99915 text-#999">
          {{ t('aiclaw.command_policy.default_badge') }}
        </span>
        <span
          class="text-11px px-6px py-1px rounded-4px"
          :class="row.state === 'open' ? 'bg-#13987f15 text-#13987f' : 'bg-#d0305015 text-#d03050'">
          {{ stateLabel(row.state) }}
        </span>
      </span>
    </div>
    <!-- 显式覆盖行（可编辑） -->
    <div
      v-for="row in editableRows"
      :key="`${row.roomId}-${row.capabilityId}`"
      class="py-6px border-t border-[--line-color]"
      :data-testid="`aiclaw-command-policy-row-${row.capabilityId}`">
      <div class="flex items-center gap-8px">
        <span class="text-12px truncate flex-1" :title="row.capabilityId">{{ row.capabilityId }}</span>
        <span
          v-if="row.state === 'approval_required'"
          class="text-11px px-6px py-1px rounded-4px bg-#e6a23c15 text-#e6a23c">
          {{ t('aiclaw.command_policy.approval_badge') }}
        </span>
        <n-select
          v-model:value="row.state"
          :options="stateOptions"
          size="small"
          style="width: 130px"
          :data-testid="`aiclaw-command-policy-state-${row.capabilityId}`"
          :aria-label="t('aiclaw.command_policy.state')" />
      </div>
      <div v-if="scopeKind === 'group'" class="flex items-center gap-8px mt-6px">
        <n-select
          v-model:value="row.mode"
          :options="modeOptions"
          size="small"
          style="width: 130px"
          :data-testid="`aiclaw-command-policy-mode-${row.capabilityId}`"
          :aria-label="t('aiclaw.command_policy.mode')" />
        <n-input
          v-if="row.mode === 'list'"
          v-model:value="row.allowedUidsText"
          size="small"
          :placeholder="t('aiclaw.command_policy.allowed_uids')"
          :data-testid="`aiclaw-command-policy-uids-${row.capabilityId}`"
          :aria-label="t('aiclaw.command_policy.allowed_uids')" />
        <n-button
          size="small"
          type="primary"
          secondary
          :loading="savingKey === row.capabilityId"
          :data-testid="`aiclaw-command-policy-save-${row.capabilityId}`"
          @click="handleSaveRow(row)">
          {{ t('aiclaw.command_policy.save') }}
        </n-button>
      </div>
      <div v-else class="mt-6px">
        <n-button
          size="small"
          type="primary"
          secondary
          :loading="savingKey === row.capabilityId"
          :data-testid="`aiclaw-command-policy-save-${row.capabilityId}`"
          @click="handleSaveRow(row)">
          {{ t('aiclaw.command_policy.save') }}
        </n-button>
      </div>
    </div>
    <!-- 新增行 -->
    <div class="flex items-center gap-8px mt-8px pt-8px border-t border-[--line-color]">
      <n-input
        v-model:value="newCapabilityId"
        size="small"
        :placeholder="t('aiclaw.command_policy.add_capability')"
        data-testid="aiclaw-command-policy-new-id"
        :aria-label="t('aiclaw.command_policy.add_capability')" />
      <n-select
        v-model:value="newState"
        :options="stateOptions"
        size="small"
        style="width: 130px"
        data-testid="aiclaw-command-policy-new-state"
        :aria-label="t('aiclaw.command_policy.state')" />
      <n-button
        size="small"
        type="primary"
        :disabled="!newCapabilityId.trim()"
        :loading="savingKey === '__new'"
        data-testid="aiclaw-command-policy-add"
        @click="handleAddRow">
        {{ t('aiclaw.command_policy.add') }}
      </n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getCommandPolicy, putCommandPolicy, type CommandPolicyRow } from '@/services/agentCommands'

type EditableRow = CommandPolicyRow & { allowedUidsText: string }

const props = defineProps<{
  aiclawUid: string
  /** 缺省=默认规则；>0=群 room_id 覆盖 */
  roomId?: string
}>()

const { t } = useI18n()

const scopeKind = computed(() => (props.roomId ? 'group' : 'default'))
const loading = ref(false)
const loadError = ref(false)
const savingKey = ref<string | null>(null)
const defaults = ref<CommandPolicyRow[]>([])
const editableRows = ref<EditableRow[]>([])
const newCapabilityId = ref('')
const newState = ref<'open' | 'closed' | 'approval_required'>('closed')

const toEditable = (row: CommandPolicyRow): EditableRow => ({
  ...row,
  mode: row.mode ?? 'all',
  allowedUidsText: (row.allowedUids ?? []).join(',')
})

const stateOptions = computed(() => [
  { label: t('aiclaw.command_policy.state_open'), value: 'open' },
  { label: t('aiclaw.command_policy.state_closed'), value: 'closed' },
  { label: t('aiclaw.command_policy.state_approval'), value: 'approval_required' }
])
const modeOptions = computed(() => [
  { label: t('aiclaw.command_policy.mode_all'), value: 'all' },
  { label: t('aiclaw.command_policy.mode_list'), value: 'list' }
])
const stateLabel = (state: string) => {
  if (state === 'open') return t('aiclaw.command_policy.state_open')
  if (state === 'approval_required') return t('aiclaw.command_policy.state_approval')
  return t('aiclaw.command_policy.state_closed')
}

const parseUids = (text: string): number[] | undefined => {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const uids = trimmed
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isSafeInteger(n) && n > 0)
  return uids
}

let disposed = false

const fetchPolicy = async () => {
  loading.value = true
  loadError.value = false
  try {
    const policy = await getCommandPolicy(
      props.roomId ? { aiclawUid: props.aiclawUid, roomId: props.roomId } : { aiclawUid: props.aiclawUid }
    )
    if (disposed) return
    defaults.value = policy?.defaults ?? []
    editableRows.value = (policy?.rows ?? [])
      .filter((row) => (props.roomId ? Number(row.roomId) > 0 : Number(row.roomId) === 0))
      .map(toEditable)
  } catch {
    if (!disposed) loadError.value = true
  } finally {
    if (!disposed) loading.value = false
  }
}

const saveItems = async (
  key: string,
  items: { capabilityId: string; state: string; mode?: string; allowedUids?: number[]; version?: number }[]
) => {
  savingKey.value = key
  try {
    await putCommandPolicy(
      props.roomId
        ? { aiclawUid: props.aiclawUid, roomId: props.roomId, items: items as never }
        : { aiclawUid: props.aiclawUid, items: items as never }
    )
    await fetchPolicy()
    window.$message?.success?.(t('aiclaw.command_policy.save_success'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '')
    window.$message?.error?.(
      message.includes('version_conflict')
        ? t('aiclaw.command_policy.version_conflict')
        : t('aiclaw.command_policy.save_failed')
    )
  } finally {
    savingKey.value = null
  }
}

const handleSaveRow = (row: EditableRow) =>
  saveItems(row.capabilityId, [
    {
      capabilityId: row.capabilityId,
      state: row.state,
      ...(scopeKind.value === 'group'
        ? { mode: row.mode ?? 'all', allowedUids: row.mode === 'list' ? parseUids(row.allowedUidsText) : undefined }
        : {}),
      version: row.version ?? undefined
    }
  ])

const handleAddRow = () => {
  const capabilityId = newCapabilityId.value.trim()
  if (!capabilityId) return
  saveItems('__new', [
    {
      capabilityId,
      state: newState.value,
      ...(scopeKind.value === 'group' ? { mode: 'all' as const } : {})
    }
  ]).then(() => {
    newCapabilityId.value = ''
  })
}

onMounted(() => {
  fetchPolicy()
})

watch(
  () => [props.aiclawUid, props.roomId],
  () => {
    fetchPolicy()
  }
)

// 卸载后不再改写
import { onBeforeUnmount } from 'vue'
onBeforeUnmount(() => {
  disposed = true
})
</script>
