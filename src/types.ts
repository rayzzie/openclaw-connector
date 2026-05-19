export type RegisterRuntimeResponse = {
  agent_id: string;
  session_token: string;
  ttl_sec: number;
  registered_at: string;
};

export type HeartbeatResponse = {
  ok: boolean;
  next_heartbeat_in_sec: number;
};

export type AgentLoad = {
  active_sessions: number;
};
