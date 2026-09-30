import { Graph } from "@domain/railway/graph";

import { getRouteGraphWs } from "../api/layoutWsApi";
import { createClientGraphFromRouteGraphDto } from "./routeGraphDtoMapper";

class RouteGraphStore {
  private graph: Graph | null = null;
  private loadingPromise: Promise<Graph | null> | null = null;

  async ensureLoaded(): Promise<Graph | null> {
    if (this.graph) {
      return this.graph;
    }

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = this.loadFromServer();

    try {
      return await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  private async loadFromServer(): Promise<Graph | null> {
    const response = await getRouteGraphWs();

    if (!response.ready) {
      this.graph = null;
      return null;
    }

    this.graph =
      createClientGraphFromRouteGraphDto(response);

    return this.graph;
  }
}

export const routeGraphStore = new RouteGraphStore();
