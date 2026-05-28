import { createShareRuntimeServer } from "./httpServer.ts";

const port = Number(process.env.PORT ?? 5179);
const server = createShareRuntimeServer({
  tokenFactory: () => "local-friend",
});

await server.listen(port);
console.log(`share runtime server listening on ${server.url()}`);
