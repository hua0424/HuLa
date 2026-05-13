<template>
  <AutoFixHeightPage :show-footer="false">
    <template #header>
      <div class="bg-white" style="border-bottom: 1px solid; border-color: #dfdfdf">
        <HeaderBar
          :isOfficial="false"
          :hidden-right="true"
          :room-name="t('aiclaw.title')" />
      </div>
    </template>

    <template #container>
      <div class="bg-cover bg-center flex flex-col overflow-auto h-full">
        <div class="flex flex-col flex-1 gap-12px py-15px px-20px">
          <!-- AI 助理列表 -->
          <template v-if="aiclawList.length > 0">
            <div
              v-for="item in aiclawList"
              :key="item.uid"
              class="flex items-center gap-12px p-12px rounded-12px bg-white dark:bg-#1a1a1a shadow-sm">
              <n-avatar
                round :size="44" :src="item.avatar || '/logo.png'" fallback-src="/logo.png"
                class="cursor-pointer flex-shrink-0"
                @click="router.push(`/mobile/mobileMy/aiAssistant/${item.uid}`)" />
              <div
                class="flex flex-col flex-1 min-w-0 cursor-pointer"
                @click="router.push(`/mobile/mobileMy/aiAssistant/${item.uid}`)">
                <span class="text-15px font-500 truncate">{{ item.name }}</span>
                <!-- ISS-010 A1: 主状态读 activeStatus (实时在线), authStatus 通过右侧按钮区已表达, 这里只显示运行时在线 -->
                <span class="text-12px mt-2px" :class="onlineTextClass(item.activeStatus)">
                  {{ t(`aiclaw.status.${getOnlineKey(item.activeStatus)}`) }}
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
          <div v-else class="flex flex-col items-center justify-center flex-1 text-14px text-#999">
            <svg class="size-48px mb-12px opacity-30"><use href="#robot"></use></svg>
            <span>{{ t('aiclaw.empty') }}</span>
          </div>
        </div>

        <!-- 创建按钮 -->
        <div class="px-20px pb-20px">
          <n-button type="primary" block @click="showCreateForm = true" class="h-44px rounded-12px">
            + {{ t('aiclaw.create.title') }}
          </n-button>
        </div>
      </div>
    </template>
  </AutoFixHeightPage>

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
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AiclawCreateForm from '@/components/aiclaw/AiclawCreateForm.vue'
import AiclawTokenDialog from '@/components/aiclaw/AiclawTokenDialog.vue'
import AiclawDeleteConfirmDialog from '@/components/aiclaw/AiclawDeleteConfirmDialog.vue'
import { ImUrlEnum } from '@/enums'
import { imRequest } from '@/utils/ImRequestUtils'

const router = useRouter()

const { t } = useI18n()

type AiclawListItem = {
  uid: string
  name: string
  avatar: string
  description: string
  /** 激活生命周期: 0=未激活 / 1=已激活 / 2=已停用 */
  authStatus: number
  /** 运行时在线状态 (Redis ZSET, ISS-010 A1): OnlineEnum.ONLINE=1 / OFFLINE=2; 老后端无此字段时 undefined 按离线处理 */
  activeStatus?: number
  adapterType: string
  publicPersona: string | null
  createTime: number
}

const showCreateForm = ref(false)
const showTokenDialog = ref(false)
const showDeleteDialog = ref(false)
const createdToken = ref('')
const viewingUid = ref('')
const deletingUid = ref('')
const aiclawList = ref<AiclawListItem[]>([])

// ISS-010 A1: activeStatus → 实时在线; 右侧按钮区已用 aiclaw.token.* 表达 authStatus, 这里只保留在线状态文案
const getOnlineKey = (activeStatus?: number): 'online' | 'offline' =>
  activeStatus === 1 ? 'online' : 'offline'

const onlineTextClass = (activeStatus?: number) =>
  activeStatus === 1 ? 'text-#18a058' : 'text-#999'

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

<style lang="scss" scoped></style>
