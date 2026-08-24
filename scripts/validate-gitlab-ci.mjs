import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import Ajv from "ajv";
import { parse } from "yaml";

const GITLAB_CI_SCHEMA_URL =
  "https://gitlab.com/gitlab-org/gitlab/-/raw/0ec864ef3ca657bdb27bab6e429f2b445f05f6f5/app/assets/javascripts/editor/schema/ci.json";

export function validateGitLabCi(config, schema) {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    formats: {
      "date-time": true,
      regex: true,
      uri: true,
      "uri-reference": true,
    },
  });

  if (!ajv.validate(schema, config)) {
    const errors = ajv.errorsText(ajv.errors, { separator: "\n" });
    throw new Error(`Invalid GitLab CI configuration:\n${errors}`);
  }
}

async function main() {
  const response = await fetch(GITLAB_CI_SCHEMA_URL);
  if (!response.ok) {
    throw new Error(`Unable to fetch GitLab CI schema (${response.status})`);
  }

  const schema = await response.json();
  const config = parse(readFileSync(".gitlab-ci.yml", "utf8"));
  validateGitLabCi(config, schema);

  console.log("GitLab CI configuration matches the pinned official schema.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
