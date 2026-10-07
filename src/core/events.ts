export type DomainEventType =
  | "workflow.transitioned"
  | "workflow.failed"
  | "qa.completed"
  | "publish.blocked"
  | "adapter.unavailable"
  | "budget.blocked";

export interface DomainEvent {
  type: DomainEventType;
  at: string;
  workflowId?: string;
  projectId?: string;
  payload?: Record<string, unknown>;
}

export class EventBus {
  private readonly listeners = new Map<DomainEventType, Array<(e: DomainEvent) => void>>();

  on(type: DomainEventType, listener: (e: DomainEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(event: Omit<DomainEvent, "at"> & { at?: string }): void {
    const full: DomainEvent = { ...event, at: event.at ?? new Date().toISOString() };
    for (const listener of this.listeners.get(full.type) ?? []) {
      listener(full);
    }
  }
}
