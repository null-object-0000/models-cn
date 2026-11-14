import { Makers } from "@edgeone/makers-sdk";

for (const key of ["TENCENT_CLOUD_SECRET_ID", "TENCENT_CLOUD_SECRET_KEY"]) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}

const projectId = "makers-qgqj3tultmxa";
const makers = new Makers({
  credentials: {
    secretId: process.env.TENCENT_CLOUD_SECRET_ID,
    secretKey: process.env.TENCENT_CLOUD_SECRET_KEY,
  },
  zoneId: "zone-3xezk62mta64",
  region: "china",
});

const project = await makers.projects.get({ projectId });
if (project.area !== "mainland") {
  throw new Error("Deployment target must use mainland nodes");
}
const deployment = await makers.deployments.deploy({
  projectId,
  artifact: { directory: "dist/site" },
  env: "Production",
});
const result = await makers.deployments.wait({
  projectId,
  deploymentId: deployment.deploymentId,
  timeout: 300,
  pollInterval: 5,
});
if (result.status !== "Success") {
  throw new Error(`EdgeOne deployment failed: ${result.status}`);
}
console.log(`EdgeOne deployment ${deployment.deploymentId}: ${result.status}`);
console.log("Site: https://models.devtrends.site/");
