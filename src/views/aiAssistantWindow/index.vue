<template>
  <div class="flex flex-col h-full bg-[--right-bg-color]">
    <!-- 标题栏 -->
    <div class="flex items-center justify-between px-20px py-14px border-b border-[--line-color] select-none">
      <span class="text-16px font-600 text-[--text-color]">{{ t('aiclaw.title') }}</span>
      <n-button type="primary" size="small" @click="showCreateForm = true">
        + {{ t('aiclaw.create.submit') }}
      </n-button>
    </div>

    <!-- AI 助理列表 -->
    <div class="flex-1 overflow-auto p-16px">
      <template v-if="aiclawList.length > 0">
        <div
          v-for="item in aiclawList"
          :key="item.uid"
          class="flex items-center gap-12px p-12px mb-8px rounded-8px hover:bg-[--list-hover-color] cursor-pointer transition-colors">
          <n-avatar round :size="40" :src="item.avatar || '/logo.png'" fallback-src="/logo.png" />
          <div class="flex flex-col flex-1 min-w-0">
            <span class="text-14px font-500 text-[--text-color] truncate">{{ item.name }}</span>
            <span class="text-12px text-#999 mt-2px">
              {{ t(`aiclaw.status.${authStatusMap[item.authStatus] || 'inactive'}`) }}
            </span>
          </div>
          <div class="flex items-center gap-6px">
            <!-- 未激活：查看激活码按钮 -->
            <n-button
              v-if="item.authStatus === 0"
              size="tiny"
              type="primary"
              secondary
              @click="handleViewToken(item.uid)">
              {{ t('aiclaw.token.view') }}
            </n-button>
            <!-- 已激活：标签 -->
            <span v-else-if="item.authStatus === 1" class="text-#18a058 text-11px font-500 px-6px py-2px rounded-4px bg-#18a05815">
              {{ t('aiclaw.token.activated') }}
            </span>
            <!-- 已停用：标签 -->
            <span v-else-if="item.authStatus === 2" class="text-#d03050 text-11px font-500 px-6px py-2px rounded-4px bg-#d0305015">
              {{ t('aiclaw.token.deactivated') }}
            </span>
            <!-- 删除按钮 -->
            <n-button
              size="tiny"
              type="error"
              quaternary
              @click="handleDelete(item)">
              {{ t('aiclaw.delete.title') }}
            </n-button>
          </div>
        </div>
      </template>

      <!-- 空状态 -->
      <div v-else class="flex flex-col items-center justify-center h-full text-14px text-#999">
        <svg class="size-64px mb-16px opacity-20"><use href="#robot"></use></svg>
        <span>{{ t('aiclaw.empty') }}</span>
      </div>
    </div>

    <!-- 创建表单弹窗 -->
    <AiclawCreateForm v-model:visible="showCreateForm" @created="onCreated" />

    <!-- Token 展示弹窗 -->
    <AiclawTokenDialog
      v-model:visible="showTokenDialog"
      :token="createdToken"
      :uid="viewingUid"
      @refreshed="fetchList" />

    <!-- 删除确认弹窗 -->
    <AiclawDeleteConfirmDialog
      v-model:visible="showDeleteDialog"
      @confirm="handleDeleteConfirm" />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AiclawCreateForm from '@/components/aiclaw/AiclawCreateForm.vue'
import AiclawTokenDialog from '@/components/aiclaw/AiclawTokenDialog.vue'
import AiclawDeleteConfirmDialog from '@/components/aiclaw/AiclawDeleteConfirmDialog.vue'
import { ImUrlEnum } from '@/enums'
import { imRequest } from '@/utils/ImRequestUtils'

const { t } = useI18n()

type AiclawListItem = {
  uid: string
  name: string
  avatar: string
  description: string
  authStatus: number
  adapterType: string
  createTime: number
}

const showCreateForm = ref(false)
const showTokenDialog = ref(false)
const showDeleteDialog = ref(false)
const createdToken = ref('')
const viewingUid = ref('')
const deletingUid = ref('')
const aiclawList = ref<AiclawListItem[]>([])

const authStatusMap: Record<number, 'inactive' | 'online' | 'offline'> = {
  0: 'inactive',
  1: 'online',
  2: 'offline'
}

const fetchList = async () => {
  try {
    const list = await imRequest<AiclawListItem[]>({ url: ImUrlEnum.AICLAW_LIST })
    aiclawList.value = list || []
  } catch (error) {
    console.error('[AiAssistant] 获取列表失败:', error)
  }
}

const onCreated = (data: { uid: string; activationToken: string }) => {
  createdToken.value = data.activationToken
  viewingUid.value = ''
  showTokenDialog.value = true
  fetchList()
}

const handleViewToken = (uid: string) => {
  createdToken.value = ''
  viewingUid.value = uid
  showTokenDialog.value = true
}

const handleDelete = (item: AiclawListItem) => {
  deletingUid.value = item.uid
  showDeleteDialog.value = true
}

const handleDeleteConfirm = async (password: string) => {
  try {
    await imRequest({
      url: ImUrlEnum.AICLAW_DEACTIVATE,
      params: { uid: deletingUid.value },
      body: { password }
    })
    window.$message?.success?.('已停用')
    showDeleteDialog.value = false
    fetchList()
  } catch (error) {
    console.error('[AiAssistant] 停用失败:', error)
  }
}

onMounted(() => {
  fetchList()
})
</script>
