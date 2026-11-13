<template>
  <div
    v-if="loading || items.length || loadError"
    class="mt-12px pt-12px border-t border-[--line-color]"
    data-testid="aiclaw-command-approval-list">
    <div class="flex items-center gap-8px mb-8px">
      <span class="text-13px font-500">{{ t('aiclaw.command_approval.title') }}</span>
      <span v-if="loading" class="text-11px text-#999">{{ t('aiclaw.command_approval.loading') }}</span>
      <span v-else-if="loadError" class="text-11px text-#d03050">
        {{ t('aiclaw.command_approval.load_failed') }}
      </span>
    </div>
    <div v-if="!loading && !loadError && !items.length" class="text-11px text-#999">
      {{ t('aiclaw.command_approval.empty') }}
    </div>
    <div
      v-for="item in items"
      :key="item.requestId"
      class="py-6px border-t border-[--line-color] first:border-t-0"
      :data-testid="`aiclaw-command-approval-row-${item.requestId}`">
      <div class="text-12px break-words">
        <strong>{{ item.capabilityId || item.requestId }}</strong>
        <span class="text-#999">· {{ t('aiclaw.command_approval.caller') }}: {{ item.callerUid }}</span>
      </div>
      <div class="text-11px text-#999 break-words">
        {{ describeParameters(item) }}
      </div>
      <div class="flex items-center gap-8px mt-4px">
        <span class="text-11px text-#e6a23c">
          {{ t('aiclaw.command_approval.expires_in', { seconds: secondsLeft(item) }) }}
        </span>
        <n-button
          size="small"
          type="primary"
          :loading="busyId === item.requestId"
          :data-testid="`aiclaw-command-approval-approve-${item.requestId}`"
          @click="decide(item, true)">
          {{ t('aiclaw.command_approval.approve') }}
        </n-button>
        <n-button
          size="small"
          :loading="busyId === item.requestId"
          :data-testid="`aiclaw-command-approval-reject-${item.requestId}`"
          @click="decide(item, false)">
          {{ t('aiclaw.command_approval.reject') }}
        </n-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  approveAgentCommand,
  getAgentCommandApprovals,
  rejectAgentCommand,
  type AgentCommandApproval
} from '@/services/agentCommands'
import { useMitt } from '@/hooks/useMitt'
import { listenBound } from '@/services/sessionBinding'
import { WsResponseMessageType, type CommandApprovalPayload } from '@/services/wsType'
import { isDesktop } from '@/utils/PlatformConstants'
import type { UnlistenFn } from '@tauri-apps/api/event'

const props = defineProps<{
  aiclawUid: string
  /** 缺省=默认规则页，展示该助理全部待审批；>0=仅该群 */
  roomId?: string
}>()

const { t } = useI18n()
const items = ref<AgentCommandApproval[]>([])
const loading = ref(false)
const loadError = ref(false)
const busyId = ref('')
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
let disposed = false
let approvalUnlisten: UnlistenFn | undefined

const secondsLeft = (item: AgentCommandApproval) => Math.max(0, Math.ceil((item.expiresAt - now.value) / 1000))
const describeParameters = (item: AgentCommandApproval) => {
  const parameters = item.parameters
  if (!parameters) return ''
  if (parameters.arguments) return parameters.arguments
  if (parameters.providerId || parameters.modelId) return `${parameters.providerId ?? ''} · ${parameters.modelId ?? ''}`
  return ''
}

const visible = (item: AgentCommandApproval) =>
  String(item.aiclawUid) === props.aiclawUid && (!props.roomId || String(item.roomId) === props.roomId)

const load = async () => {
  if (!props.aiclawUid) return
  loading.value = true
  loadError.value = false
  try {
    const result = await getAgentCommandApprovals()
    if (!disposed) items.value = (Array.isArray(result) ? result : []).filter(visible)
  } catch {
    if (!disposed) loadError.value = true
  } finally {
    if (!disposed) loading.value = false
  }
}

const decide = async (item: AgentCommandApproval, approve: boolean) => {
  if (busyId.value) return
  busyId.value = item.requestId
  try {
    if (approve) await approveAgentCommand(item.requestId)
    else await rejectAgentCommand(item.requestId)
    await load()
  } catch {
    window.$message?.error?.(t('aiclaw.command_approval.action_failed'))
  } finally {
    busyId.value = ''
  }
}

const refreshOnRequest = (data: CommandApprovalPayload) => {
  if (!disposed && data && String(data.aiclawUid) === props.aiclawUid) void load()
}

onMounted(async () => {
  if (isDesktop()) {
    try {
      const unlisten = await listenBound<CommandApprovalPayload>('ws-command-approval-request', ({ payload }) => {
        refreshOnRequest(payload)
      })
      if (disposed) unlisten()
      else approvalUnlisten = unlisten
    } catch (error) {
      console.error('[CommandApprovalList] Failed to listen for approvals:', error)
    }
  }
  if (disposed) return
  void load()
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

// Web / 移动端与聊天 WS 共用上下文；桌面直接接绑定事件，避免 home 内重复刷新。
if (!isDesktop()) useMitt.on(WsResponseMessageType.COMMAND_APPROVAL_REQUEST, refreshOnRequest)

watch(
  () => [props.aiclawUid, props.roomId],
  () => {
    void load()
  }
)

onBeforeUnmount(() => {
  disposed = true
  approvalUnlisten?.()
  if (timer) clearInterval(timer)
})
</script>
