type GoogleConnection = {
  grantedScopes: string[];
  status: string;
} | null | undefined;

export function hasGrantedScope(connection: GoogleConnection, requiredScope: string) {
  return connection?.status === "connected" && connection.grantedScopes.includes(requiredScope);
}
