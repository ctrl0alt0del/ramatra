declare module "better-sqlite3" {
  type RunResult = {
    changes: number;
  };

  type Statement = {
    run: (...params: unknown[]) => RunResult;
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
  };

  class Database {
    constructor(filename: string);
    pragma(statement: string): unknown;
    exec(sql: string): void;
    prepare(sql: string): Statement;
    transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  }

  namespace Database {
    export { Database };
  }

  export default Database;
}
