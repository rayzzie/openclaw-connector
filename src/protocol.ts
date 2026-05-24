export type AckMode = "none" | "required";

export type AckPolicy = {
  mode: AckMode;
  deadline_ms?: number;
};

export type EnvelopeBase = {
  protocol_version: string;
  type: string;
  message_id: string;
  timestamp: string;
  trace_id?: string;
  connection_id?: string;
  agent_id?: string;
  session_id?: string;
  turn_id?: string;
  request_id?: string;
  response_id?: string;
  sequence?: number;
  ack?: AckPolicy;
  in_reply_to?: string;
  payload?: Record<string, unknown>;
};

export type ChannelInfo = {
  type?: string;
  name?: string;
  external_session_id?: string;
  phone_number?: string;
};

export type ConnectionAccepted = EnvelopeBase & {
  type: "connection.accepted";
  connection_id: string;
  agent_id: string;
  payload: {
    heartbeat_interval_sec: number;
    ack_deadline_ms?: number;
    ack_max_retries?: number;
    message_types?: string[];
  };
};

export type ConnectionRejected = EnvelopeBase & {
  type: "connection.rejected";
  payload: {
    error?: {
      code?: string;
      message?: string;
    };
  };
};

export type ConnectionReplaced = EnvelopeBase & {
  type: "connection.replaced";
  connection_id: string;
  agent_id: string;
  payload: {
    reason?: string;
  };
};

export type AckMessage = EnvelopeBase & {
  type: "ack";
  in_reply_to: string;
};

export type HeartbeatMessage = EnvelopeBase & {
  type: "ws.heartbeat";
  connection_id: string;
  agent_id: string;
};

export type AgentRequest = EnvelopeBase & {
  type: "agent.request";
  agent_id: string;
  session_id: string;
  turn_id: string;
  request_id: string;
  trace_id: string;
  channel?: ChannelInfo;
  delivery_profile?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  payload: Record<string, unknown>;
};

export type AgentEvent = EnvelopeBase & {
  type: "agent.event";
  agent_id: string;
  session_id: string;
  turn_id: string;
  request_id: string;
  response_id: string;
  trace_id: string;
  sequence: number;
  payload: Record<string, unknown>;
};

export type AgentResponse = EnvelopeBase & {
  type: "agent.response";
  agent_id: string;
  session_id: string;
  turn_id: string;
  request_id: string;
  response_id: string;
  trace_id: string;
  payload: Record<string, unknown>;
};

export type AgentInterrupt = EnvelopeBase & {
  type: "agent.interrupt";
  agent_id: string;
  session_id: string;
  turn_id: string;
  request_id: string;
  trace_id: string;
  payload: Record<string, unknown>;
};

export type AgentError = EnvelopeBase & {
  type: "agent.error";
  payload: {
    error?: {
      code?: string;
      message?: string;
    };
  };
};

export type VisualSurfaceSelectPayload = {
  type: "visual.surface.select";
  surface: string;
  reason?: string;
};

export type VisualFramePayload = {
  type: "visual.frame";
  surface: string;
  mime_type: string;
  data_base64: string;
  ttl_ms?: number;
  media_session_id?: string;
  tracks?: Record<string, unknown>[];
};

export type VisualAssetPayload = {
  type: "visual.asset";
  asset_type: "image" | "video" | string;
  mime_type: string;
  display: "replace_surface" | "overlay" | string;
  ttl_ms?: number;
  url?: string;
  data_base64?: string;
  media_session_id?: string;
  tracks?: Record<string, unknown>[];
};

export type VisualEventPayload = VisualSurfaceSelectPayload | VisualFramePayload | VisualAssetPayload;

export type Envelope =
  | ConnectionAccepted
  | ConnectionRejected
  | ConnectionReplaced
  | AckMessage
  | HeartbeatMessage
  | AgentRequest
  | AgentEvent
  | AgentResponse
  | AgentInterrupt
  | AgentError
  | EnvelopeBase;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateEnvelope(value: unknown): ValidationResult<Envelope> {
  if (!isRecord(value)) {
    return fail("envelope must be an object");
  }
  const required = requiredStringFields(value, ["protocol_version", "type", "message_id", "timestamp"]);
  if (!required.ok) {
    return required;
  }
  if ("payload" in value && !isRecord(value.payload)) {
    return fail("payload must be an object when present");
  }
  if ("sequence" in value && (!Number.isInteger(value.sequence) || Number(value.sequence) < 1)) {
    return fail("sequence must be a positive integer when present");
  }
  return { ok: true, value: value as Envelope };
}

export function validateConnectionAccepted(value: unknown): ValidationResult<ConnectionAccepted> {
  const envelope = validateTypedEnvelope(value, "connection.accepted");
  if (!envelope.ok) {
    return envelope;
  }
  const required = requiredStringFields(envelope.value, ["connection_id", "agent_id"]);
  if (!required.ok) {
    return required;
  }
  if (!isRecord(envelope.value.payload) || typeof envelope.value.payload.heartbeat_interval_sec !== "number") {
    return fail("connection.accepted payload.heartbeat_interval_sec is required");
  }
  return { ok: true, value: envelope.value as ConnectionAccepted };
}

