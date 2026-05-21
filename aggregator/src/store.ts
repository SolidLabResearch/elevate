import { AggregatorInstance, AuthorizationServerClientCredentials, PendingAuthorization } from "./types";

export class MemoryStore {
  public readonly pending = new Map<string, PendingAuthorization>();
  public readonly instances = new Map<string, AggregatorInstance>();
  public readonly authorizationServerClients = new Map<string, AuthorizationServerClientCredentials>();
}

export const store = new MemoryStore();
