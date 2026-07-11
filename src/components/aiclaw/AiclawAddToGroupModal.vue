<template>
  <n-modal v-model:show="modelVisible" preset="dialog" :show-icon="false" :closable="true" :mask-closable="false">
    <template #header>
      <span class="text-16px font-600">{{ t('aiclaw.group_settings.add_to_group_title') }}</span>
    </template>
    <div class="flex flex-col gap-12px py-8px" data-testid="aiclaw-add-to-group-modal">
      <div class="text-13px text-#999">
        {{ t('aiclaw.group_settings.add_to_group_subtitle') }}
      </div>

      <template v-if="availableGroups.length > 0">
        <n-select
          v-model:value="selectedRoomId"
          :options="groupOptions"
          :placeholder="t('aiclaw.group_settings.add_to_group_placeholder')"
          filterable
          data-testid="aiclaw-add-to-group-select" />
      </template>
      <div v-else class="text-13px text-#999 text-center py-16px" data-testid="aiclaw-add-to-group-empty">
        {{ t('aiclaw.group_settings.add_to_group_empty') }}
      </div>
    </div>
    <template #action>
      <n-button @click="modelVisible = false">{{ t('home.chat_main.cancel') }}</n-button>
      <n-button
        type="primary"
        :disabled="!selectedRoomId || availableGroups.length === 0"
        :loading="submitting"
        data-testid="aiclaw-add-to-group-confirm"
        @click="handleConfirm">
        {{ t('aiclaw.group_settings.add_to_group_confirm') }}
      </n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RoomTypeEnum } from '@/enums'
import { IsAllUserEnum } from '@/services/types'
import { useChatStore } from '@/stores/chat'
import { AvatarUtils } from '@/utils/AvatarUtils'
import { inviteGroupMember } from '@/utils/ImRequestUtils'
import { buildGroupCardLabel } from '@/utils/aiclawGroupConfig'

const props = defineProps<{
  visible: boolean
  aiclawUid: string
  aiclawName?: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  invited: [roomId: string]
}>()

const { t } = useI18n()
const chatStore = useChatStore()

const modelVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

const selectedRoomId = ref('')
const submitting = ref(false)

/**
 * 可添加的群 = owner 的群会话（type=GROUP、非频道），排除该 aiclaw 已在的群。
 * SessionItem 不带当前用户角色，能否邀请由 server 端 invite 权限校验兜底。
 */
const availableGroups = computed(() => {
  const joinedRoomIds = new Set(
    chatStore.getAiclawGroupConfigList(Number(props.aiclawUid)).map((cfg) => String(cfg.roomId))
  )
  return chatStore.sessionList.filter(
    (s) => s.type === RoomTypeEnum.GROUP && s.hotFlag !== IsAllUserEnum.Yes && !joinedRoomIds.has(String(s.roomId))
  )
})

const groupOptions = computed(() =>
  availableGroups.value.map((s) => ({
    label: buildGroupCardLabel(s.name, s.account, s.roomId),
    value: s.roomId,
    avatar: AvatarUtils.getAvatarUrl(s.avatar)
  }))
)

const handleConfirm = async () => {
  if (!selectedRoomId.value) return
  submitting.value = true
  try {
    await inviteGroupMember({ roomId: selectedRoomId.value, uidList: [props.aiclawUid] })
    window.$message?.success?.(t('aiclaw.group_settings.add_to_group_success'))
    emit('invited', selectedRoomId.value)
    modelVisible.value = false
  } catch (error) {
    console.error('[AiclawAddToGroupModal] Failed to add aiclaw to group:', error)
    window.$message?.error?.(t('aiclaw.group_settings.add_to_group_failed'))
  } finally {
    submitting.value = false
  }
}

// 打开时预加载该 aiclaw 的已在群列表，保证 availableGroups 排除准确；重置选择
watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible) {
      selectedRoomId.value = ''
      void chatStore.loadAiclawGroupConfigs(Number(props.aiclawUid))
    }
  },
  { immediate: true }
)

defineExpose({ availableGroups, selectedRoomId, handleConfirm })
</script>
