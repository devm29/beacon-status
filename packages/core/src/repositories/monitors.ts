import {
  initialMonitorState,
  parseMonitorState,
  type MonitorSpec,
  type MonitorState,
  type Transition,
} from "@beacon/shared";
import { Types } from "mongoose";
import { MonitorModel, type ManagedBy, type MonitorDoc } from "../models/index.js";

/** `state` is a schemaless subdocument, so it is validated (and back-filled) on every read. */
function hydrate(doc: MonitorDoc): MonitorDoc {
  return { ...doc, state: parseMonitorState(doc.state) };
}

const hydrateAll = (docs: MonitorDoc[]) => docs.map(hydrate);
const hydrateOne = (doc: MonitorDoc | null) => (doc ? hydrate(doc) : null);

export function toObjectId(id: string): Types.ObjectId | null {
  return Types.ObjectId.isValid(id) && /^[a-f0-9]{24}$/i.test(id) ? new Types.ObjectId(id) : null;
}

export class MonitorRepository {
  async list(orgId: Types.ObjectId): Promise<MonitorDoc[]> {
    return hydrateAll(
      await MonitorModel.find({ orgId }).sort({ group: 1, name: 1 }).lean<MonitorDoc[]>().exec(),
    );
  }

  async listActive(): Promise<MonitorDoc[]> {
    return hydrateAll(await MonitorModel.find({ paused: false }).lean<MonitorDoc[]>().exec());
  }

  async listAll(): Promise<MonitorDoc[]> {
    return hydrateAll(await MonitorModel.find().lean<MonitorDoc[]>().exec());
  }

  async findById(id: Types.ObjectId): Promise<MonitorDoc | null> {
    return hydrateOne(await MonitorModel.findById(id).lean<MonitorDoc>().exec());
  }

  async findInOrg(orgId: Types.ObjectId, id: string): Promise<MonitorDoc | null> {
    const objectId = toObjectId(id);
    if (!objectId) return null;
    return hydrateOne(await MonitorModel.findOne({ _id: objectId, orgId }).lean<MonitorDoc>().exec());
  }

  async findByKeys(orgId: Types.ObjectId, keys: string[]): Promise<MonitorDoc[]> {
    return hydrateAll(
      await MonitorModel.find({ orgId, key: { $in: keys } })
        .lean<MonitorDoc[]>()
        .exec(),
    );
  }

  async findByIds(ids: Types.ObjectId[]): Promise<MonitorDoc[]> {
    return hydrateAll(
      await MonitorModel.find({ _id: { $in: ids } })
        .lean<MonitorDoc[]>()
        .exec(),
    );
  }

  async create(orgId: Types.ObjectId, spec: MonitorSpec, managedBy: ManagedBy): Promise<MonitorDoc> {
    const created = await MonitorModel.create({ ...spec, orgId, managedBy, state: initialMonitorState() });
    return hydrate(created.toObject<MonitorDoc>());
  }

  async replace(
    orgId: Types.ObjectId,
    id: Types.ObjectId,
    spec: MonitorSpec,
    managedBy: ManagedBy,
  ): Promise<MonitorDoc | null> {
    return hydrateOne(
      await MonitorModel.findOneAndUpdate(
        { _id: id, orgId },
        { $set: { ...spec, managedBy } },
        { new: true, runValidators: true },
      )
        .lean<MonitorDoc>()
        .exec(),
    );
  }

  async setPaused(orgId: Types.ObjectId, id: Types.ObjectId, paused: boolean): Promise<MonitorDoc | null> {
    const update = paused ? { $set: { paused, state: initialMonitorState() } } : { $set: { paused } };
    return hydrateOne(
      await MonitorModel.findOneAndUpdate({ _id: id, orgId }, update, { new: true })
        .lean<MonitorDoc>()
        .exec(),
    );
  }

  async delete(orgId: Types.ObjectId, id: Types.ObjectId): Promise<boolean> {
    const result = await MonitorModel.deleteOne({ _id: id, orgId }).exec();
    return result.deletedCount === 1;
  }

  /** Compare-and-swap on state.version so concurrent region results never clobber each other. */
  async compareAndSetState(
    id: Types.ObjectId,
    expectedVersion: number,
    state: MonitorState,
  ): Promise<boolean> {
    const result = await MonitorModel.updateOne(
      { _id: id, "state.version": expectedVersion },
      { $set: { state: { ...state, version: expectedVersion + 1 } } },
    ).exec();
    return result.modifiedCount === 1;
  }

  /**
   * Acknowledges a transition's side effects. Bumping the version makes any writer that read the
   * state before this point retry, so it cannot write the acknowledged reaction back.
   */
  async clearPendingReaction(id: Types.ObjectId, transition: Pick<Transition, "at">): Promise<boolean> {
    const result = await MonitorModel.updateOne(
      { _id: id, "state.pendingReaction.at": transition.at },
      { $set: { "state.pendingReaction": null }, $inc: { "state.version": 1 } },
    ).exec();
    return result.modifiedCount === 1;
  }

  async findWithPendingReactions(recordedBefore: Date, limit = 100): Promise<MonitorDoc[]> {
    return hydrateAll(
      await MonitorModel.find({ paused: false, "state.pendingReaction.at": { $lt: recordedBefore } })
        .limit(limit)
        .lean<MonitorDoc[]>()
        .exec(),
    );
  }

  async findDownSince(before: Date): Promise<MonitorDoc[]> {
    return hydrateAll(
      await MonitorModel.find({ paused: false, "state.status": "down", "state.since": { $lt: before } })
        .lean<MonitorDoc[]>()
        .exec(),
    );
  }
}
