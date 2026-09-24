import { DockerSandbox } from '../../dist/runtime/docker-sandbox.js';
const sandbox = new DockerSandbox(JSON.parse(process.env.DREAMCORE_EXECUTOR_TEST_CONFIG));
await sandbox.run(
  "import fs from 'node:fs';fs.writeFileSync('ready.txt','CRASH_READY');setInterval(()=>{},1000);",
  [],
  new AbortController().signal,
);
