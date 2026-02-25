/**
 * AI Assistant type definitions
 * Types for AI node communication, streaming messages, and approval workflows
 */

/** AI request sent from client to server targeting an AI node */
export interface AiChatRequest {
  /** Target AI node user ID (BOT type user) */
  toUserId: string
  /** Message content */
  content: string
  /** Room/conversation ID */
  roomId: string
}

/** Streaming chunk received from AI node via WebSocket */
export interface AiReplyChunk {
  /** Original request message type marker */
  type: 'ai_reply_chunk'
  /** Correlation ID matching the original request */
  requestId: string
  /** Stream identifier - all chunks with the same streamId belong together */
  streamId: string
  /** Sequence number for ordering */
  seq: number
  /** Content fragment */
  content: string
  /** Whether this is the final chunk */
  isFinal: boolean
  /** Timestamp */
  timestamp: number
}

/** AI node info (from server) */
export interface AiNodeInfo {
  /** Node unique ID */
  nodeId: string
  /** Owner user ID */
  ownerId: string
  /** Owner display name */
  ownerName?: string
  /** Node mode */
  mode: 'public' | 'private'
  /** Online status */
  status: 'online' | 'offline'
  /** Node capabilities (JSON) */
  capabilities?: string
  /** Node version */
  version?: string
}

/** AI approval request notification (received by owner) */
export interface AiApprovalRequest {
  /** Approval request ID */
  approvalId: string
  /** Requesting user ID */
  requesterId: string
  /** Requesting user name */
  requesterName: string
  /** Target AI node ID */
  nodeId: string
  /** Original command text */
  originalText: string
  /** Timestamp */
  timestamp: number
}

/** AI approval decision (sent by owner) */
export interface AiApprovalDecision {
  /** Approval request ID */
  approvalId: string
  /** Decision: approve, modify, reject */
  decision: 'approve' | 'modify' | 'reject'
  /** Modified text (when decision is 'modify') */
  finalText?: string
}

/** AI approval result notification */
export interface AiApprovalResult {
  type: 'ai_approval_result'
  approvalId: string
  requestId: string
  decision: 'approve' | 'modify' | 'reject' | 'timeout'
  message?: string
}

/** AI error response */
export interface AiErrorResponse {
  type: 'ai_error'
  requestId?: string
  code: string
  message: string
  httpStatus: number
}

/** AI error codes as defined in the requirements */
export enum AiErrorCode {
  AUTH_INVALID_TOKEN = 'AI_AUTH_INVALID_TOKEN',
  AUTH_TOKEN_EXPIRED = 'AI_AUTH_TOKEN_EXPIRED',
  AUTH_CLAIM_MISMATCH = 'AI_AUTH_CLAIM_MISMATCH',
  TARGET_NOT_AI = 'AI_TARGET_NOT_AI',
  NODE_NOT_FOUND = 'AI_NODE_NOT_FOUND',
  NODE_OFFLINE = 'AI_NODE_OFFLINE',
  PERMISSION_DENIED = 'AI_PERMISSION_DENIED',
  APPROVAL_REQUIRED = 'AI_APPROVAL_REQUIRED',
  APPROVAL_REJECTED = 'AI_APPROVAL_REJECTED',
  APPROVAL_TIMEOUT = 'AI_APPROVAL_TIMEOUT',
  PROTOCOL_INVALID = 'AI_PROTOCOL_INVALID',
  RATE_LIMITED = 'AI_RATE_LIMITED',
  INTERNAL_ERROR = 'AI_INTERNAL_ERROR'
}

/** Human-readable AI error messages */
export const AiErrorMessages: Record<string, string> = {
  [AiErrorCode.AUTH_INVALID_TOKEN]: 'AI authentication token is invalid',
  [AiErrorCode.AUTH_TOKEN_EXPIRED]: 'AI authentication token has expired',
  [AiErrorCode.AUTH_CLAIM_MISMATCH]: 'AI node identity verification failed',
  [AiErrorCode.TARGET_NOT_AI]: 'The target user is not an AI assistant',
  [AiErrorCode.NODE_NOT_FOUND]: 'AI node not found',
  [AiErrorCode.NODE_OFFLINE]: 'AI assistant is currently offline',
  [AiErrorCode.PERMISSION_DENIED]: 'You do not have permission to access this AI assistant',
  [AiErrorCode.APPROVAL_REQUIRED]: 'Your request requires approval from the AI owner',
  [AiErrorCode.APPROVAL_REJECTED]: 'Your request was rejected by the AI owner',
  [AiErrorCode.APPROVAL_TIMEOUT]: 'Approval request timed out',
  [AiErrorCode.PROTOCOL_INVALID]: 'Invalid AI protocol message',
  [AiErrorCode.RATE_LIMITED]: 'Request rate limit exceeded, please try again later',
  [AiErrorCode.INTERNAL_ERROR]: 'AI service internal error'
}

/** A single streaming message being accumulated in the UI */
export interface AiStreamingMessage {
  /** The request ID this stream belongs to */
  requestId: string
  /** The stream ID */
  streamId: string
  /** Room ID */
  roomId: string
  /** Accumulated content so far */
  accumulatedContent: string
  /** Whether the stream is complete */
  isComplete: boolean
  /** Last sequence number received */
  lastSeq: number
  /** Timestamp of the first chunk */
  startTime: number
  /** Sender info (the AI bot) */
  fromUserId: string
}
