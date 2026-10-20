import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'capability-graph-documents-'));
const definition={providerId:'docs',name:'Document example',version:'1',capabilities:[{
  id:'route',name:'Route',description:'A route with separately read documentation.',
  usage:{instructions:'Read the declared guide.',contract:{format:'other',uri:'urn:docs:route-contract'}},
  documents:[{id:'guide',source:{type:'file',path:'guide.md'}},{id:'missing',source:{type:'file',path:'missing.md'}},{id:'upstream',source:{type:'url',url:'https://example.com/guide'}}]
}]};
let fileGraph,inlineGraph,missingRoot;const output={};
try {
  const bytes=Buffer.from('\uFEFFGuide\r\nSecond line\r\n','utf8');
  await fs.writeFile(path.join(root,'guide.md'),bytes);
  await fs.writeFile(path.join(root,'provider.json'),JSON.stringify(definition));
  fileGraph=await CapabilityGraph.open({providers:[{file:path.join(root,'provider.json')}]});
  inlineGraph=await CapabilityGraph.open({providers:[{definition,documentRoot:root}]});
  const query={capabilityId:'docs::route',documentId:'guide'};
  output.file=await fileGraph.readDocument(query);output.inline=await inlineGraph.readDocument(query);
  assert.deepEqual(output.inline,output.file);
  assert.equal(output.file.text,'Guide\r\nSecond line\r\n');assert.equal(output.file.byteLength,bytes.byteLength);
  assert.equal(output.file.contentHash,'sha256:'+createHash('sha256').update(bytes).digest('hex'));
  const before=(await fileGraph.listCatalog()).meta.revision;
  await fs.writeFile(path.join(root,'guide.md'),'Changed body\r\n');
  output.changed=await fileGraph.readDocument(query);
  assert.notEqual(output.changed.contentHash,output.file.contentHash);assert.equal(output.changed.meta.revision,before);
  // Opening an inline declaration without documentRoot succeeds; reading rejects.
  missingRoot=await CapabilityGraph.open({providers:[{definition}]});
  for(const [name,owner,documentId,expected]of [
    ['root-required',missingRoot,'guide','CG_DOCUMENT_ROOT_REQUIRED'],
    ['missing-file',fileGraph,'missing','CG_DOCUMENT_NOT_FOUND'],
    ['url-reference',fileGraph,'upstream','CG_DOCUMENT_REFERENCE_ONLY']
  ]) {
    await assert.rejects(owner.readDocument({capabilityId:'docs::route',documentId}),error=>{
      assert(error instanceof GraphError);output[name]={code:error.code,phase:error.phase};return error.code===expected;
    });
  }
  console.log(JSON.stringify(output,null,2));
} finally {
  await missingRoot?.close();await inlineGraph?.close();await fileGraph?.close();
  await fs.rm(root,{recursive:true,force:true});
}
