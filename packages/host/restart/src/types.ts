/** Result of one backend-restart request. */
export interface RestartAck {
  /** Whether the restart sequence was armed successfully. */
  ok: boolean
  /** Human-readable status or failure detail. */
  message: string
}
