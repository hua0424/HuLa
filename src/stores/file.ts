import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useFileStore = defineStore('file', () => {
  const fileList = ref<any[]>([])
  const addFile = () => {}
  const getRoomFilesForDisplay = () => []
  const scanLocalFiles = async () => {}
  const roomFilesMap = ref<any>({})
  
  return { 
    fileList, 
    addFile,
    getRoomFilesForDisplay,
    scanLocalFiles,
    roomFilesMap
  }
})
