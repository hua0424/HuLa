import { defineStore } from 'pinia'
import { info } from '@tauri-apps/plugin-log'
import { MsgEnum, MessageStatusEnum } from '@/enums'
import type { AiReplyChunk, AiStreamingMessage, AiApprovalRequest, AiErrorResponse } from '@/services/aiTypes'
import type { MessageType } from '@/services/types'
import { useChatStore } from '@/stores/chat'

export const useAiChatStore = defineStore('aiChat', () => {
  /** Active streaming messages keyed by streamId */
  const activeStreams = reactive<Record<string, AiStreamingMessage>>({})

  /** Pending approval requests for the owner */
  const pendingApprovals = ref<AiApprovalRequest[]>([])

  /** AI error messages to display */
  const lastError = ref<AiErrorResponse | null>(null)

  /** Whether an AI request is in-flight for a given roomId */
  const loadingRooms = reactive<Record<string, boolean>>({})

  /**
   * Handle an incoming AI reply chunk from WebSocket.
   * Accumulates content for the same streamId and updates the chat message.
   */
  const handleAiReplyChunk = (chunk: AiReplyChunk) => {
    const { streamId, requestId, seq, content, isFinal, timestamp } = chunk

    if (!activeStreams[streamId]) {
      activeStreams[streamId] = {
        requestId,
        streamId,
        roomId: '',
        accumulatedContent: '',
        isComplete: false,
        lastSeq: 0,
        startTime: timestamp,
        fromUserId: ''
      }
    }

    const stream = activeStreams[streamId]

    if (seq > stream.lastSeq) {
      stream.accumulatedContent += content
      stream.lastSeq = seq
    }

    if (isFinal) {
      stream.isComplete = true
      info(`[AI] Stream ${streamId} completed. Total content length: ${stream.accumulatedContent.length}`)
      finalizeStream(streamId)
    }

    updateStreamingMessageInChat(stream)
  }

  /**
   * Update or create the message in the chat store for this stream.
   * Uses a synthetic message ID based on streamId to avoid creating duplicate bubbles.
   */
  const updateStreamingMessageInChat = (stream: AiStreamingMessage) => {
    const chatStore = useChatStore()
    const syntheticMsgId = `ai_stream_${stream.streamId}`
    const roomId = stream.roomId

    if (!roomId) return

    const existingMsg = chatStore.messageMap[roomId]?.[syntheticMsgId]

    if (existingMsg) {
      existingMsg.message.body = {
        content: stream.accumulatedContent,
        reply: null,
        urlContentMap: {},
        aiStreaming: !stream.isComplete
      }
      if (stream.isComplete) {
        existingMsg.message.status = MessageStatusEnum.SUCCESS
        existingMsg.loading = false
      }
    } else {
      const msg: MessageType = {
        fromUser: {
          uid: stream.fromUserId,
          username: '',
          avatar: '',
          locPlace: ''
        },
        message: {
          id: syntheticMsgId,
          roomId: roomId,
          type: MsgEnum.TEXT,
          body: {
            content: stream.accumulatedContent,
            reply: null,
            urlContentMap: {},
            aiStreaming: !stream.isComplete
          },
          sendTime: stream.startTime,
          messageMarks: {},
          status: stream.isComplete ? MessageStatusEnum.SUCCESS : MessageStatusEnum.SENDING
        },
        sendTime: stream.startTime,
        loading: !stream.isComplete
      }

      if (!chatStore.messageMap[roomId]) {
        chatStore.messageMap[roomId] = {}
      }
      chatStore.messageMap[roomId][syntheticMsgId] = msg
    }
  }

  /**
   * Finalize a completed stream - clean up and ensure the message is properly stored.
   */
  const finalizeStream = (streamId: string) => {
    const stream = activeStreams[streamId]
    if (!stream) return

    if (stream.roomId) {
      setRoomLoading(stream.roomId, false)
    }

    setTimeout(() => {
      delete activeStreams[streamId]
    }, 5000)
  }

  /**
   * Set the room ID and sender for an active stream.
   * Called when we know the context of the stream from the request.
   */
  const setStreamContext = (streamId: string, roomId: string, fromUserId: string) => {
    if (activeStreams[streamId]) {
      activeStreams[streamId].roomId = roomId
      activeStreams[streamId].fromUserId = fromUserId
    }
  }

  /**
   * Initiate a request context before receiving stream chunks.
   * This pre-registers the stream so we can route chunks to the correct room.
   */
  const registerPendingRequest = (requestId: string, roomId: string) => {
    setRoomLoading(roomId, true)
    info(`[AI] Registered pending request ${requestId} for room ${roomId}`)
  }

  /** Mark room as loading/not-loading for AI response */
  const setRoomLoading = (roomId: string, loading: boolean) => {
    loadingRooms[roomId] = loading
  }

  /** Check if a room is waiting for AI response */
  const isRoomLoading = (roomId: string) => {
    return !!loadingRooms[roomId]
  }

  /** Add an approval request to the pending list */
  const addApprovalRequest = (request: AiApprovalRequest) => {
    pendingApprovals.value.push(request)
    info(`[AI] New approval request from ${request.requesterName}: ${request.originalText}`)
  }

  /** Remove an approval request after it's been handled */
  const removeApprovalRequest = (approvalId: string) => {
    pendingApprovals.value = pendingApprovals.value.filter((r) => r.approvalId !== approvalId)
  }

  /** Set the last error for display */
  const setError = (error: AiErrorResponse | null) => {
    lastError.value = error
  }

  /** Clear all state */
  const clearAll = () => {
    for (const key in activeStreams) {
      delete activeStreams[key]
    }
    pendingApprovals.value = []
    lastError.value = null
    for (const key in loadingRooms) {
      delete loadingRooms[key]
    }
  }

  return {
    activeStreams,
    pendingApprovals,
    lastError,
    loadingRooms,
    handleAiReplyChunk,
    setStreamContext,
    registerPendingRequest,
    setRoomLoading,
    isRoomLoading,
    addApprovalRequest,
    removeApprovalRequest,
    setError,
    clearAll
  }
})
