import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const methods = new Set(["get", "post", "patch", "put", "delete", "options", "head"]);
function source(file: string) {
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}
function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  node.forEachChild(child => walk(child, visit));
}
function paths(node: ts.Node | undefined): string[] {
  if (!node) return [];
  if (ts.isStringLiteral(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(paths);
  return [];
}
function operation(method: string, prefix: string, route: string) {
  const full = `${prefix}${route === "/" ? "" : route}` || "/";
  return `${method.toUpperCase()} ${full.replace(/:([a-zA-Z0-9_]+)/g, "{$1}")}`;
}

// Inspect source without importing the app: no environment, database, provider,
// or route side effects. Comments and disabled mounts cannot enter the inventory.
export function mountedApiOperations(appFile = path.resolve(__dirname, "../app.ts")) {
  const app = source(appFile);
  const imports = new Map<string, string>();
  for (const statement of app.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.importClause?.name && statement.moduleSpecifier.text.startsWith("./routes/")) {
      imports.set(statement.importClause.name.text, statement.moduleSpecifier.text);
    }
  }
  const found = new Set<string>();
  walk(app, node => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.expression.getText(app) !== "app") return;
    const method = node.expression.name.text;
    if (methods.has(method)) {
      for (const route of paths(node.arguments[0])) {
        if (route !== "/openapi.json" && !route.startsWith("/api-docs")) found.add(operation(method, "", route));
      }
    }
    if (method !== "use") return;
    for (const prefix of paths(node.arguments[0])) {
      for (const handler of node.arguments.slice(1)) {
        let moduleName: string | undefined;
        let routerName = "router";
        if (ts.isIdentifier(handler)) moduleName = imports.get(handler.text);
        if (ts.isCallExpression(handler) && handler.expression.getText(app) === "lazyRouter") {
          walk(handler.arguments[0], child => {
            if (ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword) moduleName = paths(child.arguments[0])[0];
          });
          routerName = paths(handler.arguments[1])[0] ?? routerName;
        }
        if (!moduleName) continue;
        const file = source(path.resolve(path.dirname(appFile), `${moduleName}.ts`));
        // Factory routers (billing) and default exports use the local `router`;
        // named admin exports register their operations on their named router.
        walk(file, child => {
          if (!ts.isCallExpression(child) || !ts.isPropertyAccessExpression(child.expression)) return;
          if (child.expression.expression.getText(file) !== routerName || !methods.has(child.expression.name.text)) return;
          const routePaths = paths(child.arguments[0]);
          if (!routePaths.length) throw new Error(`Unresolved route path in ${file.fileName}`);
          for (const route of routePaths) found.add(operation(child.expression.name.text, prefix, route));
        });
      }
    }
  });
  return [...found].sort();
}
