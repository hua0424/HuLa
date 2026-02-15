import { defineStore } from 'pinia'
import { ref } from 'vue'
export const useUserStatusStore = defineStore('userStatus', () => {
  const status = ref('online')
  const stateList = ref([])
  const stateId = ref('')
  return { status, stateList, stateId }
})
