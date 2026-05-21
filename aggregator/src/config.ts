export interface AggregatorConfig {
  baseUrl: string;
  host: string;
  port: number;
  defaultAuthorizationServer: string | null;
}

const port = Number(process.env.AGGREGATOR_PORT || process.env.PORT || 4050);
const baseUrl = (process.env.AGGREGATOR_BASE_URL || `http://localhost:${port}`).replace(/\/+$/u, "");

export const config: AggregatorConfig = {
  baseUrl,
  host: process.env.AGGREGATOR_HOST || "127.0.0.1",
  port,
  defaultAuthorizationServer: process.env.AGGREGATOR_AUTHORIZATION_SERVER || null
};
