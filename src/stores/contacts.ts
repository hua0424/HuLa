import { defineStore } from 'pinia'

export const useContactStore = defineStore('contacts', () => {
  const list = ref<any[]>([])
  const applyList = ref<any[]>([])
  const getContactList = async () => []
  const getApplyPage = async () => ({ list: [] })

  return { list, applyList, getContactList, getApplyPage }
})
