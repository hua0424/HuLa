<template>
  <div class="flex w-full flex-col h-full">
    <HeaderBar
      :isOfficial="false"
      :hidden-right="true"
      :enable-default-background="false"
      :enable-shadow="false"
      room-name="发起群聊" />

    <!-- 顶部搜索框 -->
    <div class="px-16px mt-10px flex gap-3">
      <div class="flex-1 py-5px shrink-0">
        <n-input
          v-model:value="keyword"
          placeholder="搜索联系人~"
          clearable
          round
          spellCheck="false"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off">
          <template #prefix>
            <svg class="w-12px h-12px"><use href="#search"></use></svg>
          </template>
        </n-input>
      </div>
      <div class="flex justify-end items-center">
        <n-button strong secondary round @click="doSearch">搜索</n-button>
      </div>
    </div>

    <!-- 联系人列表 -->
    <!-- 联系人列表 -->
    <div ref="scrollArea" class="flex-1 overflow-y-auto px-16px mt-10px" :style="{ height: scrollHeight + 'px' }">
      <n-scrollbar style="max-height: calc(100vh - 150px)">
        <n-checkbox-group v-model:value="selectedList" class="flex flex-col gap-2">
          <div
            v-for="item in filteredContacts"
            :key="item.uid"
            class="rounded-10px border border-gray-200 overflow-hidden">
            <n-checkbox
              :value="item.uid"
              size="large"
              class="w-full flex items-center px-5px"
              :class="[
                'cursor-pointer select-none transition-colors duration-150',
                selectedList.includes(item.uid)
                  ? 'bg-[#f5f5f5] dark:bg-[#404040] border-blue-300'
                  : 'hover:bg-[#f5f5f5] dark:hover:bg-[#404040] border-gray-200'
              ]">
              <template #default>
                <!-- ✅ 强制一行展示 -->
                <div class="flex items-center gap-10px px-8px py-10px">
                  <!-- 头像 -->
                  <n-avatar
                    round
                    :size="44"
                    :src="AvatarUtils.getAvatarUrl(groupStore.getUserInfo(item.uid)!.avatar!)"
                    fallback-src="/logo.png"
                    style="border: 1px solid var(--avatar-border-color)" />
                  <!-- 文字信息 -->
                  <div class="flex flex-col leading-tight truncate">
                    <span class="text-14px font-medium truncate">
                      {{ groupStore.getUserInfo(item.uid)!.name }}
                    </span>
                    <div class="text-12px text-gray-500 flex items-center gap-4px truncate">
                      <template v-if="getUserState(item.uid)">
                        <img class="size-12px rounded-50%" :src="getUserState(item.uid)?.url" alt="" />
                        <n-text>{{ getUserState(item.uid)?.title }}</n-text>
                      </template>
                      <template v-else>
                        <n-badge :color="item.activeStatus === OnlineEnum.ONLINE ? '#1ab292' : '#909090'" dot />
                        <n-text>{{ item.activeStatus === OnlineEnum.ONLINE ? '在线' : '离线' }}</n-text>
                      </template>
                    </div>
                  </div>
                </div>
              </template>
            </n-checkbox>
          </div>
        </n-checkbox-group>
      </n-scrollbar>
    </div>

    <!-- 底部操作栏 -->
    <div class="px-16px py-10px bg-white border-t border-gray-200 flex flex-col gap-8px">
      <!-- REQ-016 #195 F3：群名输入（可空，空维持 server 默认命名） -->
      <n-input
        v-model:value="groupName"
        size="small"
        :maxlength="30"
        :disabled="creating"
        placeholder="群名称（选填，不填按成员自动生成）"
        data-testid="create-group-name" />
      <div class="flex justify-between items-center">
        <span class="text-14px">已选择 {{ selectedList.length }} 人</span>
        <n-button
          type="primary"
          :disabled="selectedList.length === 0 || creating"
          :loading="creating"
          data-testid="create-group-submit"
          @click="createGroup">
          发起群聊
        </n-button>
      </div>
    </div>
    <!-- 创建群聊后批量配置 owner aiclaw -->
    <AiclawBatchGroupConfigModal
      v-model:visible="batchConfigModalVisible"
      :room-id="batchConfigRoomId"
      :account="batchConfigAccount"
      :aiclaw-items="batchConfigAiclawItems" />
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { OnlineEnum } from '@/enums'
import { useContactStore } from '@/stores/contacts'
import { useGroupStore } from '@/stores/group'
import { useUserStatusStore } from '@/stores/userStatus'
import { AvatarUtils } from '@/utils/AvatarUtils'
import AiclawBatchGroupConfigModal from '@/components/aiclaw/AiclawBatchGroupConfigModal.vue'
import { createGroupFlow } from '@/utils/createGroupFlow'
import { useGlobalStore } from '@/stores/global.ts'

const userStatusStore = useUserStatusStore()
const { stateList } = storeToRefs(userStatusStore)
const groupStore = useGroupStore()
const globalStore = useGlobalStore()

// 创建群聊后批量 aiclaw 配置弹窗
const batchConfigModalVisible = ref(false)
const batchConfigRoomId = ref('')
const batchConfigAccount = ref('')
const batchConfigAiclawItems = ref<Array<{ uid: string; name?: string; adapterType?: string }>>([])

/** 获取用户状态 */
const getUserState = (uid: string) => {
  const userInfo = groupStore.getUserInfo(uid)
  const userStateId = userInfo?.userStateId

  if (userStateId && userStateId !== '1') {
    return stateList.value.find((state: { id: string }) => state.id === userStateId)
  }
  return null
}

// store
const contactStore = useContactStore()

// 搜索关键字
const keyword = ref('')

// 选中的联系人 uid 数组
const selectedList = ref<string[]>([])

// 滚动高度计算
const scrollHeight = ref(600)
onMounted(() => {
  scrollHeight.value = window.innerHeight - 180
})

// 搜索逻辑
const doSearch = () => {
  // 这里只是触发响应式，实际过滤逻辑写在 computed 里
}

const filteredContacts = computed(() => {
  const contactsList = contactStore.contactsList.filter((c) => {
    if (c.uid === '1') {
      // 排除hula小管家
      return false
    }
    return true
  })

  if (!keyword.value) return contactsList
  return contactsList.filter((c) => {
    const name = groupStore.getUserInfo(c.uid)!.name
    if (name) {
      name.includes(keyword.value)
    } else {
      false
    }
  })
})

// 点击发起群聊（REQ-016 #195 F3：防重 + 群名 + 提速，流程体走共享 helper）
const creating = ref(false)
const groupName = ref('')

const createGroup = async () => {
  if (creating.value) return
  if (selectedList.value.length < 2) {
    window.$message.success('两个人无法建群哦')
    return
  }

  creating.value = true
  try {
    await createGroupFlow({
      uidList: selectedList.value,
      groupName: groupName.value,
      onOpenBatchConfig: (roomId, items) => {
        batchConfigRoomId.value = roomId
        batchConfigAccount.value = ''
        batchConfigAiclawItems.value = items
        batchConfigModalVisible.value = true
      },
      onSessionReady: (roomId) => {
        globalStore.updateCurrentSessionRoomId(roomId)
      }
    })

    resetCreateGroupState()
    window.$message.success('创建群聊成功')
  } catch (error) {
    console.error('[StartGroupChat] 创建群聊失败:', error)
    window.$message.error('创建群聊失败')
  } finally {
    creating.value = false
  }
}

const resetCreateGroupState = () => {
  selectedList.value = []
  groupName.value = ''
  keyword.value = ''
}
</script>

<style lang="scss" scoped></style>
