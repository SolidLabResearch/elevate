export interface UmaAccessRequestOptions {
  fetch: typeof fetch;
  requestingParty: string | null;
  requestedTarget: string;
  response?: Response;
  requestedAction?: UmaRequestedAction;
  requestedActions?: UmaRequestedAction[];
  accessRequestUrl?: string;
}

export type UmaRequestedAction = "read" | "write" | "create" | "delete";

export interface UmaAccessRequestResult {
  requested: boolean;
  accessRequestUrl?: string;
  status?: number;
  statusText?: string;
  reason?: string;
}

export class UmaAccessRequest {
  private static readonly SOTW_PREFIX = "https://w3id.org/force/sotw#";
  private static readonly ODRL_PREFIX = "http://www.w3.org/ns/odrl/2/";
  private static readonly EX_PREFIX = "http://example.org/";

  public static async request(options: UmaAccessRequestOptions): Promise<UmaAccessRequestResult> {
    const accessRequestUrl = UmaAccessRequest.resolveAccessRequestUrl(options.response, options.accessRequestUrl);
    if (!accessRequestUrl) {
      console.warn("[UmaAccessRequest] Unable to resolve access request URL", {
        requestedTarget: options.requestedTarget,
        hasResponse: Boolean(options.response),
        fallback: options.accessRequestUrl || null,
        wwwAuthenticate: options.response?.headers?.get("WWW-Authenticate") || null,
        parsedAuthorizationServer: UmaAccessRequest.parseUmaAuthorizationServer(
          options.response?.headers?.get("WWW-Authenticate")
        )
      });
      return {
        requested: false,
        reason: "Unable to resolve UMA access request URL from authorization server challenge."
      };
    }

    console.info("[UmaAccessRequest] Submitting UMA access request", {
      accessRequestUrl,
      requestedTarget: options.requestedTarget,
      requestedActions: UmaAccessRequest.normalizeActions(
        options.requestedActions || [options.requestedAction || "read"]
      ),
      hasResponse: Boolean(options.response),
      fallback: options.accessRequestUrl || null,
      wwwAuthenticate: options.response?.headers?.get("WWW-Authenticate") || null
    });

    if (!options.requestingParty) {
      return {
        requested: false,
        accessRequestUrl,
        reason: "Missing requesting party WebID."
      };
    }

    const response = await options.fetch(accessRequestUrl, {
      method: "POST",
      headers: {
        Authorization: `WebID ${encodeURIComponent(options.requestingParty)}`,
        "Content-Type": "text/turtle"
      },
      body: UmaAccessRequest.buildTurtle(
        options.requestingParty,
        options.requestedTarget,
        UmaAccessRequest.normalizeActions(options.requestedActions || [options.requestedAction || "read"])
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

  public static resolveAccessRequestUrl(response?: Response, fallback?: string): string | null {
    const asUri = UmaAccessRequest.parseUmaAuthorizationServer(response?.headers?.get("WWW-Authenticate"));
    if (!asUri) {
      return fallback || null;
    }

    return UmaAccessRequest.accessRequestUrlFromAuthorizationServer(asUri) || fallback || null;
  }

  public static accessRequestUrlFromAuthorizationServer(asUri: string | null): string | null {
    if (!asUri) {
      return null;
    }
    try {
      const url = new URL(asUri);
      return `${url.origin}/uma/requests`;
    } catch {
      return null;
    }
  }

  public static actionForMethod(method: string): UmaRequestedAction {
    switch ((method || "GET").toUpperCase()) {
      case "DELETE":
        return "delete";
      case "POST":
        return "create";
      case "PATCH":
      case "PUT":
        return "write";
      default:
        return "read";
    }
  }

  private static buildTurtle(
    requestingParty: string,
    requestedTarget: string,
    requestedActions: UmaRequestedAction[]
  ): string {
    const requestIri = `http://example.org/access-request/${Date.now()}-${UmaAccessRequest.hashIri(
      requestingParty
    )}-${UmaAccessRequest.hashIri(requestedTarget)}`;
    const odrlActions = requestedActions.map(action => UmaAccessRequest.toOdrlAction(action)).join(", ");

    return [
      `@prefix sotw: <${UmaAccessRequest.SOTW_PREFIX}> .`,
      `@prefix odrl: <${UmaAccessRequest.ODRL_PREFIX}> .`,
      `@prefix ex: <${UmaAccessRequest.EX_PREFIX}> .`,
      "",
      `<${UmaAccessRequest.escapeIri(requestIri)}> a sotw:EvaluationRequest ;`,
      `  sotw:requestedTarget <${UmaAccessRequest.escapeIri(requestedTarget)}> ;`,
      `  sotw:requestedAction ${odrlActions} ;`,
      `  sotw:requestingParty <${UmaAccessRequest.escapeIri(requestingParty)}> ;`,
      "  ex:requestStatus ex:requested ."
    ].join("\n");
  }

  private static normalizeActions(actions: UmaRequestedAction[]): UmaRequestedAction[] {
    return Array.from(new Set(actions.filter(Boolean)));
  }

  private static toOdrlAction(action: UmaRequestedAction): string {
    switch (action) {
      case "delete":
        return "odrl:delete";
      case "create":
        return "odrl:create";
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
