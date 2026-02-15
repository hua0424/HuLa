import { defineStore } from 'pinia'
export const useScannerStore = defineStore('scanner', () => {
  const result = ref('')
  return { result }
})
