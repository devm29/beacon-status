import type { EventPublisher, MaintenanceDoc, MaintenanceRepository, OrgDoc } from "@beacon/core";
import { MaintenanceInputSchema, type MaintenanceDto } from "@beacon/shared";
import { idParam } from "../http/params.js";
import { notFound } from "../http/errors.js";

export function maintenanceState(
  window: Pick<MaintenanceDoc, "startsAt" | "endsAt">,
  now: Date,
): MaintenanceDto["state"] {
  if (window.startsAt.getTime() > now.getTime()) return "scheduled";
  if (window.endsAt.getTime() <= now.getTime()) return "completed";
  return "active";
}

export function toMaintenanceDto(window: MaintenanceDoc, now: Date): MaintenanceDto {
  return {
    id: window._id.toHexString(),
    title: window.title,
    description: window.description,
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
    monitors: window.monitors,
    state: maintenanceState(window, now),
  };
}

export class MaintenanceService {
  constructor(private readonly deps: { maintenance: MaintenanceRepository; events: EventPublisher }) {}

  async list(org: OrgDoc, now = new Date()): Promise<MaintenanceDto[]> {
    const windows = await this.deps.maintenance.listRelevant(org._id, now, 30);
    return windows.map((w) => toMaintenanceDto(w, now));
  }

  async create(org: OrgDoc, input: unknown): Promise<MaintenanceDto> {
    const parsed = MaintenanceInputSchema.parse(input);
    const created = await this.deps.maintenance.create(org._id, {
      title: parsed.title,
      description: parsed.description,
      startsAt: new Date(parsed.startsAt),
      endsAt: new Date(parsed.endsAt),
      monitors: parsed.monitors,
    });
    await this.changed(org);
    return toMaintenanceDto(created, new Date());
  }

  async delete(org: OrgDoc, id: string): Promise<void> {
    const deleted = await this.deps.maintenance.delete(org._id, idParam(id, "Maintenance window"));
    if (!deleted) throw notFound("Maintenance window");
    await this.changed(org);
  }

  private async changed(org: OrgDoc): Promise<void> {
    await this.deps.events.publish({
      type: "statuspage.changed",
      orgId: org._id.toHexString(),
      reason: "maintenance",
      at: new Date().toISOString(),
    });
  }
}