export function validateConnectionRejected(value: unknown): ValidationResult<ConnectionRejected> {
  const envelope = validateTypedEnvelope(value, "connection.rejected");
  if (!envelope.ok) {
    return envelope;
  }
  return { ok: true, value: envelope.value as ConnectionRejected };
}

export function validateConnectionReplaced(value: unknown): ValidationResult<ConnectionReplaced> {
  const envelope = validateTypedEnvelope(value, "connection.replaced");
  if (!envelope.ok) {
    return envelope;
  }
  const required = requiredStringFields(envelope.value, ["connection_id", "agent_id"]);
  if (!required.ok) {
    return required;
  }
  return { ok: true, value: envelope.value as ConnectionReplaced };
}

export function validateAckMessage(value: unknown): ValidationResult<AckMessage> {
  const envelope = validateTypedEnvelope(value, "ack");
  if (!envelope.ok) {
    return envelope;
  }
  const required = requiredStringFields(envelope.value, ["in_reply_to"]);
  if (!required.ok) {
    return required;
  }
  return { ok: true, value: envelope.value as AckMessage };
}

export function validateHeartbeatMessage(value: unknown): ValidationResult<HeartbeatMessage> {
  const envelope = validateTypedEnvelope(value, "ws.heartbeat");
  if (!envelope.ok) {
    return envelope;
  }
  const required = requiredStringFields(envelope.value, ["connection_id", "agent_id"]);
  if (!required.ok) {
    return required;
  }
  return { ok: true, value: envelope.value as HeartbeatMessage };
}

export function validateVisualEventPayload(value: unknown): ValidationResult<VisualEventPayload> {
  if (!isRecord(value)) {
    return fail("visual payload must be an object");
  }
  if (value.type === "visual.surface.select") {
    const required = requiredStringFields(value, ["surface"]);
    if (!required.ok) {
      return required;
    }
    return { ok: true, value: value as VisualSurfaceSelectPayload };
  }
  if (value.type === "visual.frame") {
    const required = requiredStringFields(value, ["surface", "mime_type", "data_base64"]);
    if (!required.ok) {
      return required;
    }
    if ("ttl_ms" in value && (!Number.isInteger(value.ttl_ms) || Number(value.ttl_ms) <= 0)) {
      return fail("ttl_ms must be a positive integer when present");
    }
    return { ok: true, value: value as VisualFramePayload };
  }
  if (value.type === "visual.asset") {
    const required = requiredStringFields(value, ["asset_type", "mime_type", "display"]);
    if (!required.ok) {
      return required;
    }
    if (typeof value.url !== "string" && typeof value.data_base64 !== "string") {
      return fail("visual.asset requires url or data_base64");
    }
    if ("ttl_ms" in value && (!Number.isInteger(value.ttl_ms) || Number(value.ttl_ms) <= 0)) {
      return fail("ttl_ms must be a positive integer when present");
    }
    return { ok: true, value: value as VisualAssetPayload };
  }
  return fail("unsupported visual payload type");
}

export function validateAgentRequest(value: unknown): ValidationResult<AgentRequest> {
  return validateBusinessEnvelope<AgentRequest>(value, "agent.request", ["agent_id", "session_id", "turn_id", "request_id", "trace_id"]);
}

export function validateAgentEvent(value: unknown): ValidationResult<AgentEvent> {
  const result = validateBusinessEnvelope<AgentEvent>(value, "agent.event", [
    "agent_id",
    "session_id",
    "turn_id",
    "request_id",
    "response_id",
    "trace_id"
  ]);
  if (!result.ok) {
    return result;
  }
  if (!Number.isInteger(result.value.sequence) || Number(result.value.sequence) < 1) {
    return fail("agent.event sequence is required");
  }
  return result;
}

export function validateAgentResponse(value: unknown): ValidationResult<AgentResponse> {
  return validateBusinessEnvelope<AgentResponse>(value, "agent.response", [
    "agent_id",
    "session_id",
    "turn_id",
    "request_id",
    "response_id",
    "trace_id"
  ]);
}

export function validateAgentInterrupt(value: unknown): ValidationResult<AgentInterrupt> {
  return validateBusinessEnvelope<AgentInterrupt>(value, "agent.interrupt", [
    "agent_id",
    "session_id",
    "turn_id",
    "request_id",
    "trace_id"
  ]);
}

function validateBusinessEnvelope<T extends Envelope>(value: unknown, type: string, fields: string[]): ValidationResult<T> {
  const envelope = validateTypedEnvelope(value, type);
  if (!envelope.ok) {
    return envelope;
  }
  const required = requiredStringFields(envelope.value, fields);
  if (!required.ok) {
    return required;
  }
  if (!isRecord(envelope.value.payload)) {
    return fail(`${type} payload is required`);
  }
  return { ok: true, value: envelope.value as T };
}

function validateTypedEnvelope(value: unknown, type: string): ValidationResult<Envelope> {
  const envelope = validateEnvelope(value);
  if (!envelope.ok) {
    return envelope;
  }
  if (envelope.value.type !== type) {
    return fail(`expected type ${type}`);
  }
  return envelope;
}

function requiredStringFields(value: Record<string, unknown>, fields: string[]): ValidationResult<never> | { ok: true } {
  for (const field of fields) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      return fail(`${field} is required`);
    }
  }
  return { ok: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(error: string): ValidationResult<never> {
  return { ok: false, error };
}
