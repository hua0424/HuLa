<template>
  <AutoFixHeightPage :show-footer="false">
    <template #header>
      <div class="bg-white" style="border-bottom: 1px solid; border-color: #dfdfdf">
        <HeaderBar
          :isOfficial="false"
          :hidden-right="true"
          :room-name="t('aiclaw.friends.title')" />
      </div>
    </template>

    <template #container>
      <div class="flex flex-col overflow-auto h-full">
        <!-- 好友列表 -->
        <template v-if="friends.length > 0">
          <div
            v-for="item in friends"
            :key="item.uid"
            class="flex items-center gap-12px px-20px py-14px border-b border-#f0f0f0">
            <n-avatar round :size="44" :src="item.avatar || '/logo.png'" fallback-src="/logo.png" />
            <div class="flex flex-col flex-1 min-w-0">
              <span class="text-15px font-500 truncate">{{ item.name }}</span>
              <span v-if="item.relationDesc" class="text-12px text-#999 mt-2px truncate">
                {{ item.relationDesc }}
              </span>
              <span v-else class="text-12px text-#ccc mt-2px italic">
                {{ t('aiclaw.friends.relation') }}：未设置
              </span>
            </div>
            <div class="flex items-center gap-6px flex-shrink-0">
              <n-button size="tiny" secondary @click="handleEditRelation(item)">
                {{ t('aiclaw.friends.relation_edit') }}
              </n-button>
              <n-button size="tiny" type="error" quaternary @click="handleRemove(item)">
                {{ t('aiclaw.friends.remove') }}
              </n-button>
            </div>
          </div>
        </template>

        <!-- 空状态 -->
        <div v-else-if="!loading" class="flex flex-col items-center justify-center flex-1 text-14px text-#999">
          <svg class="size-48px mb-12px opacity-30"><use href="#robot"></use></svg>
          <span>{{ t('aiclaw.friends.empty') }}</span>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading" class="flex justify-center py-20px">
          <n-spin size="medium" />
        </div>
      </div>
    </template>
  </AutoFixHeightPage>

  <!-- 编辑关系说明 Dialog -->
  <n-modal v-model:show="showRelationDialog" preset="dialog" :show-icon="false" :closable="true" :mask-closable="false">
    <template #header>
      <span class="text-16px font-600">{{ t('aiclaw.friends.relation_edit') }}</span>
    </template>
    <div class="py-8px">
      <n-input
        v-model:value="relationInput"
        type="textarea"
        :placeholder="t('aiclaw.friends.relation_placeholder')"
        :maxlength="200"
        :autosize="{ minRows: 2, maxRows: 5 }"
        show-count />
    </div>
    <template #action>
      <n-button @click="showRelationDialog = false">{{ t('aiclaw.delete.cancel') }}</n-button>
      <n-button type="primary" :loading="savingRelation" @click="handleSaveRelation">
        {{ t('aiclaw.detail.persona_save') }}
      </n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { ImUrlEnum } from '@/enums'
import { imRequest } from '@/utils/ImRequestUtils'

const { t } = useI18n()
const route = useRoute()

const uid = route.params.uid as string

type AiclawFriendItem = {
  uid: string
  name: string
  avatar: string
  account: string
  activeStatus: number
  userType: number
  relationDesc: string | null
}

const friends = ref<AiclawFriendItem[]>([])
const loading = ref(false)

// 编辑关系说明
const showRelationDialog = ref(false)
const relationInput = ref('')
const savingRelation = ref(false)
const editingFriendUid = ref('')

const fetchFriends = async () => {
  loading.value = true
  try {
    const result = await imRequest<AiclawFriendItem[]>({
      url: ImUrlEnum.AICLAW_FRIENDS,
      params: { uid }
    })
    friends.value = result || []
  } catch (error) {
    console.error('[AiclawFriends] 获取好友列表失败:', error)
  } finally {
    loading.value = false
  }
}

const handleEditRelation = (item: AiclawFriendItem) => {
  editingFriendUid.value = item.uid
  relationInput.value = item.relationDesc || ''
  showRelationDialog.value = true
}

const handleSaveRelation = async () => {
  savingRelation.value = true
  try {
    await imRequest({
      url: ImUrlEnum.AICLAW_SET_RELATION,
      params: { uid, friendUid: editingFriendUid.value },
      body: { relationDesc: relationInput.value }
    })
    // 更新本地数据
    const friend = friends.value.find((f) => f.uid === editingFriendUid.value)
    if (friend) {
      friend.relationDesc = relationInput.value || null
    }
    showRelationDialog.value = false
    window.$message?.success?.(t('aiclaw.friends.relation_save_success'))
  } catch (error) {
    console.error('[AiclawFriends] 保存关系说明失败:', error)
  } finally {
    savingRelation.value = false
  }
}

const handleRemove = (item: AiclawFriendItem) => {
  window.$dialog?.warning({
    title: t('aiclaw.friends.remove'),
    content: t('aiclaw.friends.remove_confirm'),
    positiveText: t('aiclaw.delete.confirm'),
    negativeText: t('aiclaw.delete.cancel'),
    onPositiveClick: async () => {
      try {
        await imRequest({
          url: ImUrlEnum.AICLAW_REMOVE_FRIEND,
          params: { uid, friendUid: item.uid }
        })
        friends.value = friends.value.filter((f) => f.uid !== item.uid)
        window.$message?.success?.(t('aiclaw.friends.remove_success'))
      } catch (error) {
        console.error('[AiclawFriends] 移除好友失败:', error)
      }
    }
  })
}

onMounted(() => {
  fetchFriends()
})
</script>
