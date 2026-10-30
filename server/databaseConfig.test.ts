import { describe, expect, it } from "vitest";
import { databaseConnectionOptions } from "./databaseConfig";

describe("databaseConnectionOptions", () => {
  it("keeps the existing DATABASE_URL configuration", () => {
    expect(databaseConnectionOptions({ DATABASE_URL: "mysql://example" }).uri).toBe("mysql://example");
  });

  it("uses isolated private MySQL settings without building a URL", () => {
    const options = databaseConnectionOptions({
      BASIRA_DB_HOST: "basira-b5-staging-20261030-mysql",
      BASIRA_DB_USER: "basira_staging",
      BASIRA_DB_PASSWORD: "a+/=private-password",
      BASIRA_DB_NAME: "basira_staging",
    });
    expect(options).toMatchObject({
      host: "basira-b5-staging-20261030-mysql",
      port: 3306,
      password: "a+/=private-password",
      database: "basira_staging",
    });
    expect(options).not.toHaveProperty("uri");
  });

  it("rejects incomplete or mixed configurations", () => {
    expect(() => databaseConnectionOptions({})).toThrow();
    expect(() => databaseConnectionOptions({ BASIRA_DB_HOST: "staging-db" })).toThrow();
    expect(() => databaseConnectionOptions({ DATABASE_URL: "mysql://production", BASIRA_DB_HOST: "staging-db" })).toThrow();
  });
});
