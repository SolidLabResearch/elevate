export interface UmaAccessRequestOptions {
  fetch: typeof fetch;
  requestingParty: string | null;
  requestedTarget: string;
  response?: Response;
  requestedAction?: UmaRequestedAction;
  accessRequestUrl?: string;
}

export type UmaRequestedAction = "read" | "write" | "delete";

export interface UmaAccessRequestResult {
  requested: boolean;
  accessRequestUrl: string;
  status?: number;
  statusText?: string;
  reason?: string;
}

export class UmaAccessRequest {
  public static readonly DEFAULT_ACCESS_REQUEST_URL = "http://as.local:4000/uma/requests";

  private static readonly SOTW_PREFIX = "https://w3id.org/force/sotw#";
  private static readonly ODRL_PREFIX = "http://www.w3.org/ns/odrl/2/";
  private static readonly EX_PREFIX = "http://example.org/";

  public static async request(options: UmaAccessRequestOptions): Promise<UmaAccessRequestResult> {
    if (!options.requestingParty) {
      return {
        requested: false,
        accessRequestUrl: UmaAccessRequest.resolveAccessRequestUrl(options.response, options.accessRequestUrl),
        reason: "Missing requesting party WebID."
      };
    }

    const accessRequestUrl = UmaAccessRequest.resolveAccessRequestUrl(options.response, options.accessRequestUrl);
    const response = await options.fetch(accessRequestUrl, {
      method: "POST",
      headers: {
        Authorization: `WebID ${encodeURIComponent(options.requestingParty)}`,
        "Content-Type": "text/turtle"
      },
      body: UmaAccessRequest.buildTurtle(
        options.requestingParty,
        options.requestedTarget,
        options.requestedAction || "read"
      )
    });

    return {
      requested: response.ok,
      accessRequestUrl,
      status: response.status,
      statusText: response.statusText,
      reason: response.ok ? null : `Access request failed with ${response.status} ${response.statusText}.`
    };
  }

  public static resolveAccessRequestUrl(response?: Response, fallback?: string): string {
    const asUri = UmaAccessRequest.parseUmaAuthorizationServer(response?.headers?.get("WWW-Authenticate"));
    if (!asUri) {
      return fallback || UmaAccessRequest.DEFAULT_ACCESS_REQUEST_URL;
    }

    try {
      const url = new URL(asUri);
      return `${url.origin}/uma/requests`;
    } catch {
      return fallback || UmaAccessRequest.DEFAULT_ACCESS_REQUEST_URL;
    }
  }

  public static actionForMethod(method: string): UmaRequestedAction {
    switch ((method || "GET").toUpperCase()) {
      case "DELETE":
        return "delete";
      case "PATCH":
      case "POST":
      case "PUT":
        return "write";
      default:
        return "read";
    }
  }

  private static buildTurtle(
    requestingParty: string,
    requestedTarget: string,
    requestedAction: UmaRequestedAction
  ): string {
    const requestIri = `http://example.org/access-request/${Date.now()}-${UmaAccessRequest.hashIri(
      requestingParty
    )}-${UmaAccessRequest.hashIri(requestedTarget)}`;
    const odrlAction = UmaAccessRequest.toOdrlAction(requestedAction);

    return [
      `@prefix sotw: <${UmaAccessRequest.SOTW_PREFIX}> .`,
      `@prefix odrl: <${UmaAccessRequest.ODRL_PREFIX}> .`,
      `@prefix ex: <${UmaAccessRequest.EX_PREFIX}> .`,
      "",
      `<${UmaAccessRequest.escapeIri(requestIri)}> a sotw:EvaluationRequest ;`,
      `  sotw:requestedTarget <${UmaAccessRequest.escapeIri(requestedTarget)}> ;`,
      `  sotw:requestedAction ${odrlAction} ;`,
      `  sotw:requestingParty <${UmaAccessRequest.escapeIri(requestingParty)}> ;`,
      "  ex:requestStatus ex:requested ."
    ].join("\n");
  }

  private static toOdrlAction(action: UmaRequestedAction): string {
    switch (action) {
      case "delete":
        return "odrl:delete";
      case "write":
        return "odrl:write";
      default:
        return "odrl:read";
    }
  }

  private static parseUmaAuthorizationServer(header: string | null): string | null {
    if (!header) {
      return null;
    }

    const umaIndex = header.toLowerCase().indexOf("uma");
    if (umaIndex < 0) {
      return null;
    }

    const paramsPart = header.slice(umaIndex);
    const match = /as_uri=("[^"]*"|[^\s,]+)/u.exec(paramsPart);
    if (!match) {
      return null;
    }

    const rawValue = match[1];
    return rawValue.startsWith('"') ? rawValue.slice(1, -1) : rawValue;
  }

  private static escapeIri(iri: string): string {
    return iri.replace(/\\/g, "\\\\").replace(/>/g, "%3E").replace(/</g, "%3C");
  }

  private static hashIri(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}
