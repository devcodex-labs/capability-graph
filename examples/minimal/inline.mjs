import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';

const definition = {
  providerId: 'acme',
  name: 'Acme HTTP',
  version: '1.0.0',
  capabilities: [
    {
      id: 'route',
      name: 'Validated HTTP endpoint',
      description: 'Create an HTTP endpoint with request validation.',
      whenToUse: 'The application needs an HTTP endpoint with validated input.',
      usage: { instructions: 'Declare the request schema, then register the endpoint.' },
      relations: { requires: ['schema'] }
    },
    { id: 'schema', name: 'Request schema', description: 'Declare a schema to validate request input.' }
  ]
};

let graph;
try {
  graph = await CapabilityGraph.open({ providers: [{ definition }] });
  const result = await graph.resolve({ ids: ['acme::route'] });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (!(error instanceof GraphError)) throw error;
  console.error(JSON.stringify({ code: error.code, phase: error.phase, nextAction: error.nextAction }));
  process.exitCode = 1;
} finally {
  await graph?.close();
}
