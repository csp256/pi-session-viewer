import type { CapturedToolDefinition, PreparedSessionDelta, PreparedSessionView, SessionView, TimelineEvent } from './types'

function orderPatch(previous: string[], next: string[]): string[] | undefined {
  const ids = new Set(next)
  const old = new Set(previous)
  const appended = [...previous.filter((id) => ids.has(id)), ...next.filter((id) => !old.has(id))]
  return appended.length === next.length && appended.every((id, index) => id === next[index]) ? undefined : next
}

/** 只传输变化的事件和轮次尾部；正常追加不重复发送事件顺序或完整轮次。 */
export function diffPreparedSessions(previous: PreparedSessionView, next: PreparedSessionView, modifiedAt: string): PreparedSessionDelta {
  const oldEvents = new Map(previous.events.map((event) => [event.id, event]))
  const newEvents = new Set(next.events.map((event) => event.id))
  const oldTurns = new Map(previous.turns.map((turn) => [turn.id, turn]))
  const newTurns = new Set(next.turns.map((turn) => turn.id))
  const turns: PreparedSessionDelta['turns'] = []
  for (const turn of next.turns) {
    const old = oldTurns.get(turn.id)
    if (old && JSON.stringify(old) === JSON.stringify(turn)) continue
    const { eventIds, ...metadata } = turn
    const prefix = old && old.eventIds.length <= eventIds.length && old.eventIds.every((id, index) => eventIds[index] === id)
    turns.push(prefix ? { ...metadata, appendEventIds: eventIds.slice(old.eventIds.length) } : turn)
  }
  return {
    parsed: next.parsed, leafId: next.leafId, modifiedAt, stats: next.stats,
    ...(JSON.stringify(previous.definitions) === JSON.stringify(next.definitions) ? {} : { definitions: next.definitions }),
    events: next.events.filter((event) => JSON.stringify(oldEvents.get(event.id)) !== JSON.stringify(event)),
    removedEventIds: previous.events.filter((event) => !newEvents.has(event.id)).map((event) => event.id),
    eventOrder: orderPatch(previous.events.map((event) => event.id), next.events.map((event) => event.id)),
    turns, removedTurnIds: previous.turns.filter((turn) => !newTurns.has(turn.id)).map((turn) => turn.id),
    turnOrder: orderPatch(previous.turns.map((turn) => turn.id), next.turns.map((turn) => turn.id)),
  }
}

export function hydrateEvents(events: TimelineEvent[], definitions: CapturedToolDefinition[]): TimelineEvent[] {
  return events.map((event) => ({ ...event,
    ...(event.toolDefinitionRef !== undefined ? { toolDefinition: definitions[event.toolDefinitionRef] } : {}) }))
}

export function applyPreparedDelta(view: SessionView, delta: PreparedSessionDelta, definitions: CapturedToolDefinition[]): SessionView {
  const events = new Map(view.events.map((event) => [event.id, event]))
  for (const id of delta.removedEventIds) events.delete(id)
  for (const event of hydrateEvents(delta.events, definitions)) events.set(event.id, event)
  if (delta.definitions) for (const [id, event] of events) if (event.toolDefinitionRef !== undefined) {
    events.set(id, { ...event, toolDefinition: definitions[event.toolDefinitionRef] })
  }
  const ordered = delta.eventOrder ? delta.eventOrder.map((id) => events.get(id)!) : [...events.values()]
  const turns = new Map(view.turns.map(({ events: turnEvents, ...turn }) => [turn.id, { ...turn, eventIds: turnEvents.map((event) => event.id) }]))
  for (const id of delta.removedTurnIds) turns.delete(id)
  for (const { appendEventIds, eventIds, ...turn } of delta.turns) {
    turns.set(turn.id, { ...turn, eventIds: eventIds ?? [...(turns.get(turn.id)?.eventIds ?? []), ...(appendEventIds ?? [])] })
  }
  const turnIds = delta.turnOrder ?? [...turns.keys()]
  return { branchEntries: [], events: ordered, stats: delta.stats,
    turns: turnIds.map((id) => { const { eventIds, ...turn } = turns.get(id)!; return { ...turn, events: eventIds.map((eventId) => events.get(eventId)!) } }) }
}
