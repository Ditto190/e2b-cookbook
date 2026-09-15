import "dotenv/config";
import { Template, defaultBuildLogger } from "e2b";
import { TEMPLATE_ALIAS, tailcatTemplate } from "./template";

const buildInfo = await Template.build(tailcatTemplate, {
  alias: TEMPLATE_ALIAS,
  onBuildLogs: defaultBuildLogger(),
});
console.log(`built template ${TEMPLATE_ALIAS}:`, buildInfo);
