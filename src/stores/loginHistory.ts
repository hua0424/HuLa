import { defineStore } from 'pinia'
import { ref } from 'vue'
// 同时导出两个名字以防万一
export const useLoginHistoryStore = defineStore('loginHistory', () => {
  const history = ref<any[]>([])
  return { history }
})
export const useLoginHistoriesStore = useLoginHistoryStore
