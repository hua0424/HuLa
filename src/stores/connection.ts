import { defineStore } from "pinia"
import { ref, computed } from "vue"
import { OpenClawConnection } from "@/services/openclaw/connection"
import { AgentStreamHandler } from "@/services/openclaw/agent"
import { ConnectionState } from "@/services/openclaw/types"

export const useConnectionStore = defineStore("connection", () => {
  const connection = new OpenClawConnection()
  const agentHandler = new AgentStreamHandler(connection)
  
  const state = ref<ConnectionState>(ConnectionState.DISCONNECTED)
  const serverInfo = ref<any>(null)
  const error = ref<string | null>(null)
  
  // 监听状态变化
  connection.events.on("stateChanged", (newState: any) => {
    state.value = newState
  })
  
  const isConnected = computed(() => state.value === ConnectionState.CONNECTED)
  
  async function connect(config: {
    gatewayUrl: string
    gatewayToken?: string
    deviceToken?: string
    device?: { id: string; publicKey: string; privateKey: string }
  }) {
    error.value = null
    try {
      await connection.connect(config)
      serverInfo.value = connection.getServerInfo()
    } catch (e: any) {
      error.value = e.message
      throw e
    }
  }
  
  function disconnect() {
    connection.disconnect()
  }
  
  async function sendMessage(message: string, sessionKey?: string) {
    return agentHandler.sendMessage({
      message,
      sessionKey,
      idempotencyKey: crypto.randomUUID()
    })
  }
  
  function getAgentHandler() {
    return agentHandler
  }
  
  function onAgentEvent(handler: (event: any) => void) {
    connection.events.on("agent", handler)
    return () => connection.events.off("agent", handler)
  }
  
  return {
    state,
    serverInfo,
    error,
    isConnected,
    connect,
    disconnect,
    sendMessage,
    getAgentHandler,
    onAgentEvent,
    connection
  }
})
